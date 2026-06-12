import type { Route } from "next";

export type TutorialStep = {
  id: string;
  route: Route;
  target: string;
  title: string;
  body: string;
  missingBody?: string;
  placement?: "top" | "bottom" | "left" | "right";
};

export const tutorialCompletedKey = "company-brain-tutorial-completed";
export const tutorialStepKey = "company-brain-tutorial-step";

export const tutorialSteps: TutorialStep[] = [
  {
    id: "navigation",
    route: "/",
    target: "sidebar-toggle",
    title: "Open navigation",
    body: "Use this button to open the app navigation on mobile. Desktop keeps the navigation rail visible.",
    placement: "bottom",
  },
  {
    id: "sync",
    route: "/",
    target: "inbox-sync",
    title: "Sync Gmail",
    body: "Pull the latest catering threads into the Inbox. Production also runs the timed sync in the cluster.",
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
    title: "Review threads",
    body: "Select a visible thread to open details. Thread-specific tips appear only when thread panels are present.",
    missingBody: "No thread list is visible yet. Sync Gmail or clear filters to populate the queue, then open a thread for review.",
    placement: "right",
  },
  {
    id: "brain-search",
    route: "/brain",
    target: "brain-search",
    title: "Search Company Brain",
    body: "Approved operational knowledge is searchable and connected to source evidence.",
    placement: "bottom",
  },
  {
    id: "brain-details",
    route: "/brain",
    target: "brain-details",
    title: "Inspect records",
    body: "Open a record to see details, evidence, metadata, and usage notes.",
    missingBody: "Brain records are still loading or none match the current filters. Search and category filters control this panel.",
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
    body: "Zoho settings control invoice template import and invoice write readiness.",
    placement: "top",
  },
];
