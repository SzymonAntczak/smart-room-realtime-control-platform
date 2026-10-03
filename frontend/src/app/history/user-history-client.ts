import {
    type HistoryCursorErrorResponse,
    isHistoryCursorErrorResponse,
} from '@smart-room/contracts/history';
import {
    type DurableHistoryUnavailableResponse,
    isDurableHistoryUnavailableResponse,
    isUserHistoryPage,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';

export type UserHistoryResponseResult =
    | { kind: 'page'; page: UserHistoryPage }
    | { kind: 'cursor_error'; error: HistoryCursorErrorResponse }
    | { kind: 'unavailable'; error: DurableHistoryUnavailableResponse }
    | { kind: 'invalid_response' };

/** Validates decoded data at the user-history HTTP boundary. */
export function validateUserHistoryResponse(
    status: number,
    value: unknown,
): UserHistoryResponseResult {
    if (status === 200 && isUserHistoryPage(value)) {
        return { kind: 'page', page: value };
    }

    if (status === 400 && isHistoryCursorErrorResponse(value)) {
        return { kind: 'cursor_error', error: value };
    }

    if (status === 503 && isDurableHistoryUnavailableResponse(value)) {
        return { kind: 'unavailable', error: value };
    }

    return { kind: 'invalid_response' };
}
