import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { temperatureScenarioDefinition } from './scenarios';
import { useAppDev } from './useAppDev';

describe('useAppDev', () => {
    it('tracks the selected device scenario sidebar', () => {
        const { result } = renderHook(() => useAppDev());
        const target = { deviceId: 'temp-desk', definition: temperatureScenarioDefinition };

        act(() => result.current.openScenarioSidebar(target));

        expect(result.current.scenarioTarget).toEqual(target);
    });

    it('restores focus to the selected device trigger when closing the sidebar', async () => {
        const trigger = document.createElement('button');
        trigger.id = 'dev-scenarios-temp-desk';
        document.body.append(trigger);
        const { result } = renderHook(() => useAppDev());

        act(() =>
            result.current.openScenarioSidebar({
                deviceId: 'temp-desk',
                definition: temperatureScenarioDefinition,
            }),
        );
        act(() => result.current.closeScenarioSidebar());
        await Promise.resolve();

        expect(result.current.scenarioTarget).toBeUndefined();
        expect(trigger).toHaveFocus();
        trigger.remove();
    });

    it('keeps device control locked until every outstanding scenario request finishes', () => {
        const { result } = renderHook(() => useAppDev());

        act(() => {
            result.current.updateScenarioRequestCount('led-main', true);
            result.current.updateScenarioRequestCount('led-main', true);
        });
        expect(result.current.isDeviceControlLocked('led-main', true)).toBe(true);

        act(() => result.current.updateScenarioRequestCount('led-main', false));
        expect(result.current.isDeviceControlLocked('led-main', true)).toBe(true);

        act(() => result.current.updateScenarioRequestCount('led-main', false));
        expect(result.current.isDeviceControlLocked('led-main', true)).toBe(false);
    });
});
