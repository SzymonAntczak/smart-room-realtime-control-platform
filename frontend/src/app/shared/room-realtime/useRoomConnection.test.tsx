import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useRoomConnection } from './useRoomConnection';
it('requires the shared room provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(useRoomConnection)).toThrow('Room connection requires RoomProvider');
    spy.mockRestore();
});
