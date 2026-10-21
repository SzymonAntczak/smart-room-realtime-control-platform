import type { UserHistoryPage } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
const fixtures = createUserHistoryFixtures();

/** Supplies real unrelated older entries when a scenario needs a continuation. */
export function createHistoryPageFixture(
    items: UserHistoryPage['items'],
    nextCursor: string | null = null,
): UserHistoryPage {
    const oldest = Math.min(
        Date.parse(fixtures.powerChange.occurredAt),
        ...items.map((item) => Date.parse(item.occurredAt)),
    );
    const padding =
        nextCursor === null
            ? []
            : Array.from({ length: 50 - items.length }, (_, index) => ({
                  ...fixtures.failure,
                  recordId: 'rec:v1:sha256:' + (10000 + index).toString(16).padStart(64, '0'),
                  storageSequence: 10000 + index,
                  occurredAt: new Date(oldest - (index + 1) * 1000).toISOString(),
              }));

    return {
        ...fixtures.page,
        items: [...items, ...padding],
        pageSize: 50,
        throughSequence: 20000,
        nextCursor,
    };
}
