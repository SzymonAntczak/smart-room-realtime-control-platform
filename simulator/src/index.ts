export {
    createTemperatureSensorSimulator,
    type TemperatureReadingListener,
    type TemperatureReadingMessage,
    type TemperatureSensorConfig,
    type TemperatureSensorSimulator,
} from './temperature/temperature-sensor';
export {
    createTemperatureSensorRuntime,
    type Clock,
    type TemperatureSensorRuntime,
    type TemperatureSensorRuntimeConfig,
    type TimerScheduler,
} from './temperature/temperature-sensor-runtime';
