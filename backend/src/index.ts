export {
    createSimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapterConfig,
} from './adapters/simulator/temperature/temperature-adapter';
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
