import { useState } from "react";

type InboxSelectionEvent = {
  id: string;
  draftReply: {
    body: string;
  };
};

type UseInboxSelectionOptions<TEvent extends InboxSelectionEvent, TFilter extends string, TTab extends string> = {
  activeEvents: TEvent[];
  archivedEvents: TEvent[];
  archiveFilter: TFilter;
  archiveTab: TTab;
  defaultFilter: TFilter;
  defaultTab: TTab;
  importedEvents: TEvent[];
  listEvents: (
    activeEvents: TEvent[],
    archivedEvents: TEvent[],
    importedEvents: TEvent[],
    filter: TFilter,
  ) => TEvent[];
  onActionMessagesClear: () => void;
  onDraftBodyChange: (body: string) => void;
};

export function useInboxSelection<
  TEvent extends InboxSelectionEvent,
  TFilter extends string,
  TTab extends string,
>({
  activeEvents,
  archivedEvents,
  archiveFilter,
  archiveTab,
  defaultFilter,
  defaultTab,
  importedEvents,
  listEvents,
  onActionMessagesClear,
  onDraftBodyChange,
}: UseInboxSelectionOptions<TEvent, TFilter, TTab>) {
  const [filter, setFilter] = useState<TFilter>(defaultFilter);
  const [activeTab, setActiveTab] = useState<TTab>(defaultTab);
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState("");

  function selectFilter(nextFilter: TFilter) {
    const nextEvents = listEvents(activeEvents, archivedEvents, importedEvents, nextFilter);
    setFilter(nextFilter);
    setActiveTab(nextFilter === archiveFilter ? archiveTab : defaultTab);
    setMobilePane("list");
    if (nextEvents[0]) {
      setSelectedId(nextEvents[0].id);
      onDraftBodyChange(nextEvents[0].draftReply.body);
    } else {
      setSelectedId("");
      onDraftBodyChange("");
    }
  }

  function selectEvent(event: TEvent) {
    setSelectedId(event.id);
    onDraftBodyChange(event.draftReply.body);
    onActionMessagesClear();
    setActiveTab(filter === archiveFilter ? archiveTab : defaultTab);
    setMobilePane("detail");
  }

  return {
    activeTab,
    filter,
    mobilePane,
    selectedId,
    selectEvent,
    selectFilter,
    setActiveTab,
    setFilter,
    setMobilePane,
    setSelectedId,
  };
}
