import { describe, expect, it } from 'vitest';
import { isDevScenarioControlsEnabled } from './dev-scenario-controls';

describe('isDevScenarioControlsEnabled', () => {
    it.each([undefined, '', 'false', 'production', 'TRUE'])(
        'defaults to disabled for %p',
        (value) => {
            expect(isDevScenarioControlsEnabled(value)).toBe(false);
        },
    );

    it('enables controls only for the explicit true value', () => {
        expect(isDevScenarioControlsEnabled('true')).toBe(true);
    });
});
