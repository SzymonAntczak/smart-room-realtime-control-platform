import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import { createRoomHistorySource } from './room-history-source';

describe('room history source', () => {
    it('delivers every update synchronously while keeping only the current baseline', () => {
        const fixtures = createUserHistoryFixtures();
        const history = createRoomHistorySource();
        const baseline = {
            kind: 'baseline',
            storage: fixtures.snapshot.platform.storage,
            userHistory: fixtures.snapshot.userHistory,
        } as const;
        const listener = vi.fn();
        const unsubscribe = history.source.subscribe(listener);
        history.publish(baseline, baseline);
        history.publish({ ...baseline, kind: 'addition' }, baseline);
        history.publish({ ...baseline, kind: 'addition' }, baseline);
        expect(listener).toHaveBeenCalledTimes(3);
        expect(history.source.getBaseline()).toBe(baseline);
        history.publish({ kind: 'interrupted' });
        expect(history.source.getBaseline()).toBeUndefined();
        unsubscribe();
        history.publish(baseline, baseline);
        expect(listener).toHaveBeenCalledTimes(4);
        expect(history.source.getBaseline()).toBe(baseline);
    });

    it('requests a baseline through the existing connection action', () => {
        const history = createRoomHistorySource();
        const reconnect = vi.fn();
        history.setRequestBaseline(reconnect);
        history.source.requestBaseline();
        expect(reconnect).toHaveBeenCalledOnce();
        history.setRequestBaseline(() => undefined);
        history.source.requestBaseline();
        expect(reconnect).toHaveBeenCalledOnce();
    });
});
