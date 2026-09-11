import type { PlatformEvent } from '@smart-room/contracts/events';
import { describe, expect, it } from 'vitest';

import { derivedCommandRecordId, logicalRecordId, platformRecordId } from './event-identity';

describe('event record identity', () => {
    it('keeps logical input record IDs stable while separating record kinds and sources', () => {
        const event = {
            eventId: 'native-reading-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-06-08T09:30:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
        } satisfies PlatformEvent;

        expect(logicalRecordId(event, 'telemetry')).toBe(logicalRecordId(event, 'telemetry'));
        expect(logicalRecordId(event, 'telemetry')).not.toBe(logicalRecordId(event, 'input_fact'));
        expect(logicalRecordId(event, 'telemetry')).not.toBe(
            logicalRecordId({ ...event, source: 'hardware-adapter' }, 'telemetry'),
        );
    });

    it('keeps derived command IDs stable while separating lifecycle kinds', () => {
        expect(derivedCommandRecordId('command-1', 'confirmed')).toBe(
            derivedCommandRecordId('command-1', 'confirmed'),
        );
        expect(derivedCommandRecordId('command-1', 'confirmed')).not.toBe(
            derivedCommandRecordId('command-1', 'timed_out'),
        );
        expect(derivedCommandRecordId('command-1', 'confirmed')).not.toBe(
            derivedCommandRecordId('command-2', 'confirmed'),
        );
    });

    it('gives platform records the same versioned ID family while separating operations', () => {
        expect(platformRecordId('storage.gap.recorded', 'gap-1')).toMatch(
            /^rec:v1:sha256:[a-f0-9]{64}$/,
        );
        expect(platformRecordId('storage.gap.recorded', 'gap-1')).toBe(
            platformRecordId('storage.gap.recorded', 'gap-1'),
        );
        expect(platformRecordId('storage.gap.recorded', 'gap-1')).not.toBe(
            platformRecordId('storage.gap.recorded', 'gap-2'),
        );
    });
});
