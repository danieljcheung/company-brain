"use client";

import type { ChangeEventHandler, ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, Search, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type InboxPane = "list" | "detail";

export type InboxQueueItem<TValue extends string> = {
  value: TValue;
  label: string;
  icon: LucideIcon;
};

type InboxLayoutProps<TValue extends string> = {
  activeQueue: TValue;
  detail: ReactNode;
  list: ReactNode;
  mobilePane: InboxPane;
  queueCounts: Record<TValue, number>;
  queueItems: Array<InboxQueueItem<TValue>>;
  searchQuery: string;
  shownCount: number;
  sidebarCollapsed: boolean;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onSearchChange: ChangeEventHandler<HTMLInputElement>;
  onSelectQueue: (value: TValue) => void;
};

function InboxSearchField({
  dense = false,
  searchQuery,
  onSearchChange,
}: {
  dense?: boolean;
  searchQuery: string;
  onSearchChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className={cn("absolute left-2.5 size-4 text-muted-foreground", dense ? "top-2.5" : "top-3 md:top-2.5")} />
      <Input
        className={cn("pl-8", !dense && "h-10 text-sm md:h-8")}
        placeholder="Search threads"
        value={searchQuery}
        onChange={onSearchChange}
      />
    </div>
  );
}

function QueueButtonRow<TValue extends string>({
  activeQueue,
  queueCounts,
  queueItems,
  onSelectQueue,
}: {
  activeQueue: TValue;
  queueCounts: Record<TValue, number>;
  queueItems: Array<InboxQueueItem<TValue>>;
  onSelectQueue: (value: TValue) => void;
}) {
  return (
    <nav
      aria-label="Inbox queues"
      className="flex shrink-0 gap-1.5 overflow-x-auto pb-1.5 scrollbar-none sm:grid sm:grid-cols-5 sm:gap-2 sm:pb-0"
      data-tutorial="inbox-queues"
    >
      {queueItems.map((item) => {
        const active = activeQueue === item.value;
        return (
          <button
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-w-[7rem] flex-1 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors sm:min-w-0",
              active
                ? "border-accent/60 bg-accent/20 text-foreground"
                : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            key={item.value}
            type="button"
            onClick={() => onSelectQueue(item.value)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <item.icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
              {queueCounts[item.value]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function ThreadListPane({
  children,
  searchQuery,
  onSearchChange,
}: {
  children: ReactNode;
  searchQuery: string;
  onSearchChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-3">
        <InboxSearchField dense searchQuery={searchQuery} onSearchChange={onSearchChange} />
      </div>
      <Separator />
      {children}
    </div>
  );
}

export function InboxLayout<TValue extends string>({
  activeQueue,
  detail,
  list,
  mobilePane,
  queueCounts,
  queueItems,
  searchQuery,
  shownCount,
  sidebarCollapsed,
  onCollapseSidebar,
  onExpandSidebar,
  onSearchChange,
  onSelectQueue,
}: InboxLayoutProps<TValue>) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
      <div className="flex h-full min-h-0 flex-1 flex-col 2xl:hidden">
        <div
          className={cn(
            "grid shrink-0 gap-2 border-b p-2 sm:p-3",
            mobilePane === "detail" ? "hidden md:grid" : "grid",
          )}
        >
          <QueueButtonRow
            activeQueue={activeQueue}
            queueCounts={queueCounts}
            queueItems={queueItems}
            onSelectQueue={onSelectQueue}
          />
          <div className="flex min-w-0 gap-2">
            <InboxSearchField searchQuery={searchQuery} onSearchChange={onSearchChange} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <section
            className={cn(
              "min-h-0 flex-1 flex-col md:w-[24rem] md:flex-none md:shrink-0 md:border-r",
              mobilePane === "detail" ? "hidden md:flex" : "flex",
            )}
          >
            {list}
          </section>

          <section
            className={cn(
              "min-h-0 flex-1 flex-col",
              mobilePane === "list" ? "hidden md:flex" : "flex",
            )}
          >
            {detail}
          </section>
        </div>
      </div>

      <div className="hidden h-full min-h-0 flex-1 overflow-hidden 2xl:block">
        {sidebarCollapsed ? (
          <div className="flex h-full min-w-0">
            <aside
              aria-label="Inbox controls"
              className="flex h-full w-[4.5rem] shrink-0 flex-col items-center overflow-hidden border-r py-2"
            >
              <Button
                aria-label="Expand inbox sidebar"
                aria-pressed={sidebarCollapsed}
                className="size-10 shrink-0"
                size="icon"
                title="Expand inbox sidebar"
                variant="ghost"
                onClick={onExpandSidebar}
              >
                <PanelLeftOpen className="size-5" />
              </Button>
              <Separator className="my-2 w-full" />
              <nav className="flex w-full flex-col items-center gap-1 px-2">
                {queueItems.map((item) => (
                  <Button
                    aria-label={`${item.label}: ${queueCounts[item.value]}`}
                    aria-current={activeQueue === item.value ? "page" : undefined}
                    aria-pressed={activeQueue === item.value}
                    className={cn(
                      "size-10 shrink-0",
                      activeQueue === item.value && "bg-muted text-foreground",
                    )}
                    key={item.value}
                    size="icon"
                    title={`${item.label}: ${queueCounts[item.value]}`}
                    variant="ghost"
                    onClick={() => onSelectQueue(item.value)}
                  >
                    <item.icon className="size-5" />
                  </Button>
                ))}
              </nav>
            </aside>

            <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
              <ResizablePanel defaultSize={39} minSize={16}>
                <ThreadListPane searchQuery={searchQuery} onSearchChange={onSearchChange}>
                  {list}
                </ThreadListPane>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel className="min-h-0 overflow-hidden" defaultSize={61} minSize={28}>
                {detail}
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0">
            <ResizablePanel className="overflow-hidden" defaultSize={24} minSize={17}>
              <aside className="flex h-full min-w-0 flex-col overflow-hidden">
                <div className="flex min-w-0 items-center gap-2 p-3">
                  <div className="min-w-0 flex-1" />
                  <Button
                    aria-label="Collapse inbox sidebar"
                    aria-pressed={sidebarCollapsed}
                    className="size-10 shrink-0"
                    size="icon"
                    title="Collapse inbox sidebar"
                    variant="ghost"
                    onClick={onCollapseSidebar}
                  >
                    <PanelLeftClose className="size-5" />
                  </Button>
                </div>
                <Separator />
                <div className="px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                    <span className="truncate">Queues</span>
                    <span className="shrink-0">{shownCount} shown</span>
                  </div>
                  <nav className="grid gap-1" aria-label="Inbox queues">
                    {queueItems.map((item) => (
                      <button
                        aria-label={`${item.label}: ${queueCounts[item.value]}`}
                        aria-current={activeQueue === item.value ? "page" : undefined}
                        aria-pressed={activeQueue === item.value}
                        className={cn(
                          "flex h-10 min-w-0 items-center gap-2 rounded-md px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                          activeQueue === item.value && "bg-muted text-foreground ring-1 ring-accent/45",
                        )}
                        key={item.value}
                        title={`${item.label}: ${queueCounts[item.value]}`}
                        type="button"
                        onClick={() => onSelectQueue(item.value)}
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                          {queueCounts[item.value]}
                        </span>
                      </button>
                    ))}
                  </nav>
                </div>
              </aside>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={30} minSize={16}>
              <ThreadListPane searchQuery={searchQuery} onSearchChange={onSearchChange}>
                {list}
              </ThreadListPane>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel className="min-h-0 overflow-hidden" defaultSize={46} minSize={28}>
              {detail}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  );
}
