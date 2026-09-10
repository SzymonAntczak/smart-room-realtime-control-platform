import { describe, expect, it } from 'vitest';

import { recentEventProjectionSchema } from './history';
import {
    commandDurabilitySchema,
    evidenceDurabilitySchema,
    recordDurabilitySchema,
    recordIdSchema,
} from './storage';
import { isSchema } from './validation';

const recordId = `rec:v1:sha256:${'a'.repeat(64)}`;

describe('storage identity contracts', () => {
    it('accepts only the versioned SHA-256 logical record ID format', () => {
        expect(isSchema(recordIdSchema, recordId)).toBe(true);
        expect(isSchema(recordIdSchema, 'platform:storage-gap:legacy')).toBe(false);
        expect(isSchema(recordIdSchema, `rec:v1:sha256:${'A'.repeat(64)}`)).toBe(false);
    });

    it('keeps record, command and evidence durability in one closed vocabulary', () => {
        for (const schema of [recordDurabilitySchema, commandDurabilitySchema, evidenceDurabilitySchema]) {
            expect(isSchema(schema, 'durable')).toBe(true);
            expect(isSchema(schema, 'volatile')).toBe(true);
            expect(isSchema(schema, 'unknown')).toBe(false);
        }
    });

    it('requires a durable sequence and forbids one for a volatile record', () => {
        const durable = {
            recordId,
            occurredAt: '2026-09-10T10:00:00.000Z',
            durability: 'durable',
            storageSequence: 1,
            deviceId: 'led-main',
            source: 'simulator-adapter',
            eventType: 'device.state.reported',
            payload: { reportedState: { power: 'on' } },
        };

        expect(isSchema(recentEventProjectionSchema, durable)).toBe(true);
        expect(isSchema(recentEventProjectionSchema, { ...durable, storageSequence: 0 })).toBe(false);
        expect(isSchema(recentEventProjectionSchema, { ...durable, durability: 'volatile' })).toBe(false);
        const volatile = Object.fromEntries(
            Object.entries(durable).filter(([key]) => key !== 'storageSequence'),
        );
        expect(isSchema(recentEventProjectionSchema, { ...volatile, durability: 'volatile' })).toBe(true);
    });
});
