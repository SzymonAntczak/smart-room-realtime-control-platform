import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HistorySidebar } from './HistorySidebar';

const content = vi.hoisted(() => ({ mount: vi.fn(), release: vi.fn() }));
vi.mock('./history-sidebar-content/HistorySidebarContent', async () => {
    const { createElement, useEffect } = await import('react');

    return {
        HistorySidebarContent: () => {
            useEffect(() => {
                content.mount();

                return content.release;
            }, []);

            return createElement('p', null, 'Open history session');
        },
    };
});

const props = {
    source: {
        subscribe: () => () => undefined,
        getBaseline: () => undefined,
        requestBaseline: () => undefined,
    },
    devices: [],
    realtimeUncertain: false,
    waitingForRoom: false,
};

describe('HistorySidebar session lifecycle and accessibility', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('releases content when collapsed and remounts it through the accessible toggle', async () => {
        const user = userEvent.setup();
        render(<HistorySidebar {...props} />);
        const toggle = screen.getByRole('button', { name: 'Ukryj ostatnie zdarzenia' });
        const sidebar = screen.getByRole('complementary');
        expect(toggle).toHaveAttribute('aria-controls', sidebar.id);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(content.mount).toHaveBeenCalledOnce();

        await user.click(toggle);

        expect(toggle).toHaveAccessibleName('Pokaż ostatnie zdarzenia');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(sidebar).toHaveAttribute('aria-hidden', 'true');
        expect(sidebar).toHaveAttribute('inert');
        expect(screen.queryByText('Open history session')).toBeNull();
        expect(content.release).toHaveBeenCalledOnce();

        await user.click(toggle);

        expect(sidebar).not.toHaveAttribute('inert');
        expect(sidebar).toHaveAttribute('aria-hidden', 'false');
        expect(content.mount).toHaveBeenCalledTimes(2);
    });

    it('does not create history content until opened on a narrow screen', async () => {
        vi.stubGlobal('matchMedia', () => ({
            matches: true,
            addEventListener() {},
            removeEventListener() {},
        }));
        render(<HistorySidebar {...props} />);
        expect(content.mount).not.toHaveBeenCalled();

        await userEvent
            .setup()
            .click(screen.getByRole('button', { name: 'Pokaż ostatnie zdarzenia' }));

        expect(content.mount).toHaveBeenCalledOnce();
    });
});
