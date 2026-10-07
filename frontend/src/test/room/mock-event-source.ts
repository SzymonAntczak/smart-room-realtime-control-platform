export class MockEventSource extends EventTarget {
    static instances: MockEventSource[] = [];

    readonly url: string;

    constructor(url: string) {
        super();
        this.url = url;
        MockEventSource.instances.push(this);
    }

    static latest(): MockEventSource {
        const instance = MockEventSource.instances.at(-1);

        if (!instance) {
            throw new Error('No mock EventSource instance was created.');
        }

        return instance;
    }

    close(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitOpen(): void {
        this.dispatchEvent(new Event('open'));
    }

    emitError(): void {
        this.dispatchEvent(new Event('error'));
    }

    emitClose(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitMessage(data: unknown, eventType = getRealtimeEventType(data)): void {
        this.dispatchEvent(
            new MessageEvent(eventType, {
                data: JSON.stringify(data),
            }),
        );
    }
}

function getRealtimeEventType(data: unknown): string {
    if (typeof data === 'object' && data !== null && 'messageType' in data) {
        const messageType = data.messageType;

        if (typeof messageType === 'string') {
            return messageType;
        }
    }

    return 'room.snapshot';
}
