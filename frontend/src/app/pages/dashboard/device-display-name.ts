import type { DeviceProjection } from '@smart-room/contracts/projections';

const deviceNameKeyById = {
    'led-main': 'devices.ledMain',
    'temp-desk': 'devices.temperatureDesk',
    'temp-window': 'devices.temperatureWindow',
} as const;

type DeviceNameKey = (typeof deviceNameKeyById)[keyof typeof deviceNameKeyById];

export function getDeviceDisplayName(
    device: Pick<DeviceProjection, 'deviceId' | 'name'>,
    translate: (key: DeviceNameKey) => string,
): string {
    const key = deviceNameKeyById[device.deviceId as keyof typeof deviceNameKeyById];

    return key ? translate(key) : device.name;
}
