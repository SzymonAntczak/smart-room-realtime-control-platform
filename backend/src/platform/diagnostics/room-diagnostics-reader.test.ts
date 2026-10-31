import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isDurableDiagnosticsSnapshot } from '@smart-room/contracts/diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QuarantineEntryInput, RoomStorage } from '../storage/room-storage';
import { createSqliteRoomStorage } from '../storage/sqlite-room-storage';
import { StorageAvailabilityError } from '../storage/storage-errors';

import { createRoomDiagnosticsReader } from './room-diagnostics-reader';

const disposers: Array<() => void> = [];
const at = '2026-09-10T10:00:00.000Z';
afterEach(() => {
    for (const dispose of disposers.splice(0).reverse()) {
        dispose();
    }
});

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-diagnostics-'));
    disposers.push(() => rmSync(directory, { recursive: true, force: true }));
    const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
    disposers.push(() => storage.close());
    let now = at;
    const reader = createRoomDiagnosticsReader({ storage, now: () => now });

    return {
        storage,
        reader,
        setNow(value: string) {
            now = value;
        },
        append(entries: QuarantineEntryInput[]) {
            expect(
                storage.transact(
                    (tx) => {
                        for (const entry of entries) {
                            tx.appendQuarantineEntry(entry);
                        }
                    },
                    { retentionAsOf: now },
                ).status,
            ).toBe('committed');
        },
    };
}

describe('persisted quarantine diagnostics reader', () => {
    it('returns the database generation for an empty retained dataset', () => {
        const { storage, reader } = fixture();
        expect(reader.readDiagnosticsSnapshot()).toEqual({
            status: 'available',
            value: {
                historyGenerationId: storage.getMetadata().historyGenerationId,
                entries: [],
            },
        });
    });

    it('projects only allowlisted string metadata and normalizes optional timestamps', () => {
        const { append, reader } = fixture();
        append([
            {
                eventId: 'event-1',
                reason: 'invalid_payload',
                recordedAt: at,
                rawEvent: {
                    eventType: 'telemetry.reading.recorded',
                    source: 'simulator-adapter',
                    deviceId: 'temp-desk',
                    commandId: 'command-1',
                    occurredAt: '2026-09-10T12:00:00+02:00',
                    payload: { secret: 'do-not-expose' },
                    extra: 'do-not-expose',
                },
            },
            {
                reason: 'malformed_event',
                recordedAt: at,
                rawEvent: {
                    eventType: 4,
                    source: null,
                    deviceId: {},
                    commandId: [],
                    occurredAt: 'invalid',
                },
            },
            { reason: 'malformed_event', recordedAt: at, rawEvent: null },
        ]);
        const result = reader.readDiagnosticsSnapshot();
        expect(result).toEqual({
            status: 'available',
            value: {
                historyGenerationId: expect.any(String),
                entries: [
                    { internalSequence: 3, reason: 'malformed_event', recordedAt: at },
                    { internalSequence: 2, reason: 'malformed_event', recordedAt: at },
                    {
                        internalSequence: 1,
                        reason: 'invalid_payload',
                        recordedAt: at,
                        eventId: 'event-1',
                        eventType: 'telemetry.reading.recorded',
                        source: 'simulator-adapter',
                        deviceId: 'temp-desk',
                        commandId: 'command-1',
                        occurredAt: '2026-09-10T10:00:00Z',
                    },
                ],
            },
        });

        if (result.status !== 'available') {
            throw new Error('Expected diagnostics');
        }

        expect(isDurableDiagnosticsSnapshot(result.value)).toBe(true);
        expect(JSON.stringify(result.value)).not.toMatch(/"rawEvent"|"payload"|do-not-expose/);
    });

    it('retains the greatest 1000 entries and orders timestamp ties by descending sequence', () => {
        const { append, reader, storage } = fixture();
        append(
            Array.from({ length: 1001 }, (_, index) => ({
                reason: 'duplicate_event',
                recordedAt: index === 1000 ? '2026-09-10T09:00:00.000Z' : at,
                rawEvent: {},
            })),
        );
        const before = storage.getMetadata().lastStorageSequence;
        const result = reader.readDiagnosticsSnapshot();

        if (result.status !== 'available') {
            throw new Error('Expected diagnostics');
        }

        expect(isDurableDiagnosticsSnapshot(result.value)).toBe(true);
        expect(result.value.entries).toHaveLength(1000);
        expect(result.value.entries.map((entry) => entry.internalSequence)).toEqual(
            Array.from({ length: 1000 }, (_, index) => 1000 - index),
        );
        expect(storage.getMetadata().lastStorageSequence).toBe(before);
        expect(storage.listSignificantFacts()).toEqual([]);
        expect(storage.listQuarantineEntries().at(0)?.internalSequence).toBe(1);
    });

    it('orders retained entries by recorded time before sequence', () => {
        const { append, reader } = fixture();
        append([
            { reason: 'duplicate_event', recordedAt: at, rawEvent: {} },
            { reason: 'duplicate_event', recordedAt: '2026-09-10T09:00:00.000Z', rawEvent: {} },
            { reason: 'duplicate_event', recordedAt: at, rawEvent: {} },
        ]);
        const result = reader.readDiagnosticsSnapshot();

        if (result.status !== 'available') {
            throw new Error('Expected diagnostics');
        }

        expect(result.value.entries.map((entry) => entry.internalSequence)).toEqual([3, 1, 2]);
    });

    it('retires expired entries before an idle read while keeping the exact 30-day boundary', () => {
        const { append, reader, setNow } = fixture();
        append([
            { reason: 'duplicate_event', recordedAt: at, rawEvent: {} },
            { reason: 'duplicate_event', recordedAt: '2026-09-10T10:00:00.001Z', rawEvent: {} },
        ]);
        setNow('2026-10-10T10:00:00.001Z');
        const result = reader.readDiagnosticsSnapshot();
        expect(result).toMatchObject({
            status: 'available',
            value: { entries: [{ internalSequence: 2, recordedAt: '2026-09-10T10:00:00.001Z' }] },
        });
        setNow(at);
        expect(reader.readDiagnosticsSnapshot()).toEqual(result);
    });

    it.each(['confirmed_rolled_back', 'indeterminate'] as const)(
        'preserves the %s transaction failure for runtime classification',
        (status) => {
            const { storage, reader } = fixture();
            const error = new StorageAvailabilityError('unavailable', null);
            vi.spyOn(storage, 'transact').mockReturnValue({ status, error });
            expect(reader.readDiagnosticsSnapshot()).toEqual({
                status: 'unavailable',
                failure: status,
                error,
            });
        },
    );

    it('rejects invalid required persisted metadata instead of silently dropping it', () => {
        const { storage, reader } = fixture();
        const transact = storage.transact.bind(storage);
        vi.spyOn(storage, 'transact').mockImplementation(
            (operation, options) =>
                transact(
                    (tx) =>
                        operation({
                            ...tx,
                            listQuarantineEntries: () => [
                                {
                                    internalSequence: 1,
                                    reason: 'undocumented',
                                    recordedAt: at,
                                    rawEvent: {},
                                },
                            ],
                        }),
                    options,
                ) as ReturnType<RoomStorage['transact']>,
        );
        expect(reader.readDiagnosticsSnapshot()).toEqual({ status: 'invalid_internal_data' });
    });
});
