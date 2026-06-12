import { useCallback, useEffect, useMemo, useState } from "react";

export type InboxDataEvent = {
  company: string;
  customer: string;
  eventDate: string;
  id: string;
  status: string;
  summary: string;
  threadId: string;
};


type UseInboxEventsOptions<TPersisted extends { id: string }, TEvent extends InboxDataEvent> = {
  archivedEvents: TEvent[];
  events: TEvent[];
  isImportedReviewEvent: (event: TEvent) => boolean;
  mapPersistedEvent: (event: TPersisted) => TEvent;
};

export function useInboxEvents<
  TPersisted extends { id: string },
  TEvent extends InboxDataEvent,
>({
  archivedEvents: fallbackArchivedEvents,
  events: fallbackEvents,
  isImportedReviewEvent,
  mapPersistedEvent,
}: UseInboxEventsOptions<TPersisted, TEvent>) {
  const [events, setEvents] = useState<TEvent[]>(fallbackEvents);
  const [archive, setArchive] = useState<TEvent[]>(fallbackArchivedEvents);
  const [persistedEvents, setPersistedEvents] = useState<TPersisted[]>([]);
  const [persistedLoading, setPersistedLoading] = useState(true);

  const loadPersistedInboxEvents = useCallback(async () => {
    setPersistedLoading(true);
    try {
      const response = await fetch("/api/inbox/events?summary=1", { cache: "no-store" });
      const body = (await response.json()) as {
        events?: TPersisted[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load inbox events.");
      setPersistedEvents(body.events ?? []);
    } catch {
      setPersistedEvents([]);
    } finally {
      setPersistedLoading(false);
    }
  }, []);

  const loadPersistedInboxEventDetail = useCallback(async (eventId: string) => {
    try {
      const response = await fetch(`/api/inbox/events?eventId=${encodeURIComponent(eventId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        events?: TPersisted[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load inbox event detail.");
      const detail = body.events?.[0];
      if (!detail) return;
      setPersistedEvents((current) =>
        current.map((event) => (event.id === detail.id ? detail : event)),
      );
    } catch {
      // Keep the summary row visible if detail fetch fails.
    }
  }, []);

  useEffect(() => {
    void loadPersistedInboxEvents();
  }, [loadPersistedInboxEvents]);

  const mappedPersistedEvents = useMemo(
    () => persistedEvents.map(mapPersistedEvent),
    [mapPersistedEvent, persistedEvents],
  );
  const persistedImportedReviewEvents = useMemo(
    () =>
      mappedPersistedEvents.filter(
        (event) => event.status !== "closed" && isImportedReviewEvent(event),
      ),
    [isImportedReviewEvent, mappedPersistedEvents],
  );
  const persistedActiveEvents = useMemo(
    () =>
      mappedPersistedEvents.filter(
        (event) => event.status !== "closed" && !isImportedReviewEvent(event),
      ),
    [isImportedReviewEvent, mappedPersistedEvents],
  );
  const persistedArchivedEvents = useMemo(
    () => mappedPersistedEvents.filter((event) => event.status === "closed"),
    [mappedPersistedEvents],
  );
  const hasPersistedEvents = mappedPersistedEvents.length > 0;
  const activeEvents = useMemo<TEvent[]>(
    () => (hasPersistedEvents ? persistedActiveEvents : events),
    [events, hasPersistedEvents, persistedActiveEvents],
  );
  const archivedInboxEvents = useMemo<TEvent[]>(
    () => (hasPersistedEvents ? persistedArchivedEvents : archive),
    [archive, hasPersistedEvents, persistedArchivedEvents],
  );

  return {
    activeEvents,
    archive,
    archivedInboxEvents,
    events,
    loadPersistedInboxEventDetail,
    loadPersistedInboxEvents,
    persistedEvents,
    persistedImportedReviewEvents,
    persistedLoading,
    setArchive,
    setEvents,
  };
}
