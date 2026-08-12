export {
    createSimulatorLedAdapter,
    type LedCommandTransport,
    type SimulatorLedAdapter,
    type SimulatorLedAdapterConfig,
} from './adapters/simulator/led/led-adapter';
export {
    createSimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapterConfig,
} from './adapters/simulator/temperature/temperature-adapter';
export {
    createEventProcessingDiagnostics,
    type EventProcessingDiagnostics,
    type EventProcessingDiagnosticsConfig,
    type EventProcessingDiagnosticsSnapshot,
    type IgnoredEventDiagnostic,
} from './platform/event-processing/event-processing-diagnostics';
export {
    createEventProcessor,
    type DeviceDefinition,
    type EventProcessor,
    type EventProcessorConfig,
    type EventProcessorState,
    type EventProcessingResult,
} from './platform/event-processing/event-processor';
export { createRoomBffServer, type RoomBffConfig } from './api/room-bff';
export { type EventIdGenerator, type PlatformEventSink } from './platform/ports/event-sink';
export {
    type PlatformSetPowerCommand,
    type SetPowerCommandDispatcher,
} from './platform/ports/set-power-command-dispatcher';
export {
    createSetPowerCommandController,
    type CommandTimer,
    type SetPowerCommandController,
    type SetPowerCommandControllerConfig,
} from './platform/command-processing/set-power-command-controller';
export {
    createRoomProjector,
    type RoomProjection,
    type RoomProjectionConfig,
    type RoomProjector,
} from './platform/read-model/room-projection';
export {
    createTemperatureRoomRuntime,
    type TemperatureRoomRuntime,
    type TemperatureRoomRuntimeConfig,
} from './runtime/temperature-room-runtime';
