import type * as SimulatorModule from '@smart-room/simulator';
import { afterEach, vi } from 'vitest';

import { createNativeSourceRegistry } from './native-source-doubles';

export const nativeSources = createNativeSourceRegistry();

vi.mock('@smart-room/simulator', async (importOriginal) => {
    const simulator = await importOriginal<typeof SimulatorModule>();

    return {
        ...simulator,
        createTemperatureSensorScenario: nativeSources.temperatureFactory,
        createLedScenario: nativeSources.ledFactory,
    };
});

afterEach(() => nativeSources.reset());
