import styles from "./EventFeed.module.css";
import type { EventFeedItemView } from "../types/viewModels";

interface EventFeedProps {
  events: EventFeedItemView[];
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
              <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
            </div>
            <p>{event.summary}</p>
            <span className={styles.source}>{event.source}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
