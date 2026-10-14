import {
    acceptedCommandResponseSchema,
    rejectedCommandResponseSchema,
} from '@smart-room/contracts/commands';
import {
    activeCommandProjectionSchema,
    terminalCommandProjectionSchema,
} from '@smart-room/contracts/projections';
import { isSchema } from '@smart-room/contracts/validation';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
    createConfirmedCommand,
    createPendingCommand,
} from '../../../../../test/room/room-realtime-fixtures';
import type { LedCommandEvidence } from '../led-card-view-model';

import { CommandEvidence } from './CommandEvidence';

describe('CommandEvidence', () => {
    it.each([
        {
            intent: 'durable',
            lifecycle: 'volatile',
            expected: 'Status polecenia',
            absent: 'Zlecenie',
        },
        {
            intent: 'volatile',
            lifecycle: 'durable',
            expected: 'Zlecenie',
            absent: 'Status polecenia',
        },
    ] as const)(
        'keeps intent $intent separate from lifecycle $lifecycle',
        ({ intent, lifecycle, expected, absent }) => {
            const command = {
                ...createConfirmedCommand(),
                durability: intent,
                lifecycleDurability: lifecycle,
            };
            expect(isSchema(terminalCommandProjectionSchema, command)).toBe(true);
            render(<CommandEvidence evidence={{ context: 'recent', command }} />);
            const group = within(screen.getByRole('group', { name: 'Ostatni wynik polecenia' }));
            expect(group.getByText(`${expected} — dane nieutrwalone`)).toBeInTheDocument();
            expect(group.queryByText(`${absent} — dane nieutrwalone`)).toBeNull();
            expect(group.getByText('Potwierdzone.')).toBeInTheDocument();
            expect(screen.queryByText(command.commandId)).toBeNull();
        },
    );

    it.each(['handed_off', 'uncertain'] as const)(
        'describes %s delivery separately from durable evidence',
        (status) => {
            const command = {
                ...createPendingCommand(),
                delivery:
                    status === 'handed_off'
                        ? {
                              status,
                              dispatchedAt: '2026-06-08T09:30:01Z',
                              deadlineAt: '2026-06-08T09:30:06Z',
                          }
                        : {
                              status,
                              firstAttemptedAt: '2026-06-08T09:30:01Z',
                              deadlineAt: '2026-06-08T09:30:06Z',
                          },
            };
            expect(isSchema(activeCommandProjectionSchema, command)).toBe(true);
            render(<CommandEvidence evidence={{ context: 'active', command }} />);
            expect(
                screen.getByText(
                    status === 'handed_off'
                        ? 'Polecenie przekazano do wysłania.'
                        : 'Nie wiadomo, czy polecenie zostało przekazane do wysłania.',
                ),
            ).toBeInTheDocument();
            expect(screen.queryByText(/dane nieutrwalone/)).toBeNull();
        },
    );

    it.each(['accepted', 'rejected'] as const)(
        'labels %s HTTP admission without claiming current execution',
        (status) => {
            const evidence: LedCommandEvidence = {
                context: 'admission',
                command:
                    status === 'accepted'
                        ? {
                              commandId: 'cmd-http',
                              status,
                              durability: 'volatile',
                              lifecycleDurability: 'volatile',
                          }
                        : {
                              commandId: 'cmd-http',
                              status,
                              reason: 'device_offline',
                              message: 'Device is offline.',
                              durability: 'volatile',
                              lifecycleDurability: 'volatile',
                          },
            };
            expect(
                isSchema(
                    status === 'accepted'
                        ? acceptedCommandResponseSchema
                        : rejectedCommandResponseSchema,
                    evidence.command,
                ),
            ).toBe(true);
            render(<CommandEvidence evidence={evidence} />);
            expect(
                screen.getByRole('group', { name: 'Wynik przyjęcia żądania' }),
            ).toHaveTextContent(
                status === 'accepted'
                    ? 'To wynik przyjęcia, a nie bieżący status wykonania.'
                    : 'Żądanie odrzucono.',
            );
            expect(screen.getAllByText(/dane nieutrwalone/)).toHaveLength(2);
            expect(screen.queryByText(/przekazano do wysłania/)).toBeNull();
        },
    );
});
