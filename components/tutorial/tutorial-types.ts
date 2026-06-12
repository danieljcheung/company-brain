import type { Route } from "next";

export type TutorialStep = {
  id: string;
  route: Route;
  target: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
};

export const tutorialCompletedKey = "company-brain-tutorial-completed";
export const tutorialStepKey = "company-brain-tutorial-step";

export const tutorialSteps: TutorialStep[] = [
  {
    id: "sidebar",
    route: "/",
    target: "app-sidebar-nav",
    title: "Move between workspaces",
    body: "Use the sidebar to switch between Inbox, Company Brain, Ingestion, and Settings.",
    placement: "right",
  },
  {
    id: "sync",
    route: "/",
    target: "inbox-sync",
    title: "Sync Gmail",
    body: "Pull the latest catering threads into the local review queue. Timed sync also runs in production.",
    placement: "bottom",
  },
  {
    id: "queues",
    route: "/",
    target: "inbox-queues",
    title: "Filter the queue",
    body: "Queues group threads by next action: replies, waiting, invoice review, triage, follow-up, and archive.",
    placement: "bottom",
  },
  {
    id: "thread-list",
    route: "/",
    target: "inbox-thread-list",
    title: "Open a thread",
    body: "Select any visible thread to open the mobile detail view. The detail tabs stay reachable from the top.",
    placement: "right",
  },
  {
    id: "detail-tabs",
    route: "/",
    target: "inbox-detail-tabs",
    title: "Review thread tabs",
    body: "Thread, Invoice, Event details, and History are horizontally scrollable on small screens.",
    placement: "bottom",
  },
  {
    id: "draft-actions",
    route: "/",
    target: "inbox-draft-actions",
    title: "Review draft replies",
    body: "Draft actions stay below the composer so send, regenerate, and reject remain reachable on mobile.",
    placement: "top",
  },
  {
    id: "invoice",
    route: "/",
    target: "inbox-invoice",
    title: "Check invoices",
    body: "Invoice previews stack on mobile. Create in Zoho first, review, then send the final invoice.",
    placement: "top",
  },
  {
    id: "brain-search",
    route: "/brain",
    target: "brain-search",
    title: "Search Company Brain",
    body: "Approved operational knowledge is searchable and connected to its source evidence.",
    placement: "bottom",
  },
  {
    id: "brain-details",
    route: "/brain",
    target: "brain-details",
    title: "Inspect records",
    body: "Open a record to see details, evidence, metadata, and usage notes.",
    placement: "left",
  },
  {
    id: "ingestion-upload",
    route: "/ingestion",
    target: "ingestion-upload",
    title: "Add source material",
    body: "Upload files or paste text to extract candidate Company Brain records.",
    placement: "bottom",
  },
  {
    id: "ingestion-candidates",
    route: "/ingestion",
    target: "ingestion-candidates",
    title: "Review candidates",
    body: "Approve, reject, or request clarification before anything becomes trusted knowledge.",
    placement: "top",
  },
  {
    id: "settings-gmail",
    route: "/settings",
    target: "settings-gmail",
    title: "Connect Gmail",
    body: "Settings shows Gmail connection status, manual sync, and auth controls.",
    placement: "bottom",
  },
  {
    id: "settings-zoho",
    route: "/settings",
    target: "settings-zoho",
    title: "Connect invoice systems",
    body: "Zoho settings control invoice template import and future invoice write access.",
    placement: "top",
  },
];
