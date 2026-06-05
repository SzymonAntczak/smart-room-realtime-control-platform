import type { ConnectionStatus } from './room-view-model';

type ConnectionIndicatorTone = 'neutral' | 'success' | 'warning' | 'danger';

interface ConnectionIndicatorView {
    label: string;
    tone: ConnectionIndicatorTone;
}

const connectionIndicatorViews: Record<ConnectionStatus, ConnectionIndicatorView> = {
    fixture: {
        label: 'Fixture data',
        tone: 'neutral',
    },
    connecting: {
        label: 'Connecting',
        tone: 'warning',
    },
    connected: {
        label: 'Connected',
        tone: 'success',
    },
    disconnected: {
        label: 'Disconnected',
        tone: 'danger',
    },
};

export function getConnectionIndicatorView(status: ConnectionStatus) {
    return connectionIndicatorViews[status];
}
