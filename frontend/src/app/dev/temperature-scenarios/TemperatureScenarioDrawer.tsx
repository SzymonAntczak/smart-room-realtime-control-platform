import { useEffect, useRef, useState } from 'react';
import styles from './TemperatureScenarioDrawer.module.css';
import { TemperatureScenarioPanel } from './TemperatureScenarioPanel';

const drawerId = 'temperature-scenario-drawer';

export function TemperatureScenarioDrawer() {
    const [isOpen, setIsOpen] = useState(false);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const shouldRestoreToggleFocus = useRef(false);

    useEffect(() => {
        if (isOpen) {
            closeButtonRef.current?.focus();
        } else if (shouldRestoreToggleFocus.current) {
            toggleRef.current?.focus();
            shouldRestoreToggleFocus.current = false;
        }
    }, [isOpen]);

    function closeDrawer(): void {
        shouldRestoreToggleFocus.current = true;
        setIsOpen(false);
    }

    return (
        <>
            <button
                ref={toggleRef}
                className={styles.toggle}
                type="button"
                aria-controls={drawerId}
                aria-expanded={isOpen}
                onClick={() => (isOpen ? closeDrawer() : setIsOpen(true))}
            >
                Dev scenarios
            </button>
            {isOpen ? (
                <aside
                    id={drawerId}
                    className={styles.drawer}
                    aria-label="Temperature scenario controls"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            closeDrawer();
                        }
                    }}
                >
                    <button
                        ref={closeButtonRef}
                        className={styles.close}
                        type="button"
                        onClick={closeDrawer}
                    >
                        Close panel
                    </button>
                    <TemperatureScenarioPanel />
                </aside>
            ) : null}
        </>
    );
}
