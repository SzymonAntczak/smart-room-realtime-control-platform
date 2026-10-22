import {
    assertMockAcceptedCommandResponse,
    assertMockPreAdmissionCommandError,
} from './mock-bff-contracts';

type MockCommandResponse =
    | { status: 202; body: ReturnType<typeof assertMockAcceptedCommandResponse> }
    | { status: 503; body: ReturnType<typeof assertMockPreAdmissionCommandError> };

/** Scripts frontend-facing command responses and deterministic response ordering. */
export class MockCommandResponses {
    #next: { kind: 'recovering' | 'volatile-accepted'; hold: boolean } | undefined;
    #held:
        | { response: MockCommandResponse; release(response: MockCommandResponse): void }
        | undefined;

    reset(): void {
        this.release();
        this.#next = undefined;
    }

    configure(kind: 'recovering' | 'volatile-accepted', hold = false): void {
        this.#next = { kind, hold };
    }

    hasHeldResponse(): boolean {
        return this.#held !== undefined;
    }

    release(): void {
        const held = this.#held;
        this.#held = undefined;
        held?.release(held.response);
    }

    take(generateCommandId: () => string): Promise<MockCommandResponse> {
        const next = this.#next;
        this.#next = undefined;

        const response: MockCommandResponse =
            next?.kind === 'recovering'
                ? {
                      status: 503,
                      body: assertMockPreAdmissionCommandError({
                          error: 'platform_recovering',
                          message: 'Retry after storage recovery.',
                          retryable: true,
                      }),
                  }
                : {
                      status: 202,
                      body: assertMockAcceptedCommandResponse({
                          commandId: generateCommandId(),
                          status: 'accepted',
                          durability: next?.kind === 'volatile-accepted' ? 'volatile' : 'durable',
                          lifecycleDurability:
                              next?.kind === 'volatile-accepted' ? 'volatile' : 'durable',
                      }),
                  };

        if (!next?.hold) {
            return Promise.resolve(response);
        }

        return new Promise((resolve) => {
            this.#held = { response, release: resolve };
        });
    }
}
