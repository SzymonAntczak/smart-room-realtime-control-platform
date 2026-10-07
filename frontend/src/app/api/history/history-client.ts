import { type HistoryResponseResult, validateHistoryResponse } from './history-response';

interface HistoryPageQuery {
    pageSize: number;
    cursor: string | null;
}

export interface HistoryClient {
    readPage(query: HistoryPageQuery, signal?: AbortSignal): Promise<HistoryResponseResult>;
}

export function createHistoryClient(fetchImplementation: typeof fetch = fetch): HistoryClient {
    return {
        async readPage({ pageSize, cursor }, signal) {
            const url = new URL(
                '/room/history/user-history',
                (import.meta.env.VITE_BFF_URL ?? 'http://localhost:4310').replace(/\/+$/u, ''),
            );
            url.searchParams.set('pageSize', String(pageSize));

            if (cursor !== null) {
                url.searchParams.set('cursor', cursor);
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
