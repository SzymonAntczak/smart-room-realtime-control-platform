import {
    compareRecentEventsDescending,
    type LiveTelemetrySampleProjection,
    type RawTelemetryPage,
    type RawTelemetryPageQuery,
    type RawTelemetrySampleProjection,
} from '@smart-room/contracts/history';

import { createTelemetryHistoryClient, type TelemetryHistoryClient } from '../../api/history';
import type { HistoryLiveUpdate } from '../../shared/history';

const pageSize = 100;
const sampleLimit = 200;
const rangeDuration = 30 * 24 * 60 * 60 * 1000;

interface TelemetryState {
    deviceId: string;
    status: 'idle' | 'waiting_for_baseline' | 'loading' | 'ready' | 'error' | 'closed';
    samples: readonly LiveTelemetrySampleProjection[];
    range: { from: string; to: string } | null;
    pin: Pick<RawTelemetryPage, 'historyGenerationId' | 'throughSequence' | 'retentionAsOf'> | null;
    limitReached: boolean;
    lastKnown: boolean;
    error: 'unavailable' | 'invalid_response' | 'request_failed' | 'cursor_error' | null;
}

/** A bounded HTTP baseline and live overlay, scoped to one selected sensor. */
export function createTelemetrySession(
    deviceId: string,
    client: TelemetryHistoryClient = createTelemetryHistoryClient(),
    now: () => number = Date.now,
    requestBaseline: () => void = () => undefined,
) {
    let state: TelemetryState = {
        deviceId,
        status: 'idle',
        samples: [],
        range: null,
        pin: null,
        limitReached: false,
        lastKnown: false,
        error: null,
    };
    let epoch = 0;
    let controller: AbortController | undefined;
    let operation: Promise<void> | undefined;
    let baseline: readonly RawTelemetrySampleProjection[] = [];
    let overlay = new Map<string, LiveTelemetrySampleProjection>();
    let retained: readonly LiveTelemetrySampleProjection[] | undefined;
    let generation: string | null = null;
    let hasBaseline = false;
    let opened = false;
    let generationReplacementPending = false;
    let storageStatus:
        | Exclude<HistoryLiveUpdate, { kind: 'interrupted' }>['storage']['status']
        | undefined;
    let recoveryAttempted = false;
    let overlayLimited = false;
    let httpLimited = false;
    const listeners = new Set<() => void>();

    const session = {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
        start(): Promise<void> {
            if (state.status === 'closed' || state.status === 'loading') {
                return operation ?? Promise.resolve();
            }

            opened = true;
            recoveryAttempted = false;

            return rebuild();
        },
        acceptRealtime(update: HistoryLiveUpdate) {
            if (state.status === 'closed') {
                return;
            }

            if (update.kind === 'interrupted') {
                retain();
                cancel();
                hasBaseline = false;
                emit({ status: 'waiting_for_baseline', lastKnown: true });

                return;
            }

            const incomingGeneration =
                update.storage.historyGenerationId ??
                (update.kind === 'baseline' ? (update.lastKnownHistoryGenerationId ?? null) : null);
            const changed =
                incomingGeneration !== null &&
                generation !== null &&
                incomingGeneration !== generation;
            const wasUnavailable = storageStatus !== 'available' || state.error === 'unavailable';

            if (changed) {
                retain();
                cancel();
                baseline = [];
                overlay.clear();
                overlayLimited = false;
                httpLimited = false;
                generationReplacementPending = true;
                state = { ...state, pin: null };
            }

            if (incomingGeneration !== null) {
                generation = incomingGeneration;
            }

            if (update.kind === 'baseline') {
                hasBaseline = true;
                recoveryAttempted = false;
            }

            if (storageStatus === 'available' && update.storage.status !== 'available') {
                recoveryAttempted = false;
            }

            storageStatus = update.storage.status;

            if (
                update.kind === 'addition' &&
                hasBaseline &&
                update.telemetrySample?.deviceId === deviceId &&
                update.telemetrySample.metric === 'temperature'
            ) {
                mergeOverlay(update.telemetrySample);
            }

            if (storageStatus !== 'available') {
                cancel();
                emit({ status: 'error', error: 'unavailable', lastKnown: true });
            } else if (opened && hasBaseline && (update.kind === 'baseline' || changed)) {
                void rebuild();
            } else if (opened && hasBaseline && wasUnavailable && !recoveryAttempted) {
                recoveryAttempted = true;
                void rebuild();
            } else {
                emit();
            }
        },
        close() {
            cancel();
            baseline = [];
            overlay.clear();
            retained = undefined;
            generationReplacementPending = false;
            overlayLimited = false;
            httpLimited = false;
            emit({
                status: 'closed',
                samples: [],
                range: null,
                pin: null,
                lastKnown: false,
                limitReached: false,
                error: null,
            });
            listeners.clear();
        },
    };

    return session;

    function cancel() {
        epoch += 1;
        controller?.abort();
        controller = undefined;
        operation = undefined;
    }

    function retain() {
        if (state.samples.length > 0) {
            retained = state.samples;
        }
    }

    function rebuild(): Promise<void> {
        if (!hasBaseline) {
            emit({ status: 'waiting_for_baseline', lastKnown: state.samples.length > 0 });

            return Promise.resolve();
        }

        if (storageStatus !== 'available') {
            emit({ status: 'error', error: 'unavailable', lastKnown: true });

            return Promise.resolve();
        }

        retain();
        cancel();
        baseline = [];
        httpLimited = false;
        const to = now();
        const range = {
            from: new Date(to - rangeDuration).toISOString(),
            to: new Date(to).toISOString(),
        };
        const currentEpoch = ++epoch;
        controller = new AbortController();
        const signal = controller.signal;
        operation = Promise.resolve();
        emit({
            status: 'loading',
            pin: null,
            range,
            error: null,
            lastKnown: state.samples.length > 0,
        });
        const pending = readBaseline(
            { deviceId, metric: 'temperature', pageSize, ...range },
            currentEpoch,
            signal,
        ).finally(() => {
            if (epoch === currentEpoch) {
                operation = undefined;
            }
        });
        operation = pending;

        return pending;
    }

    function awaitBaseline() {
        retain();
        cancel();
        hasBaseline = false;
        baseline = [];
        emit({ status: 'waiting_for_baseline', pin: null, lastKnown: true });
        requestBaseline();
    }

    async function readBaseline(
        query: RawTelemetryPageQuery,
        currentEpoch: number,
        signal: AbortSignal,
    ) {
        let cursor: string | undefined;
        let pin: TelemetryState['pin'] = null;
        let previousOldest: RawTelemetrySampleProjection | undefined;
        let pages = 0;
        let restarted = false;

        while (active()) {
            try {
                const result = await client.readPage(
                    { ...query, ...(cursor ? { cursor } : {}) },
                    signal,
                );

                if (!active()) {
                    return;
                }

                if (result.kind === 'cursor_error') {
                    if (result.error.error === 'history_generation_changed') {
                        awaitBaseline();

                        return;
                    }

                    if (!restarted && result.error.error !== 'cursor_query_mismatch') {
                        restarted = true;
                        cursor = undefined;
                        pin = null;
                        previousOldest = undefined;
                        pages = 0;
                        retain();
                        baseline = [];
                        emit({ lastKnown: true });
                        continue;
                    }

                    fail('cursor_error');

                    return;
                }

                if (result.kind !== 'page') {
                    fail(result.kind);

                    return;
                }

                const page = result.page;

                if (generation !== null && page.historyGenerationId !== generation) {
                    awaitBaseline();

                    return;
                }

                const continuation = pin !== null;
                const existing = continuation ? baseline : [];
                const ids = new Set(existing.map((sample) => sample.recordId));
                const sequences = new Set(existing.map((sample) => sample.storageSequence));
                const newest = page.items[0];
                const ordered =
                    previousOldest === undefined ||
                    newest === undefined ||
                    Date.parse(newest.occurredAt) < Date.parse(previousOldest.occurredAt) ||
                    (Date.parse(newest.occurredAt) === Date.parse(previousOldest.occurredAt) &&
                        newest.storageSequence < previousOldest.storageSequence);

                if (
                    page.pageSize !== pageSize ||
                    (pin !== null &&
                        (page.historyGenerationId !== pin.historyGenerationId ||
                            page.throughSequence !== pin.throughSequence ||
                            page.retentionAsOf !== pin.retentionAsOf)) ||
                    page.items.some(
                        (sample) =>
                            ids.has(sample.recordId) || sequences.has(sample.storageSequence),
                    ) ||
                    !ordered ||
                    (page.nextCursor !== null && page.nextCursor === cursor) ||
                    existing.length + page.items.length > sampleLimit
                ) {
                    fail('invalid_response');

                    return;
                }

                pin = {
                    historyGenerationId: page.historyGenerationId,
                    throughSequence: page.throughSequence,
                    retentionAsOf: page.retentionAsOf,
                };
                previousOldest = page.items.at(-1) ?? previousOldest;
                pages += 1;
                baseline = [...existing, ...page.items];

                for (const sample of page.items) {
                    if (overlay.has(sample.recordId)) {
                        overlay.set(sample.recordId, sample);
                    }
                }

                retained = undefined;
                generationReplacementPending = false;
                const complete =
                    page.nextCursor === null || baseline.length >= sampleLimit || pages >= 2;
                httpLimited = complete && page.nextCursor !== null;
                emit({
                    pin,
                    lastKnown: !complete,
                    status: complete ? 'ready' : 'loading',
                });

                if (complete) {
                    return;
                }

                cursor = page.nextCursor ?? undefined;
            } catch {
                if (active()) {
                    fail('request_failed');
                }

                return;
            }
        }

        function active() {
            return epoch === currentEpoch && state.status !== 'closed';
        }

        function fail(error: NonNullable<TelemetryState['error']>) {
            emit({ status: 'error', error, lastKnown: true });
        }
    }

    function mergeOverlay(sample: LiveTelemetrySampleProjection) {
        const previous =
            overlay.get(sample.recordId) ??
            baseline.find((item) => item.recordId === sample.recordId) ??
            (!generationReplacementPending
                ? retained?.find((item) => item.recordId === sample.recordId)
                : undefined);

        overlay.set(
            sample.recordId,
            previous?.durability === 'durable' && sample.durability === 'volatile'
                ? previous
                : sample,
        );

        if (overlay.size > sampleLimit) {
            overlayLimited = true;
            overlay = new Map(
                [...overlay.values()]
                    .sort(compareRecentEventsDescending)
                    .slice(0, sampleLimit)
                    .map((item) => [item.recordId, item]),
            );
        }
    }

    function emit(change: Partial<TelemetryState> = {}) {
        const merged = new Map((retained ?? baseline).map((sample) => [sample.recordId, sample]));

        if (!generationReplacementPending || retained === undefined) {
            for (const [id, sample] of overlay) {
                const previous = merged.get(id);

                if (
                    !previous ||
                    previous.durability !== 'durable' ||
                    sample.durability === 'durable'
                ) {
                    merged.set(id, sample);
                }
            }
        }

        state = {
            ...state,
            ...change,
            samples: [...merged.values()]
                .sort(compareRecentEventsDescending)
                .slice(0, sampleLimit)
                .reverse(),
            limitReached: httpLimited || overlayLimited || merged.size > sampleLimit,
        };

        for (const listener of listeners) {
            listener();
        }
    }
}
