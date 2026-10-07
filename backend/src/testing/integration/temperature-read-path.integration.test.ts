import type { TemperatureReadingMessage } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { createBackendIntegrationRuntime } from './backend-integration-runtime';

describe('temperature native source through backend HTTP and SSE', () => {
    it('accepts different native devices with the same message id', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        const message: TemperatureReadingMessage = {
            messageId: 'shared-message',
            messageType: 'temperature.reading',
            sensorId: 'temp-desk-native',
            sequence: 10,
            value: 20,
            unit: 'celsius',
            recordedAt: backend.clock.now(),
        };
        backend.sources.desk.emitReading(message);
        backend.sources.window.emitReading({
            ...message,
            sensorId: 'temp-window-native',
            value: 21,
        });
        const snapshot = await backend.snapshot();
        expect(
            snapshot.devices.find((device) => device.deviceId === 'temp-desk')?.reportedState
                .temperature,
        ).toBe(20);
        expect(
            snapshot.devices.find((device) => device.deviceId === 'temp-window')?.reportedState
                .temperature,
        ).toBe(21);
        expect((await backend.request('/diagnostics')).body).toMatchObject({ ignoredEvents: [] });
    });

    it('projects native temperature into a validated HTTP snapshot and SSE delta', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        const stream = await backend.connectSse();
        backend.clock.advanceBy(1);
        backend.sources.desk.read(22.5, backend.clock.now());
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            reportedState: { temperature: 22.5, temperatureUnit: 'celsius' },
            observationStatus: {
                temperature: { freshness: 'fresh', lastObservedAt: backend.clock.now() },
            },
        });
        expect(
            await stream.waitFor((message) => message.messageType === 'device.updated'),
        ).toMatchObject({
            messageType: 'device.updated',
            payload: { deviceId: 'temp-desk', reportedState: { temperature: 22.5 } },
        });
    });

    it('updates the current HTTP projection for successive native readings', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        backend.sources.desk.read(22.5, backend.clock.now());
        backend.clock.advanceBy(1000);
        backend.sources.desk.read(22.7, backend.clock.now());
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk')
                ?.reportedState,
        ).toEqual({
            temperature: 22.7,
            temperatureUnit: 'celsius',
        });
    });

    it('ignores repeated identities even when the duplicate changes its value', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        const reading = backend.sources.desk.read(22.5, backend.clock.now());
        backend.sources.desk.emitReading({ ...reading, value: 22.7 });
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk')
                ?.reportedState.temperature,
        ).toBe(22.5);
        expect((await backend.request('/diagnostics')).body).toMatchObject({
            ignoredEvents: expect.arrayContaining([
                expect.objectContaining({ reason: 'event_identity_conflict' }),
            ]),
        });
    });

    it('keeps the last observation and availability while freshness becomes stale', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        const stream = await backend.connectSse();
        backend.sources.desk.read(22.5, backend.clock.now());
        backend.clock.advanceBy(3001);
        backend.evaluateFreshness();
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            availability: 'online',
            reportedState: { temperature: 22.5 },
            observationStatus: { temperature: { freshness: 'stale' } },
        });
        expect(
            await stream.waitFor(
                (message) =>
                    message.messageType === 'device.updated' &&
                    message.payload.observationStatus.temperature?.freshness === 'stale',
            ),
        ).toMatchObject({
            payload: { availability: 'online', reportedState: { temperature: 22.5 } },
        });
    });

    it('recovers freshness only after a fresh native observation', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        backend.sources.desk.read(22.5, backend.clock.now());
        backend.clock.advanceBy(10001);
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk')
                ?.observationStatus.temperature?.freshness,
        ).toBe('stale');
        backend.sources.desk.read(22.8, backend.clock.now());
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            reportedState: { temperature: 22.8 },
            observationStatus: { temperature: { freshness: 'fresh' } },
        });
    });

    it('rejects a replay of the last native reading without replacing accepted state', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        backend.sources.desk.read(22.5, backend.clock.now());
        backend.sources.desk.scenario.replayLastReading();
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk')
                ?.reportedState.temperature,
        ).toBe(22.5);
        expect((await backend.request('/diagnostics')).body).toMatchObject({
            ignoredEvents: expect.arrayContaining([
                expect.objectContaining({ reason: 'duplicate_event' }),
            ]),
        });
    });

    it('rejects invalid telemetry and exposes its diagnostic through HTTP', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        backend.sources.desk.read(22.5, backend.clock.now());
        backend.sources.desk.scenario.emitInvalidReading(backend.clock.now());
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk')
                ?.reportedState.temperature,
        ).toBe(22.5);
        expect((await backend.request('/diagnostics')).body).toMatchObject({
            ignoredEvents: expect.arrayContaining([
                expect.objectContaining({ reason: 'invalid_payload' }),
            ]),
        });
    });

    it('keeps native availability, health and observation freshness independent', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        backend.sources.desk.read(22.5, backend.clock.now());
        backend.sources.desk.scenario.reportHealth('degraded', 'sensor_fault', backend.clock.now());
        backend.sources.desk.scenario.disconnect(backend.clock.now());
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            availability: 'offline',
            health: 'degraded',
            reportedState: { temperature: 22.5 },
            observationStatus: { temperature: { freshness: 'fresh' } },
        });
        backend.clock.advanceBy(3001);
        backend.sources.desk.scenario.reconnect(backend.clock.now());
        expect(
            (await backend.snapshot()).devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            availability: 'online',
            health: 'degraded',
            observationStatus: { temperature: { freshness: 'stale' } },
        });
    });
});
