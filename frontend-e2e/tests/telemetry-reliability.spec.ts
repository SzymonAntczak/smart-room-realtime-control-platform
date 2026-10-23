import { expect, type Page, test } from '@playwright/test';
import {
    isRawTelemetryPage,
    type RawTelemetrySampleProjection,
} from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';

import {
    configureMockHistory,
    disconnectMockRealtime,
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createDeviceUpdatedMessage,
    createFreshTemperatureAfterRecoveryDeviceProjection,
    createOfflineTemperatureDeviceProjection,
    createOnlineTemperatureDeviceProjection,
    createOnlineTemperatureRoomSnapshot,
    createPlatformUpdatedMessage,
    createRecoveredTemperatureDeviceProjection,
    createStaleTemperatureDeviceProjection,
} from './mock-bff/mock-bff-fixtures';
import { createHistoryPage } from './mock-bff/recent-feed-fixtures';

test.use({ timezoneId: 'UTC' });

const initialReadAt = '2026-06-08T09:36:00.000Z';
const replacementReadAt = '2026-06-08T09:37:00.000Z';

function measurement(sequence: number, value: number, occurredAt: string) {
    return {
        ...createHistoryIdentityFixtures().telemetrySample,
        recordId: `rec:v1:sha256:${sequence.toString(16).padStart(64, '0')}`,
        storageSequence: sequence,
        value,
        occurredAt,
    };
}

function telemetryPage(
    samples: readonly RawTelemetrySampleProjection[],
    throughSequence: number,
    retentionAsOf = initialReadAt,
    nextCursor: string | null = null,
) {
    const page = {
        ...createHistoryIdentityFixtures().rawTelemetryPage,
        historyGenerationId: 'mock-history-generation',
        throughSequence,
        retentionAsOf,
        pageSize: 100,
        items: [...samples].reverse(),
        nextCursor,
    };
    expect(isRawTelemetryPage(page)).toBe(true);

    return page;
}

function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });

    return { promise, resolve };
}

function deviceForSample(sample: RawTelemetrySampleProjection) {
    return {
        ...createOnlineTemperatureDeviceProjection(),
        reportedState: { temperature: sample.value, temperatureUnit: 'celsius' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: sample.occurredAt,
                durability: 'durable',
            },
        },
    } as const;
}

async function prepareTelemetry(page: Page, sample: RawTelemetrySampleProjection) {
    await page.clock.setFixedTime(new Date(initialReadAt));
    await resetMockRoom(page.request);
    const snapshot = createOnlineTemperatureRoomSnapshot();
    snapshot.devices = [deviceForSample(sample)];
    snapshot.platform.storage.storedThroughSequence = sample.storageSequence;
    await setMockRoomSnapshot(page.request, snapshot);
    await configureMockHistory(page.request, { pages: [createHistoryPage([])] });

    return snapshot;
}

async function publishSample(
    page: Page,
    previousRevision: number,
    sample: RawTelemetrySampleProjection,
) {
    await publishMockRoomUpdate(page.request, {
        ...createDeviceUpdatedMessage(previousRevision, deviceForSample(sample)),
        telemetrySample: sample,
    });
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            previousRevision + 1,
            sample.storageSequence,
            sample.occurredAt,
        ),
    );
}

async function expectMeasurements(page: Page, samples: readonly RawTelemetrySampleProjection[]) {
    const table = page.getByRole('table', { name: 'Pomiary temperatury', exact: true });
    await expect(table.getByRole('row')).toHaveCount(samples.length + 1);

    const formatter = new Intl.DateTimeFormat('pl-PL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
    });
    const points = samples.map((sample) => ({
        sample,
        time: formatter.format(new Date(sample.occurredAt)),
    }));
    await expect(table.getByRole('cell')).toHaveText(
        points.flatMap(({ sample, time }) => [time, String(sample.value), '°C', 'Utrwalone']),
    );

    const description = points.map(({ sample, time }) => `${time}: ${sample.value}`).join('; ');
    const escaped = description.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    await expect(page.getByRole('application')).toHaveAccessibleDescription(
        new RegExp(`^[^:]+: ${escaped}\\.$`, 'u'),
    );
}

test('retains telemetry through reconnect and merges refetched pages with live samples without loss', async ({
    page,
}) => {
    const initial = measurement(1, 22.4, '2026-06-08T09:30:00.000Z');
    // A continuing raw page must contain all 100 requested samples.
    const retainedHistory = Array.from({ length: 98 }, (_, index) =>
        measurement(
            index + 2,
            20 + index / 100,
            new Date(Date.parse(initial.occurredAt) + (index + 1) * 500).toISOString(),
        ),
    );
    const beforeDisconnect = measurement(100, 22.8, '2026-06-08T09:31:00.000Z');
    const missed = measurement(101, 23, '2026-06-08T09:32:00.000Z');
    const duringRefetch = measurement(102, 23.1, '2026-06-08T09:37:01.000Z');
    const afterRefetch = measurement(103, 23.2, '2026-06-08T09:37:02.000Z');
    const snapshot = await prepareTelemetry(page, initial);
    const snapshotGate = deferred();
    const firstPageGate = deferred();
    const secondPageGate = deferred();
    const requests: URL[] = [];
    const initialPage = telemetryPage([initial], 1);
    const replacementPage = telemetryPage(
        [...retainedHistory, beforeDisconnect, missed],
        101,
        replacementReadAt,
        'older',
    );
    const olderPage = telemetryPage([initial], 101, replacementReadAt);
    await page.route('**/room/history/telemetry?*', async (route) => {
        const url = new URL(route.request().url());
        requests.push(url);

        if (requests.length === 1) {
            await route.fulfill({ json: initialPage });
        } else if (url.searchParams.has('cursor')) {
            await secondPageGate.promise;
            await route.fulfill({ json: olderPage });
        } else {
            await firstPageGate.promise;
            await route.fulfill({ json: replacementPage });
        }
    });

    try {
        await page.goto('/device-details/temp-desk');
        await expectMeasurements(page, [initial]);
        await publishSample(page, 0, beforeDisconnect);
        await expectMeasurements(page, [initial, beforeDisconnect]);

        // The existing mock control resets revisions for the next revision-0 stream.
        // Preserve the latest same-generation state and publish no delta before disconnect.
        snapshot.devices = [deviceForSample(missed)];
        snapshot.platform.storage.storedThroughSequence = missed.storageSequence;
        await setMockRoomSnapshot(page.request, snapshot);
        await page.route('**/room/realtime', async (route) => {
            await snapshotGate.promise;
            await route.continue();
        });
        await page.clock.setFixedTime(new Date(replacementReadAt));
        await disconnectMockRealtime(page.request);

        const reconnecting = page.getByRole('status').filter({ hasText: /łączy się ponownie/u });
        const partial = page.getByRole('status').filter({ hasText: /Kompletność/u });
        await expect(reconnecting).toBeVisible();
        await expect(partial).toBeVisible();
        await expectMeasurements(page, [initial, beforeDisconnect]);
        expect(requests).toHaveLength(1);

        snapshotGate.resolve();
        await expect.poll(() => requests.length).toBe(2);
        await expect(reconnecting).toHaveCount(0);
        await expect(partial).toBeVisible();
        await expectMeasurements(page, [initial, beforeDisconnect]);
        expect(requests[1]?.searchParams.get('to')).toBe(replacementReadAt);
        expect(requests[1]?.searchParams.get('from')).toBe('2026-05-09T09:37:00.000Z');
        expect(requests[1]?.searchParams.has('cursor')).toBe(false);

        await publishSample(page, 0, duringRefetch);
        await expectMeasurements(page, [initial, beforeDisconnect, duringRefetch]);
        firstPageGate.resolve();
        await expect.poll(() => requests.length).toBe(3);
        await expect(partial).toBeVisible();
        expect(requests[2]?.searchParams.get('cursor')).toBe('older');
        expect(requests[2]?.searchParams.get('from')).toBe(requests[1]?.searchParams.get('from'));
        expect(requests[2]?.searchParams.get('to')).toBe(replacementReadAt);
        secondPageGate.resolve();

        const refetched = [initial, ...retainedHistory, beforeDisconnect, missed, duringRefetch];
        await expectMeasurements(page, refetched);
        await expect(partial).toHaveCount(0);
        await publishSample(page, 2, afterRefetch);
        await expectMeasurements(page, [...refetched, afterRefetch]);
        expect(requests).toHaveLength(3);
    } finally {
        snapshotGate.resolve();
        firstPageGate.resolve();
        secondPageGate.resolve();
    }
});

test('keeps availability and observation freshness independent while retaining telemetry', async ({
    page,
}) => {
    const initial = measurement(1, 22.8, '2026-06-08T09:31:00.000Z');
    const recovered = measurement(2, 23.1, '2026-06-08T09:35:00.000Z');
    await prepareTelemetry(page, initial);
    const baseline = telemetryPage([initial], 1);
    await page.route('**/room/history/telemetry?*', (route) => route.fulfill({ json: baseline }));
    await page.goto('/device-details/temp-desk');
    const freshness = page.getByRole('status', { name: 'Świeżość pomiaru' });
    const availability = page
        .getByRole('region', { name: 'Informacje o urządzeniu' })
        .getByRole('status');
    await expectMeasurements(page, [initial]);
    await expect(freshness).toContainText('Aktualny pomiar');
    await expect(freshness).toContainText('9:31:00');
    await expect(availability).toHaveText('Online');

    const transitions = [
        { device: createStaleTemperatureDeviceProjection(), availability: 'Online' },
        { device: createOfflineTemperatureDeviceProjection(), availability: 'Offline' },
        { device: createRecoveredTemperatureDeviceProjection(), availability: 'Online' },
    ];

    for (const [revision, transition] of transitions.entries()) {
        await publishMockRoomUpdate(
            page.request,
            createDeviceUpdatedMessage(revision, transition.device),
        );
        await expect(availability).toHaveText(transition.availability);
        await expect(freshness).toContainText('Nieaktualny pomiar');
        await expect(freshness).toContainText('9:31:00');
        await expectMeasurements(page, [initial]);
    }

    await publishMockRoomUpdate(page.request, {
        ...createDeviceUpdatedMessage(3, createFreshTemperatureAfterRecoveryDeviceProjection()),
        telemetrySample: recovered,
    });
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(4, 2, recovered.occurredAt),
    );
    await expect(freshness).toContainText('Aktualny pomiar');
    await expect(freshness).not.toContainText('Nieaktualny');
    await expect(freshness).toContainText('9:35:00');
    await expect(availability).toHaveText('Online');
    await expectMeasurements(page, [initial, recovered]);
});
