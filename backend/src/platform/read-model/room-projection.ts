import type { CommandProjection } from '../../../../shared/src/commands';
import type { DeviceRole, DeviceState } from '../../../../shared/src/devices';
import type { DeviceProjection, EventFeedItemProjection } from '../../../../shared/src/projections';
import type {
    PlatformEventEnvelope,
    PlatformEventType,
    TelemetryReadingRecordedEvent,
    TelemetryReadingRecordedPayload,
} from '../../../../shared/src/events';

export interface DeviceDefinition {
    deviceId: string;
    name: string;
    role: DeviceRole;
}

export interface RoomProjectionConfig {
    devices: DeviceDefinition[];
    initialUpdatedAt: string;
}

export interface RoomProjection {
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: CommandProjection[];
    recentEvents: EventFeedItemProjection[];
}

export interface RoomProjector {
    applyTelemetryReadingRecorded(event: TelemetryReadingRecordedEvent): RoomProjection;
    getProjection(): RoomProjection;
}

export function createRoomProjector({
    devices,
    initialUpdatedAt,
}: RoomProjectionConfig): RoomProjector {
    const deviceDefinitions = new Map(devices.map((device) => [device.deviceId, device]));
    const deviceProjections = new Map<string, DeviceProjection>();
    const recentEvents: EventFeedItemProjection[] = [];
    let updatedAt = initialUpdatedAt;

    return {
        applyTelemetryReadingRecorded(event) {
            const device = deviceDefinitions.get(event.deviceId);

            if (!device) {
                throw new Error(`Cannot project telemetry for unknown device: ${event.deviceId}`);
            }

            updatedAt = event.occurredAt;
            deviceProjections.set(device.deviceId, {
                deviceId: device.deviceId,
                name: device.name,
                role: device.role,
                health: 'online',
                reportedState: toTemperatureReportedState(event.payload),
                commandAvailability: {
                    policy: 'block',
                    reason: 'read_only_device',
                },
                lastSeenAt: event.occurredAt,
            });
            recentEvents.unshift(toEventFeedItem(event));

            return buildProjection();
        },
        getProjection() {
            return buildProjection();
        },
    };

    function buildProjection(): RoomProjection {
        return {
            updatedAt,
            devices: [...deviceProjections.values()],
            activeCommands: [],
            recentEvents: [...recentEvents],
        };
    }
}

function toTemperatureReportedState(payload: TelemetryReadingRecordedPayload): DeviceState {
    return {
        temperature: payload.value,
        temperatureUnit: payload.unit,
    };
}

function toEventFeedItem(event: PlatformEventEnvelope<PlatformEventType>): EventFeedItemProjection {
    return {
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        source: event.source,
        deviceId: event.deviceId,
        commandId: event.commandId,
        summary: 'Temperature reading recorded',
    };
}
