import {
    type AcceptedCommandResponse,
    acceptedCommandResponseSchema,
    type RejectedCommandResponse,
    rejectedCommandResponseSchema,
    type SetPowerCommandRequest,
    setPowerCommandRequestSchema,
} from '@smart-room/contracts/commands';
import { isSchema } from '@smart-room/contracts/validation';

const defaultCommandUrl = 'http://localhost:4310/room/commands';

export type LedCommandResponse = AcceptedCommandResponse | RejectedCommandResponse;

export async function submitLedPowerCommand(
    request: SetPowerCommandRequest,
    fetchImplementation: typeof fetch = fetch,
): Promise<LedCommandResponse> {
    if (!isSchema(setPowerCommandRequestSchema, request)) {
        throw new Error('LED command did not match the command contract.');
    }

    const response = await fetchImplementation(getCommandUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => undefined);

    if (response.status === 202 && isSchema(acceptedCommandResponseSchema, body)) return body;
    if (
        (response.status === 409 || response.status === 422) &&
        isSchema(rejectedCommandResponseSchema, body)
    )
        return body;
    throw new Error('Room command service returned an invalid response.');
}

function getCommandUrl(): string {
    return import.meta.env.VITE_ROOM_COMMAND_URL ?? defaultCommandUrl;
}
