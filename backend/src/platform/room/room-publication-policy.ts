import type {
    LiveTelemetrySampleProjection,
    RecentEventProjection,
} from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomPublicationDelta } from '@smart-room/contracts/realtime';

export function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The runtime, which owns the domain transition, also owns the semantic
 * description of that transition.  Keeping this out of the SSE adapter makes
 * a publication batch a real boundary: the BFF only numbers and serializes
 * already-decided deltas.
 */
export function buildPublicationDeltas(
    previous: RoomSnapshotProjection | undefined,
    next: RoomSnapshotProjection,
    platformBeforeOutcome: boolean,
    relatedRecentEvents: readonly RecentEventProjection[],
    telemetrySample?: LiveTelemetrySampleProjection,
): readonly RoomPublicationDelta[] {
    if (!previous) {
        return [];
    }

    const deltas: RoomPublicationDelta[] = [];
    const previousDevices = new Map(previous.devices.map((device) => [device.deviceId, device]));
    const commandDeviceIds = changedCommandDeviceIds(previous, next);

    const platformDelta = !sameJson(previous.platform, next.platform)
        ? {
              messageType: 'platform.updated' as const,
              payload: { storage: next.platform.storage },
          }
        : undefined;

    if (platformBeforeOutcome && platformDelta) {
        deltas.push(platformDelta);
    }

    for (const device of next.devices) {
        if (commandDeviceIds.has(device.deviceId)) {
            continue;
        }

        const deviceEvents = relatedRecentEvents.filter(
            (event) => 'deviceId' in event && event.deviceId === device.deviceId,
        );
        const deviceTelemetry =
            telemetrySample?.deviceId === device.deviceId ? telemetrySample : undefined;
        const deviceChanged = !sameJson(previousDevices.get(device.deviceId), device);

        if (deviceChanged || deviceEvents.length > 0 || deviceTelemetry) {
            deltas.push({
                messageType: 'device.updated',
                payload: device,
                ...(deviceEvents.length > 0 ? { recentEvents: deviceEvents } : {}),
                ...(deviceTelemetry ? { telemetrySample: deviceTelemetry } : {}),
            });
        }
    }

    if (commandDeviceIds.size > 0) {
        deltas.push({
            messageType: 'commands.updated',
            payload: {
                devices: next.devices,
                activeCommands: next.activeCommands,
                recentCommands: next.recentCommands,
                ...(relatedRecentEvents.length > 0
                    ? { recentEvents: [...relatedRecentEvents] }
                    : {}),
            },
        });
    }

    if (!platformBeforeOutcome && platformDelta) {
        deltas.push(platformDelta);
    }

    return deltas;
}

export function changedCommandDeviceIds(
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
): Set<string> {
    const previousCommands = new Map(
        [...previous.activeCommands, ...previous.recentCommands].map((command) => [
            command.commandId,
            command,
        ]),
    );
    const nextCommands = new Map(
        [...next.activeCommands, ...next.recentCommands].map((command) => [
            command.commandId,
            command,
        ]),
    );
    const deviceIds = new Set<string>();

    for (const commandId of new Set([...previousCommands.keys(), ...nextCommands.keys()])) {
        const before = previousCommands.get(commandId);
        const after = nextCommands.get(commandId);

        if (!sameJson(before, after)) {
            if (before) {
                deviceIds.add(before.deviceId);
            }

            if (after) {
                deviceIds.add(after.deviceId);
            }
        }
    }

    return deviceIds;
}
