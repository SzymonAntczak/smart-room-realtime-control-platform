import type { PowerState } from '@smart-room/contracts/devices';
import type { DurableSignificantFactProjection } from '@smart-room/contracts/history';
import type { DurableUserHistoryItem } from '@smart-room/contracts/user-history';

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
        if (fact.eventType !== 'command.timed_out' || !deviceNames.has(fact.deviceId)) {
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
        const identity = {
            recordId: fact.recordId,
            occurredAt: fact.occurredAt,
            source: fact.source,
            durability: fact.durability,
            storageSequence: fact.storageSequence,
        };

        if (fact.eventType === 'storage.gap.recorded') {
            return [
                {
                    ...identity,
                    source: 'backend',
                    kind: 'history_gap',
                    outageStartedAt: fact.payload.outageStartedAt,
                    outageEndedAt: fact.payload.outageEndedAt,
                },
            ];
        }

        const deviceName = deviceNames.get(fact.deviceId);

        if (!deviceName) {
            return [];
        }

        const device = { deviceId: fact.deviceId, deviceName };

        if (fact.eventType === 'command.failed') {
            const requestedPower =
                fact.payload.commandType === 'set.power'
                    ? fact.payload.requestedState?.power
                    : undefined;

            return [
                {
                    ...identity,
                    ...device,
                    kind: 'attempt_failed',
                    ...(requestedPower ? { requestedPower } : {}),
                },
            ];
        }

        if (fact.eventType === 'command.timed_out') {
            const request = evidence.get(fact.deviceId)?.get(fact.commandId);

            return request?.kind === 'known'
                ? [
                      {
                          ...identity,
                          ...device,
                          kind: 'confirmation_missing',
                          requestedPower: request.power,
                      },
                  ]
                : [];
        }

        // Raw device payloads have no retained applied/before evidence.
        return [];
    });
}
