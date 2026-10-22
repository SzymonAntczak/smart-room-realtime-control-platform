import { describe, expect, it } from 'vitest';

import { getDeviceDisplayName } from './device-display-name';

describe('getDeviceDisplayName', () => {
    it.each([
        ['led-main', 'Main LED', 'devices.ledMain'],
        ['temp-desk', 'Desk Temperature', 'devices.temperatureDesk'],
        ['temp-window', 'Window Temperature', 'devices.temperatureWindow'],
    ])('translates the name key for the known %s device', (deviceId, name, expectedKey) => {
        expect(getDeviceDisplayName({ deviceId, name }, (key) => `translated:${key}`)).toBe(
            `translated:${expectedKey}`,
        );
    });

    it('keeps the backend name for an unknown device', () => {
        expect(
            getDeviceDisplayName(
                { deviceId: 'humidity-desk', name: 'Humidity sensor' },
                (key) => `translated:${key}`,
            ),
        ).toBe('Humidity sensor');
    });
});
