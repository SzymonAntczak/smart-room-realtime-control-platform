import { describe, expect, it } from 'vitest';

import { getDeviceDisplayName } from './device-presentation';

const translations = {
    'devices.ledMain': 'Główne LED',
    'devices.temperatureDesk': 'Temperatura biurka',
    'devices.temperatureWindow': 'Temperatura okna',
} as const;

describe('getDeviceDisplayName', () => {
    it.each([
        ['led-main', 'Main LED', 'Główne LED'],
        ['temp-desk', 'Desk Temperature', 'Temperatura biurka'],
        ['temp-window', 'Window Temperature', 'Temperatura okna'],
    ])('uses the Polish label for the known %s device', (deviceId, name, expectedName) => {
        expect(getDeviceDisplayName({ deviceId, name }, (key) => translations[key])).toBe(
            expectedName,
        );
    });

    it('keeps the backend name for an unknown device', () => {
        expect(
            getDeviceDisplayName(
                { deviceId: 'humidity-desk', name: 'Humidity sensor' },
                (key) => translations[key],
            ),
        ).toBe('Humidity sensor');
    });
});
