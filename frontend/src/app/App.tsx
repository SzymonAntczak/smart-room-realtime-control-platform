import { useRoomRealtime } from './realtime/use-room-realtime';
import { RoomControlSurface } from './shared/ui/RoomControlSurface';

export function App() {
    const room = useRoomRealtime();

    return <RoomControlSurface room={room} />;
}
