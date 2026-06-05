import { formatTime } from '../shared/formatting/format-time';
import styles from './EventFeed.module.css';
import type { RoomEventFeedItemView } from '../room-control/room-view-model';

interface EventFeedProps {
    events: RoomEventFeedItemView[];
}

export function EventFeed({ events }: EventFeedProps) {
    return (
        <section className={styles.feed}>
            <h2>Recent events</h2>
            <ol>
                {events.map((event) => (
                    <li key={event.eventId}>
                        <div className={styles.meta}>
                            <span>{event.eventType}</span>
                            <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
                        </div>
                        <p>{event.summary}</p>
                        <span className={styles.source}>{event.source}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
}
