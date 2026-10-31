export interface InfiniteListHandle {
    getViewport(): HTMLElement | null;
    scrollToTop(): { alreadyAtTop: boolean };
    scrollToIndex(
        location:
            | number
            | {
                  index: number;
                  align?: 'start' | 'center' | 'end';
                  offset?: number;
                  behavior?: 'auto' | 'smooth';
              },
    ): void;
}
