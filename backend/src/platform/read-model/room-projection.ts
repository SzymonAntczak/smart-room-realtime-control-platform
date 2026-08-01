import type {
    ActiveCommandProjection,
    DeviceHealth,
    DeviceProjection,
    DeviceRole,
    DeviceState,
    EventFeedItemProjection,
    PlatformEventEnvelope,
    PlatformEventType,
    TelemetryReadingRecordedEvent,
    TelemetryReadingRecordedPayload,
} from '@smart-room/contracts';

export interface DeviceDefinition {
    deviceId: string;
    name: string;
    role: DeviceRole;
}

export interface DeviceFreshnessThresholds {
    staleAfterMs: number;
    offlineAfterMs: number;
}

export type FreshnessThresholdsByRole = Partial<Record<DeviceRole, DeviceFreshnessThresholds>>;

export interface RoomProjectionConfig {
    devices: DeviceDefinition[];
    initialUpdatedAt: string;
    recentEventLimit?: number;
    freshnessThresholdsByRole?: FreshnessThresholdsByRole;
}

export interface ProjectionEvaluationOptions {
    evaluatedAt?: string;
}

export interface RoomProjection {
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: ActiveCommandProjection[];
    recentEvents: EventFeedItemProjection[];
}

export interface RoomProjector {
    applyTelemetryReadingRecorded(event: TelemetryReadingRecordedEvent): RoomProjection;
    getProjection(options?: ProjectionEvaluationOptions): RoomProjection;
}

export function createRoomProjector({
    devices,
    initialUpdatedAt,
    recentEventLimit = 50,
    freshnessThresholdsByRole = defaultFreshnessThresholdsByRole,
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

            recentEvents.unshift(toEventFeedItem(event));
            recentEvents.splice(recentEventLimit);

            const currentDevice = deviceProjections.get(device.deviceId);

            if (
                currentDevice?.lastSeenAt &&
                parseTimestamp(event.occurredAt, 'event.occurredAt') <=
                    parseTimestamp(currentDevice.lastSeenAt, 'device.lastSeenAt')
            ) {
                return buildProjection({
                    evaluatedAt: event.occurredAt,
                });
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

            return buildProjection({
                evaluatedAt: event.occurredAt,
            });
        },
        getProjection(options = {}) {
            return buildProjection({
                evaluatedAt: options.evaluatedAt ?? updatedAt,
            });
        },
    };

    function buildProjection({
        evaluatedAt,
    }: Required<ProjectionEvaluationOptions>): RoomProjection {
        return {
            updatedAt,
            devices: [...deviceProjections.values()].map((device) =>
                applyFreshnessHealth(device, evaluatedAt),
            ),
            activeCommands: [],
            recentEvents: [...recentEvents],
        };
    }

    function applyFreshnessHealth(device: DeviceProjection, evaluatedAt: string): DeviceProjection {
        if (!device.lastSeenAt) {
            return { ...device };
        }

        const thresholds = freshnessThresholdsByRole[device.role];

        if (!thresholds) {
            return { ...device };
        }

        return {
            ...device,
            health: deriveFreshnessHealth({
                lastSeenAt: device.lastSeenAt,
                evaluatedAt,
                thresholds,
            }),
        };
    }
}

const defaultFreshnessThresholdsByRole: FreshnessThresholdsByRole = {
    'temperature-sensor': {
        staleAfterMs: 2500,
        offlineAfterMs: 10000,
    },
};

function deriveFreshnessHealth({
    lastSeenAt,
    evaluatedAt,
    thresholds,
}: {
    lastSeenAt: string;
    evaluatedAt: string;
    thresholds: DeviceFreshnessThresholds;
}): DeviceHealth {
    const ageMs = Math.max(
        0,
        parseTimestamp(evaluatedAt, 'projection.evaluatedAt') -
            parseTimestamp(lastSeenAt, 'device.lastSeenAt'),
    );

    if (ageMs > thresholds.offlineAfterMs) {
        return 'offline';
    }

    if (ageMs > thresholds.staleAfterMs) {
        return 'stale';
    }

    return 'online';
}

function parseTimestamp(timestamp: string, fieldName: string): number {
    const parsed = Date.parse(timestamp);

    if (Number.isNaN(parsed)) {
        throw new Error(`Invalid timestamp for ${fieldName}: ${timestamp}`);
    }

    return parsed;
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
