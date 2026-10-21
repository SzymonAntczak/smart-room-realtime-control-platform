import type { DeviceProjection } from '@smart-room/contracts/projections';
import type { RoomBffSnapshot } from '@smart-room/contracts/room-bff';

import { useRoomConnection } from '../../features/room';

import type { RenderableDeviceProjection } from './device-projection';

export interface RenderableRoomSnapshot extends Omit<RoomBffSnapshot, 'devices'> {
    readonly devices: RenderableDeviceProjection[];
}

function toRenderableRoomSnapshot(snapshot: RoomBffSnapshot): RenderableRoomSnapshot {
    return {
        ...snapshot,
        devices: snapshot.devices.flatMap((device) => {
            const renderableDevice = toRenderableDeviceProjection(device);

            return renderableDevice ? [renderableDevice] : [];
        }),
    };
}

function toRenderableDeviceProjection(
    device: DeviceProjection,
): RenderableDeviceProjection | undefined {
    switch (device.role) {
        case 'led-output': {
            const power = device.reportedState.power;

            if (power !== undefined && power !== 'on' && power !== 'off') {
                throw new Error('LED data did not match the expected rendering contract.');
            }

            return {
                ...device,
                role: 'led-output',
                reportedState: {
                    ...device.reportedState,
                    ...(power === undefined ? {} : { power }),
                },
            };
        }

        case 'temperature-sensor': {
            const observation = device.observationStatus.temperature;
            const temperature = device.reportedState.temperature;
            const temperatureUnit = device.reportedState.temperatureUnit;
            const hasTemperatureState = temperature !== undefined || temperatureUnit !== undefined;

            if (
                !observation ||
                (hasTemperatureState &&
                    (typeof temperature !== 'number' ||
                        temperatureUnit !== 'celsius' ||
                        observation.lastObservedAt === undefined))
            ) {
                throw new Error(
                    'Temperature sensor data did not match the expected rendering contract.',
                );
            }

            return {
                ...device,
                role: 'temperature-sensor',
                observationStatus: { ...device.observationStatus, temperature: observation },
            };
        }

        default:
            return undefined;
    }
}

export function useRoom() {
    const { room, historySource } = useRoomConnection();

    return {
        room:
            room.status === 'ready'
                ? { ...room, snapshot: toRenderableRoomSnapshot(room.snapshot) }
                : room,
        historySource,
    };
}
