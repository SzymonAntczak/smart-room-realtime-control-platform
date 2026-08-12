import { describe, expect, it } from 'vitest';

import {
    apiErrorResponseSchema,
    deviceScenarioListSchema,
    deviceScenarioParamsSchema,
    deviceScenarioRequestSchema,
    deviceScenarioResultSchema,
    eventProcessingDiagnosticsSnapshotSchema,
} from './development';
import { isSchema } from './validation';

describe('development transport schemas', () => {
    it('rejects undocumented fields in scenario requests and responses', () => {
        expect(isSchema(deviceScenarioRequestSchema, { action: 'reset', legacy: true })).toBe(
            false,
        );
        expect(isSchema(deviceScenarioParamsSchema, { deviceId: 'temp-desk', legacy: true })).toBe(
            false,
        );
        expect(
            isSchema(deviceScenarioListSchema, {
                deviceId: 'temp-desk',
                scenarios: [{ action: 'reset', legacy: true }],
            }),
        ).toBe(false);
        expect(
            isSchema(deviceScenarioResultSchema, {
                action: 'reset',
                status: 'completed',
                legacy: true,
            }),
        ).toBe(false);
        expect(
            isSchema(apiErrorResponseSchema, {
                error: 'invalid_request',
                message: 'Invalid.',
                legacy: true,
            }),
        ).toBe(false);
    });

    it('rejects undocumented fields in diagnostics snapshots', () => {
        expect(
            isSchema(eventProcessingDiagnosticsSnapshotSchema, {
                ignoredEvents: [
                    {
                        diagnosticId: 'diag-1',
                        reason: 'malformed_event',
                        observedAt: '2026-06-08T09:30:00Z',
                        legacy: true,
                    },
                ],
            }),
        ).toBe(false);
        expect(
            isSchema(eventProcessingDiagnosticsSnapshotSchema, {
                ignoredEvents: [],
                deduplicationEvictions: [
                    {
                        diagnosticId: 'diag-1',
                        evictedEventId: 'evt-1',
                        observedAt: '2026-06-08T09:30:00Z',
                        legacy: true,
                    },
                ],
            }),
        ).toBe(false);
    });
});
