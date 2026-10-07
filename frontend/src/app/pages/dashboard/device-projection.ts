import type { LedDeviceProjection } from './led-card/LedCard';
import type { TemperatureSensorDeviceProjection } from './temperature-card/TemperatureCard';

export type RenderableDeviceProjection = LedDeviceProjection | TemperatureSensorDeviceProjection;
