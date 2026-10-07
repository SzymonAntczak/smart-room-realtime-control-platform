import type { UserHistoryPageQuery } from '@smart-room/contracts/user-history';

import { type HistoryResponseResult, validateHistoryResponse } from './history-response';

interface HistoryPageQuery {
    pageSize: number;
    cursor: string | null;
    deviceId?: UserHistoryPageQuery['deviceId'];
    from?: UserHistoryPageQuery['from'];
    to?: UserHistoryPageQuery['to'];
}

export interface HistoryClient {
    readPage(query: HistoryPageQuery, signal?: AbortSignal): Promise<HistoryResponseResult>;
}

export function createHistoryClient(fetchImplementation: typeof fetch = fetch): HistoryClient {
    return {
        async readPage({ pageSize, cursor, deviceId, from, to }, signal) {
            const url = new URL(
                '/room/history/user-history',
                (import.meta.env.VITE_BFF_URL ?? 'http://localhost:4310').replace(/\/+$/u, ''),
            );
            url.searchParams.set('pageSize', String(pageSize));

            if (cursor !== null) {
                url.searchParams.set('cursor', cursor);
            }

            if (deviceId !== undefined) {
                url.searchParams.set('deviceId', deviceId);
            }

            if (from !== undefined) {
                url.searchParams.set('from', from);
            }

            if (to !== undefined) {
                url.searchParams.set('to', to);
            }

            const response = await fetchImplementation(url.toString(), { signal });
            let body: unknown;

            try {
                body = await response.json();
            } catch {
                return { kind: 'invalid_response' };
            }

            return validateHistoryResponse(response.status, body);
        },
    };
}
