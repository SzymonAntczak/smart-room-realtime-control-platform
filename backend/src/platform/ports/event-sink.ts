import type { PlatformEvent } from '@smart-room/contracts';

export type EventIdGenerator = () => string;

export type PlatformEventSink<TEvent extends PlatformEvent = PlatformEvent> = (
    event: TEvent,
) => void;
