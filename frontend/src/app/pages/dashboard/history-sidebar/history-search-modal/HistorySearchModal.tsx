import { X } from 'lucide-react';
import { type MouseEvent, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { HistoryFeed, HistoryFilters, HistoryProvider } from '../../../../features/history';
import { Button } from '../../../../ui';
import type { RenderableDeviceProjection } from '../../device-projection';

import styles from './HistorySearchModal.module.css';

export function HistorySearchModal({
    open,
    onClose,
    devices,
}: {
    open: boolean;
    onClose(): void;
    devices: readonly RenderableDeviceProjection[];
}) {
    const { t } = useTranslation('dashboard');
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const titleId = useId();
    useEffect(() => {
        const dialog = dialogRef.current;

        if (open && dialog && !dialog.open) {
            dialog.showModal();
            closeButtonRef.current?.focus();
        } else if (!open && dialog?.open) {
            dialog.close();
        }
    }, [open]);

    function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
        if (event.target !== event.currentTarget) {
            return;
        }

        const bounds = event.currentTarget.getBoundingClientRect();

        if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
        ) {
            event.currentTarget.close();
        }
    }

    return (
        <dialog
            ref={dialogRef}
            className={styles.dialog}
            aria-labelledby={titleId}
            onClose={onClose}
            onClick={handleDialogClick}
        >
            <header className={styles.header}>
                <h2 id={titleId}>{t('history.searchTitle')}</h2>
                <Button
                    variant="outlined"
                    ref={closeButtonRef}
                    type="button"
                    className={styles.iconButton}
                    data-search-action
                    aria-label={t('history.closeSearch')}
                    onClick={() => dialogRef.current?.close()}
                >
                    <X aria-hidden="true" size={20} />
                </Button>
            </header>
            {open ? (
                <HistoryProvider mode="search" devices={devices}>
                    <HistoryFilters />
                    <HistoryFeed />
                </HistoryProvider>
            ) : null}
        </dialog>
    );
}
