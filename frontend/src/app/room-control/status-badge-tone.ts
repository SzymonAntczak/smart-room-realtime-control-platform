import type { CommandStatus, DeviceHealth } from './room-view-model';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function getStatusBadgeTone(status: CommandStatus | DeviceHealth): StatusTone {
    if (status === 'online' || status === 'confirmed' || status === 'idle') {
        return 'success';
    }

    if (status === 'pending' || status === 'submitting' || status === 'stale') {
        return 'warning';
    }

    if (status === 'failed' || status === 'timed_out' || status === 'offline') {
        return 'danger';
    }

    if (status === 'degraded') {
        return 'info';
    }

    return 'neutral';
}
