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
export { type EventIdGenerator, type PlatformEventSink } from './platform/ports/event-sink';
export {
    createRoomProjector,
    type RoomProjection,
    type RoomProjectionConfig,
    type RoomProjector,
} from './platform/read-model/room-projection';
