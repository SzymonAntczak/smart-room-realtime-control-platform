import type { PlatformEvent } from '@smart-room/contracts/events';

export type EventIdGenerator = () => string;

export type PlatformEventSink<TEvent extends PlatformEvent = PlatformEvent> = (
    event: TEvent,
) => void;
