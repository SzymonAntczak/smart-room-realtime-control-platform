import type { PlatformEvent } from '../../../../shared/src/events';

export type EventIdGenerator = () => string;

export type PlatformEventSink<TEvent extends PlatformEvent = PlatformEvent> = (
    event: TEvent,
) => void;
