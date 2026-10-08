import type { PowerState } from '@smart-room/contracts/devices';
import {
    type DurableSignificantFactProjection,
    isRecentEventsProjection,
    type RecentEventProjection,
} from '@smart-room/contracts/history';
import {
    type DurableUserHistoryItem,
    isUserHistoryItem,
    type UserHistoryItem,
} from '@smart-room/contracts/user-history';

type RequestEvidence =
    | { kind: 'missing' }
    | { kind: 'known'; power: PowerState }
    | { kind: 'conflicting' };

/** Only timeout identities on the main page are retained, never the whole raw history. */
export type TimeoutEvidence = Map<string, Map<string, RequestEvidence>>;

export function createTimeoutEvidence(
    facts: readonly DurableSignificantFactProjection[],
    deviceNames: ReadonlyMap<string, string>,
): TimeoutEvidence {
    const evidence: TimeoutEvidence = new Map();

    for (const fact of facts) {
        if (
            fact.eventType !== 'command.timed_out' ||
            fact.processingEvidence !== undefined ||
            !deviceNames.has(fact.deviceId)
        ) {
            continue;
        }

        const commands = evidence.get(fact.deviceId) ?? new Map<string, RequestEvidence>();
        commands.set(fact.commandId, { kind: 'missing' });
        evidence.set(fact.deviceId, commands);
    }

    return evidence;
}

export function collectTimeoutRequestEvidence(
    evidence: TimeoutEvidence,
    facts: readonly DurableSignificantFactProjection[],
): void {
    for (const fact of facts) {
        if (fact.eventType !== 'command.requested') {
            continue;
        }

        const commands = evidence.get(fact.deviceId);
        const previous = commands?.get(fact.commandId);

        if (!commands || !previous || previous.kind === 'conflicting') {
            continue;
        }

        const power = fact.payload.requestedState.power;
        commands.set(
            fact.commandId,
            previous.kind === 'known' && previous.power !== power
                ? { kind: 'conflicting' }
                : { kind: 'known', power },
        );
    }
}

export function toHistoricalUserHistoryItems(
    facts: readonly DurableSignificantFactProjection[],
    deviceNames: ReadonlyMap<string, string>,
    evidence: TimeoutEvidence,
): DurableUserHistoryItem[] {
    return facts.flatMap((fact): DurableUserHistoryItem[] => {
        const request =
            fact.eventType === 'command.timed_out'
                ? evidence.get(fact.deviceId)?.get(fact.commandId)
                : undefined;
        const legacyPower =
            fact.eventType === 'command.failed' && fact.payload.commandType === 'set.power'
                ? fact.payload.requestedState?.power
                : request?.kind === 'known'
                  ? request.power
                  : undefined;
        const item = toUserHistoryItem(
            fact,
            'deviceId' in fact ? deviceNames.get(fact.deviceId) : undefined,
            legacyPower,
        );

        return item?.durability === 'durable' ? [item] : [];
    });
}

/** One evidence-based presentation mapping for snapshots, live deltas and pages. */
export function toUserHistoryItem(
    fact: RecentEventProjection,
    deviceName?: string,
    legacyRequestedPower?: PowerState,
): UserHistoryItem | undefined {
    if (!isRecentEventsProjection([fact])) {
        throw new Error(`Invalid processing evidence or fact ${fact.recordId}.`);
    }

    const identity = {
        recordId: fact.recordId,
        occurredAt: new Date(fact.occurredAt).toISOString(),
        source: fact.source,
        durability: fact.durability,
        ...(fact.durability === 'durable' ? { storageSequence: fact.storageSequence } : {}),
    };

    const make = (fields: Record<string, unknown>): UserHistoryItem => {
        const item = { ...identity, ...fields };

        if (!isUserHistoryItem(item)) {
            throw new Error(
                `Transformed record ${fact.recordId} failed the user-history contract.`,
            );
        }

        return item;
    };

    if (fact.eventType === 'storage.gap.recorded') {
        return make({
            kind: 'history_gap',
            outageStartedAt: new Date(fact.payload.outageStartedAt).toISOString(),
            outageEndedAt: new Date(fact.payload.outageEndedAt).toISOString(),
        });
    }

    if (!deviceName) {
        return undefined;
    }

    const device = { deviceId: fact.deviceId, deviceName };

    switch (fact.eventType) {
        case 'device.state.reported': {
            const effect = fact.processingEvidence;
            const before = effect?.before.power;
            const after = effect?.after.power;

            return effect?.applied && (after === 'on' || after === 'off') && before !== after
                ? make({
                      ...device,
                      kind: 'power_changed',
                      previous: before === 'on' || before === 'off' ? before : null,
                      current: after,
                  })
                : undefined;
        }

        case 'device.availability.changed':

        // falls through: availability and health share the effective trait mapping.
        case 'device.health.changed': {
            const effect = fact.processingEvidence;

            return effect?.applied && effect.before !== effect.after
                ? make({
                      ...device,
                      kind:
                          fact.eventType === 'device.availability.changed'
                              ? 'availability_changed'
                              : 'health_changed',
                      previous: effect.before,
                      current: effect.after,
                  })
                : undefined;
        }

        case 'command.failed':

        // falls through: failures and timeouts share retained command intent.
        case 'command.timed_out': {
            const power =
                fact.processingEvidence === undefined
                    ? legacyRequestedPower
                    : fact.processingEvidence.intent?.requestedState.power;

            if (fact.eventType === 'command.timed_out' && power === undefined) {
                return undefined;
            }

            return make({
                ...device,
                kind:
                    fact.eventType === 'command.failed' ? 'attempt_failed' : 'confirmation_missing',
                ...(power === undefined ? {} : { requestedPower: power }),
            });
        }

        default:
            return undefined;
    }
}
