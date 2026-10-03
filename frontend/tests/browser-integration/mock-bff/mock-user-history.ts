import { isHistoryCursorErrorResponse } from '@smart-room/contracts/history';
import {
    isDurableHistoryUnavailableResponse,
    isUserHistoryPage,
    normalizeUserHistoryPageQuery,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';

export interface MockHistoryResponse {
    status: number;
    body: unknown;
}

/** Scripted frontend-facing responses, not an implementation of production history. */
export class MockUserHistory {
    #pages: UserHistoryPage[] = [];
    #nextError: MockHistoryResponse | undefined;
    #holdNext = false;
    #held:
        | { response: MockHistoryResponse; release(response: MockHistoryResponse): void }
        | undefined;

    reset() {
        this.release();
        this.#pages = [];
        this.#nextError = undefined;
        this.#holdNext = false;
    }
    setPages(value: unknown) {
        if (!Array.isArray(value) || !value.every(isUserHistoryPage)) {
            throw new Error('Invalid mock history pages');
        }

        this.#pages = value;
    }
    setError(status: number, body: unknown) {
        if (
            !(
                (status === 400 && isHistoryCursorErrorResponse(body)) ||
                (status === 503 && isDurableHistoryUnavailableResponse(body))
            )
        ) {
            throw new Error('Invalid mock history error');
        }

        this.#nextError = { status, body };
    }
    holdNext() {
        this.#holdNext = true;
    }
    hasHeldResponse() {
        return this.#held !== undefined;
    }
    release() {
        const held = this.#held;
        this.#held = undefined;
        held?.release(held.response);
    }
    read(url: URL, fallback: UserHistoryPage): Promise<MockHistoryResponse> {
        const query = normalizeUserHistoryPageQuery({
            pageSize: Number(url.searchParams.get('pageSize')),
            ...(url.searchParams.has('cursor') ? { cursor: url.searchParams.get('cursor') } : {}),
        });

        if (
            !query ||
            query.pageSize !== 50 ||
            [...url.searchParams.keys()].some((key) => key !== 'pageSize' && key !== 'cursor')
        ) {
            throw new Error('Invalid mock history query');
        }

        let result = this.#nextError;
        this.#nextError = undefined;

        if (!result) {
            const index =
                query.cursor === undefined
                    ? 0
                    : this.#pages.findIndex((page) => page.nextCursor === query.cursor) + 1;

            if (query.cursor !== undefined && index === 0) {
                throw new Error('Unknown mock cursor');
            }

            const page = this.#pages[index] ?? (query.cursor === undefined ? fallback : undefined);

            if (!page || !isUserHistoryPage(page)) {
                throw new Error('Missing mock page');
            }

            result = { status: 200, body: structuredClone(page) };
        }

        if (!this.#holdNext) {
            return Promise.resolve(result);
        }

        this.#holdNext = false;
        const captured = result;

        return new Promise((resolve) => {
            this.#held = { response: captured, release: resolve };
        });
    }
}
