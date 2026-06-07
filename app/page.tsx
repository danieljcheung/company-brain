"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  type WheelEvent,
} from "react";
import {
  AlertCircle,
  Archive,
  CalendarDays,
  CheckCircle2,
  Clock,
  DollarSign,
  Eye,
  FileBraces,
  FileText,
  Inbox,
  Info,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ChevronLeft,
  History,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SafetyStatus } from "./components/SafetyStatus";
import {
  extractEventDetails,
  type EventDetailsExtraction,
} from "./lib/inbox/eventDetails";
import {
  applyExactZohoPackageDescription,
  buildLocalInvoicePreview,
  formatMoneyCents,
  parseMoneyToCents,
} from "./lib/inbox/invoicePreview";
import {
  type CateringEvent,
  type CateringEventStatus,
  type EventCloseState,
  type InvoicePreview,
  type ThreadMessage,
} from "./lib/mockData";

type QueueFilter = "open" | "waiting" | "invoice" | "imported" | "follow_up" | "archive";
const triageSummaryMarker = "Needs triage before Needs Reply.";
type DetailTab = "thread" | "invoice" | "facts" | "history";
type MobilePane = "list" | "detail";
type DisplayAttachment = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storageRef?: string | null;
  lifecycleStatus?: string;
};
type DisplayThreadMessage = ThreadMessage & {
  attachments?: DisplayAttachment[];
};
type DisplayDraftExplanation = {
  confidence: number | null;
  missingFields: string[];
  evidenceSnippets: string[];
  warnings: string[];
};
type LinkedZohoInvoice = {
  invoiceId?: string;
  invoiceNumber?: string | null;
  status?: string | null;
  customerCreated?: boolean;
  emailSent?: {
    sentAt?: string;
    message?: string | null;
  };
};

type DisplayLatestCustomerMessage = {
  id: string;
  author: string;
  at: string;
  snippet: string;
};
type DisplayHistoryItem = {
  id: string;
  label: string;
  note: string | null;
  at: string;
};
type DisplayCateringEvent = CateringEvent & {
  thread: DisplayThreadMessage[];
  eventDetails?: EventDetailsExtraction;
  persistedEventId?: string;
  draftExplanation?: DisplayDraftExplanation;
  latestCustomerMessage?: DisplayLatestCustomerMessage;
  zohoInvoice?: LinkedZohoInvoice;
  history?: DisplayHistoryItem[];
};

type PersistedInboxEvent = {
  id: string;
  status: string;
  source: string;
  manualImport: boolean;
  extractedFields?: unknown;
  recommendedNextAction: string | null;
  createdAt: string;
  updatedAt: string;
  thread: {
    id: string;
    gmailThreadId: string;
    subject: string;
    isArchived: boolean;
    latestMessageAt: string | null;
    messageCount: number;
    firstSnippet: string | null;
    messages: Array<{
      id: string;
      gmailMessageId: string;
      subject: string | null;
      from: unknown;
      to: unknown;
      cc: unknown;
      snippet: string | null;
      bodyPlain: string | null;
      bodyHtml: string | null;
      sentAt: string | null;
      internalDate: string | null;
      attachments: Array<{
        id: string;
        filename: string;
        mimeType: string | null;
        sizeBytes: number | null;
        contentId: string | null;
        storageRef: string | null;
        lifecycleStatus?: string;
      }>;
    }>;
  };
  actions: Array<{
    id: string;
    actionType: string;
    note: string | null;
    createdAt: string;
  }>;
  drafts: Array<{
    id: string;
    subject: string | null;
    body: string;
    status: string;
    modelMetadata: unknown;
    createdAt: string;
    updatedAt: string;
    evidence: Array<{
      id: string;
      kind: string;
      evidenceText: string;
      confidence: number | null;
      locator: string | null;
    }>;
  }>;
  evidence: Array<{
    id: string;
    kind: string;
    evidenceText: string;
    confidence: number | null;
    locator: string | null;
  }>;
};

type GmailBackgroundSyncStatus = {
  active: boolean;
  started?: boolean;
  lastError: string | null;
  latestRun: {
    status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    threadsScanned: number;
    threadsMatched: number;
    messagesSynced: number;
    error: string | null;
  } | null;
  error?: string;
};

type ZohoIntegrationStatus = {
  product: "books" | "invoice";
  configured: boolean;
  connected: boolean;
  organizationId: string | null;
  externalWritesEnabled: boolean;
  canCreateInvoice: boolean;
  missing: string[];
};


type ZohoInvoiceTemplateStatus = {
  synced: boolean;
  record: {
    id: string;
    title: string;
    body: string;
    updatedAt: string;
    structuredData: {
      templateName?: string | null;
      currencyCode?: string | null;
      paymentTermsLabel?: string | null;
      notes?: string | null;
      terms?: string | null;
      lineItemShape?: Array<{
        name?: string | null;
        description?: string | null;
        quantityType?: string | null;
        rate?: number | null;
      }>;
    };
  } | null;
};

const queueFilters: Array<{
  label: string;
  value: QueueFilter;
  icon: typeof Inbox;
}> = [
  { label: "Needs Reply", value: "open", icon: Inbox },
  { label: "Waiting", value: "waiting", icon: Clock },
  { label: "Invoice Review", value: "invoice", icon: FileText },
  { label: "Needs Triage", value: "imported", icon: FileBraces },
  { label: "Follow-up", value: "follow_up", icon: History },
  { label: "Archive", value: "archive", icon: Archive },
];

const inboxSidebarStorageKey = "company-brain-inbox-sidebar-collapsed";
const longMessagePreviewLength = 1200;

function getStoredInboxSidebarCollapsed() {
  if (typeof window === "undefined") return false;

  const stored = window.localStorage.getItem(inboxSidebarStorageKey);
  return stored === "true";
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseLocalDate(value: string) {
  return new Date(value.replace(" ", "T"));
}

function formatRelativeDate(value: string) {
  const date = parseLocalDate(value);
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const dayMs = 1000 * 60 * 60 * 24;
  const hourMs = 1000 * 60 * 60;

  if (Number.isNaN(date.getTime())) return value;
  if (absMs < hourMs) return diffMs < 0 ? "just now" : "soon";
  if (absMs < dayMs) {
    const hours = Math.round(absMs / hourMs);
    return diffMs < 0 ? `${hours}h ago` : `in ${hours}h`;
  }

  const days = Math.round(absMs / dayMs);
  if (days < 14) return diffMs < 0 ? `${days}d ago` : `in ${days}d`;

  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function formatEventDate(value: string) {
  const date = parseLocalDate(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  })} (${formatRelativeDate(value)})`;
}

function sortByLatestCustomerReply(events: DisplayCateringEvent[]) {
  return [...events].sort(
    (a, b) =>
      new Date(b.latestCustomerReplyAt).getTime() -
      new Date(a.latestCustomerReplyAt).getTime(),
  );
}

function filterEvents(
  activeEvents: DisplayCateringEvent[],
  archived: DisplayCateringEvent[],
  importedReview: DisplayCateringEvent[],
  filter: QueueFilter,
) {
  if (filter === "imported") return sortByLatestCustomerReply(importedReview);
  if (filter === "archive") return sortByLatestCustomerReply(archived);

  const filtered = activeEvents.filter((event) => {
    if (filter === "waiting") return event.status === "waiting_on_customer";
    if (filter === "invoice") return event.status === "invoice_ready" || event.status === "invoiced";
    if (filter === "follow_up") return event.status === "follow_up";
    return event.status === "needs_approval" || event.status === "needs_correction";
  });

  return sortByLatestCustomerReply(filtered);
}

function mapPersistedStatus(status: string): CateringEventStatus {
  if (status === "awaiting_customer") return "waiting_on_customer";
  if (status === "invoice_ready") return "invoice_ready";
  if (status === "invoiced") return "invoiced";
  if (status === "complete") return "closed";
  if (status === "manual_review") return "needs_correction";
  if (status === "follow_up") return "follow_up";
  return "needs_approval";
}

function formatInboxSource(source: string) {
  return source
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type PersistedAddress = {
  name?: string | null;
  email?: string | null;
};

function isAddress(value: unknown): value is PersistedAddress {
  return (
    typeof value === "object" &&
    value !== null &&
    ("email" in value || "name" in value)
  );
}

function addressList(value: unknown): PersistedAddress[] {
  if (Array.isArray(value)) return value.filter(isAddress);
  if (isAddress(value)) return [value];
  return [];
}

function formatAddress(value: unknown) {
  const address = addressList(value)[0];
  if (!address) return "Unknown sender";
  return address.name || address.email || "Unknown sender";
}

function formatAddressEmail(value: unknown) {
  return addressList(value)[0]?.email ?? null;
}

function addressSearchText(value: unknown) {
  return addressList(value)
    .map((address) => `${address.name ?? ""} ${address.email ?? ""}`)
    .join(" ")
    .toLowerCase();
}

function isPopupPearlSender(value: unknown) {
  const text = addressSearchText(value);
  if (text.includes("wordpress") || text.includes("wix") || text.includes("no-reply") || text.includes("noreply") || text.includes("website")) {
    return false;
  }
  return text.includes("popuppearl.ca") || text.includes("popup pearl");
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanImportedEmailBody(value: string) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!normalized) return "";

  const lines = normalized.split("\n");
  const cleanedLines: string[] = [];
  const hardStopPatterns = [
    /^-{2,}\s*original message\s*-{2,}$/i,
    /^-{2,}\s*forwarded message\s*-{2,}$/i,
    /^on .{3,120}wrote:$/i,
    /^from:\s.+/i,
  ];
  const footerPatterns = [
    /^--\s*$/,
    /^sent from my (iphone|ipad|android|mobile)/i,
    /^unsubscribe\b/i,
    /\bunsubscribe\b/i,
    /\bmanage (your )?(preferences|subscription)\b/i,
    /\bview (this )?(email )?in (your )?browser\b/i,
    /\byou (are|'re) receiving this\b/i,
    /\bthis (email|message) (and any attachments )?(is|may be) confidential\b/i,
    /\bconfidentiality notice\b/i,
    /\bprivacy policy\b/i,
    /\ball rights reserved\b/i,
    /^copyright\b/i,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    const hasUsefulContent = cleanedLines.some((item) => item.trim().length > 0);

    if (/^>/.test(trimmed)) continue;
    if (hardStopPatterns.some((pattern) => pattern.test(trimmed))) break;
    if (hasUsefulContent && footerPatterns.some((pattern) => pattern.test(trimmed))) break;

    cleanedLines.push(line);
  }

  return cleanedLines
    .join("\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatBytes(value: number | null) {
  if (!value) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAttachmentSummary(
  attachment: PersistedInboxEvent["thread"]["messages"][number]["attachments"][number],
) {
  const details = [attachment.mimeType, formatBytes(attachment.sizeBytes)].filter(Boolean);

  return `${attachment.filename}${details.length ? ` (${details.join(", ")})` : ""}`;
}

function formatAttachmentLifecycle(status?: string) {
  if (status === "downloaded") return "Saved";
  if (status === "failed") return "Failed";
  return "Ready to view";
}

function canPreviewImageAttachment(attachment: DisplayAttachment) {
  return (
    attachment.mimeType?.toLowerCase().startsWith("image/") &&
    attachment.storageRef?.startsWith("local://")
  );
}

function formatHistoryAction(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function persistedMessageBody(
  message: PersistedInboxEvent["thread"]["messages"][number],
) {
  let rawText = message.bodyPlain?.trim() || "";

  if (rawText.includes("<br") || rawText.includes("<img") || rawText.includes("<p")) {
    rawText = stripHtml(rawText);
  }

  if (!rawText) {
    rawText = message.bodyHtml ? stripHtml(message.bodyHtml) : "";
  }
  if (!rawText) {
    rawText = message.snippet?.trim() || "";
  }

  const text = cleanImportedEmailBody(rawText);
  return text || "No text body was imported for this Gmail message.";
}

function splitMessageBody(body: string) {
  const marker = "\n\nAttachments:\n";
  const markerIndex = body.indexOf(marker);

  if (markerIndex === -1) {
    return { text: body, attachments: [] };
  }

  return {
    text: body.slice(0, markerIndex).trim(),
    attachments: body
      .slice(markerIndex + marker.length)
      .split("\n")
      .map((line) => line.replace(/^- /, "").trim())
      .filter(Boolean),
  };
}

function parseMessageTime(value: string) {
  const parsed = new Date(value).getTime();
  if (!Number.isNaN(parsed)) return parsed;

  const localParsed = parseLocalDate(value).getTime();
  return Number.isNaN(localParsed) ? 0 : localParsed;
}

function latestCustomerMessageFromThread(
  messages: DisplayThreadMessage[],
): DisplayLatestCustomerMessage | undefined {
  const latest = messages
    .filter((message) => message.sender === "customer")
    .sort((a, b) => parseMessageTime(b.at) - parseMessageTime(a.at))[0];

  if (!latest) return undefined;

  return {
    id: latest.id,
    author: latest.author,
    at: latest.at,
    snippet: latestMessageSnippet(latest.body),
  };
}

function latestMessageSnippet(value: string) {
  const text = cleanImportedEmailBody(value)
    .replace(/\s+/g, " ")
    .replace(/^no text body was imported for this gmail message\.$/i, "")
    .trim();

  if (!text) return "No readable message text was imported.";
  if (text.length <= 180) return text;

  return `${text.slice(0, 177).trimEnd()}...`;
}

function hasRealCustomerSender(event: PersistedInboxEvent) {
  return event.thread.messages.some((message) => {
    const text = addressSearchText(message.from);
    return text.length > 0 && !text.includes("unknown") && !isPopupPearlSender(message.from);
  });
}

function hasUnmatchedImportIndicator(event: PersistedInboxEvent) {
  const text = [
    event.recommendedNextAction,
    ...event.actions.flatMap((action) => [action.actionType, action.note]),
    ...event.evidence.map((evidence) => evidence.evidenceText),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(no_safe_inbox_trigger|no trigger|unmatched|manual review|review manually|not matched|rejected)\b/.test(
    text,
  );
}

function shouldReviewImportedEvent(event: PersistedInboxEvent) {
  if (
    event.status === "needs_reply" ||
    event.status === "awaiting_customer" ||
    event.status === "invoice_ready" ||
    event.status === "invoiced" ||
    event.status === "follow_up" ||
    event.status === "complete"
  ) {
    return false;
  }

  const isManualImport = event.manualImport || event.source === "MANUAL_IMPORT";
  const lowSignalImport =
    event.status === "manual_review" ||
    event.thread.messageCount <= 1 ||
    !hasRealCustomerSender(event);
  const needsManualReview = event.status === "manual_review" || hasUnmatchedImportIndicator(event);

  return lowSignalImport || (isManualImport && needsManualReview);
}

function requiresQuoteDetailsForEvent(event: PersistedInboxEvent) {
  if (!isRecord(event.extractedFields)) return true;
  if (event.extractedFields.requiresQuoteDetails === false) return false;
  if (event.extractedFields.requiresQuoteDetails === true) return true;
  return (
    event.extractedFields.threadCategory === "customer_inquiry" ||
    (event.extractedFields.threadCategory === "customer_followup" &&
      stringArrayValue(event.extractedFields.missingFields).length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArrayValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapPersistedDraftStatus(status: string): CateringEvent["draftReply"]["status"] {
  if (status === "REJECTED") return "rejected";
  if (status === "APPROVED" || status === "SENT") return "approved";
  return "draft";
}

function draftExplanationFromMetadata(
  draft: PersistedInboxEvent["drafts"][number] | undefined,
  fallbackMissingFields: string[],
): DisplayDraftExplanation | undefined {
  if (!draft) return undefined;

  const metadata = draft.modelMetadata;
  if (!isRecord(metadata)) {
    return {
      confidence: null,
      missingFields: fallbackMissingFields,
      evidenceSnippets: draft.evidence.map((item) => item.evidenceText).slice(0, 4),
      warnings: ["Local draft only. No Gmail draft or send occurred."],
    };
  }

  return {
    confidence: numberValue(metadata.confidence),
    missingFields: stringArrayValue(metadata.missingFields).length
      ? stringArrayValue(metadata.missingFields)
      : fallbackMissingFields,
    evidenceSnippets: stringArrayValue(metadata.evidenceSnippets).length
      ? stringArrayValue(metadata.evidenceSnippets)
      : draft.evidence.map((item) => item.evidenceText).slice(0, 4),
    warnings: stringArrayValue(metadata.warnings).length
      ? stringArrayValue(metadata.warnings)
      : ["Local draft only. No Gmail draft or send occurred."],
  };
}

function mapPersistedInboxEvent(
  event: PersistedInboxEvent,
  options: { reviewImport?: boolean } = {},
): DisplayCateringEvent {
  const status = mapPersistedStatus(event.status);
  const latestAt = event.thread.latestMessageAt ?? event.updatedAt ?? event.createdAt;
  const sourceLabel = formatInboxSource(event.source);
  const importLabel = options.reviewImport
    ? "Needs triage"
    : event.manualImport
      ? "Manual Gmail import"
      : "Gmail import";
  const recommendedNextAction =
    event.recommendedNextAction ?? "Review the imported Gmail thread before replying.";
  const threadMessages = event.thread.messages.map((message) => {
    const sentAt = message.sentAt ?? message.internalDate ?? latestAt;
    const isOwner = isPopupPearlSender(message.from);

    return {
      id: message.id,
      sender: isOwner ? ("owner" as const) : ("customer" as const),
      author: formatAddress(message.from),
      at: sentAt,
      body: persistedMessageBody(message),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        filename: formatAttachmentSummary(attachment),
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        storageRef: attachment.storageRef,
        lifecycleStatus: attachment.lifecycleStatus,
      })),
    };
  });
  const latestCustomerMessage = latestCustomerMessageFromThread(threadMessages);
  const latestCustomerPrompt = latestCustomerMessage
    ? `Latest customer message from ${latestCustomerMessage.author}: "${latestCustomerMessage.snippet}"`
    : "No customer message was identified after sender classification.";
  const latestCustomerNextAction = latestCustomerMessage
    ? `${recommendedNextAction} Base the reply on the latest customer message: "${latestCustomerMessage.snippet}"`
    : recommendedNextAction;
  const firstCustomerMessage = event.thread.messages.find(
    (message) => !isPopupPearlSender(message.from),
  );
  let customerLabel = firstCustomerMessage
    ? formatAddress(firstCustomerMessage.from)
    : importLabel;
  let customerEmail = firstCustomerMessage
    ? formatAddressEmail(firstCustomerMessage.from)
    : null;

  const extracted = event.extractedFields;
  if (extracted && typeof extracted === "object") {
    if ("customerEmail" in extracted && typeof (extracted as { customerEmail: unknown }).customerEmail === "string") {
      const emailVal = (extracted as { customerEmail: string }).customerEmail.trim();
      if (emailVal.includes("@")) {
        customerEmail = emailVal;
      }
    }
    if ("customerName" in extracted && typeof (extracted as { customerName: unknown }).customerName === "string") {
      const nameVal = (extracted as { customerName: string }).customerName.trim();
      if (nameVal) {
        customerLabel = nameVal;
      }
    }
  }
  const eventDetails = extractEventDetails({
    persistedFields: event.extractedFields,
    fallbackCustomerName: firstCustomerMessage ? customerLabel : undefined,
    fallbackCustomerEmail: customerEmail,
    requireQuoteDetails: requiresQuoteDetailsForEvent(event),
    messages: threadMessages.map((message) => ({
      id: message.id,
      author: message.author,
      body: message.body,
      isCustomer: message.sender === "customer",
      fromEmail: message.sender === "customer" ? customerEmail : null,
    })),
  });
  const missingInfo =
    status === "needs_correction" || options.reviewImport
      ? ["Review imported Gmail thread", ...eventDetails.missingFields]
      : eventDetails.missingFields;
  const missingSummary = eventDetails.missingFields.length
    ? `Missing: ${eventDetails.missingFields.join(", ")}.`
    : eventDetails.invoiceReadiness.ready
      ? "Core event details look invoice-ready after human review."
      : "Core event details were extracted for review.";
  const latestDraft = event.drafts.find((draft) => draft.status === "DRAFT");
  const draftExplanation = draftExplanationFromMetadata(
    latestDraft,
    eventDetails.missingFields,
  );
  const detailFacts = eventDetails.fields.map((field) => ({
    label: field.label,
    value: field.value,
    confidence: field.confidence,
    sourceMessageId:
      field.source === "persisted"
        ? "persisted extraction"
        : `${field.sourceMessageId}: ${field.sourceSnippet}`,
  }));
  const zohoInvoice = isRecord(extracted) && isRecord(extracted.zohoInvoice)
    ? (extracted.zohoInvoice as LinkedZohoInvoice)
    : undefined;
  const analyzedThreadTitle =
    isRecord(extracted) &&
    isRecord(extracted.threadTitle) &&
    typeof extracted.threadTitle.title === "string" &&
    extracted.threadTitle.title.trim()
      ? extracted.threadTitle.title.trim()
      : null;
  const invoicePreview = buildLocalInvoicePreview({
    eventId: event.id,
    eventDetails,
    extractedFields: event.extractedFields,
  });

  return {
    id: `persisted-${event.id}`,
    persistedEventId: event.id,
    threadId: event.thread.gmailThreadId,
    customer: options.reviewImport ? "Needs triage" : customerLabel,
    company: options.reviewImport ? sourceLabel : sourceLabel,
    title: options.reviewImport
      ? `Needs triage: ${analyzedThreadTitle ?? event.thread.subject ?? "Imported Gmail thread"}`
      : (analyzedThreadTitle ?? event.thread.subject ?? "Imported Gmail thread"),
    eventDate: latestAt,
    latestCustomerReplyAt: latestCustomerMessage?.at ?? latestAt,
    status,
    priority:
      status === "needs_approval" || status === "needs_correction" || status === "invoice_ready" || status === "follow_up"
        ? "high"
        : "medium",
    summary: options.reviewImport
      ? `${triageSummaryMarker} ${importLabel} from ${sourceLabel}. Confirm the thread is real customer work before drafting. ${missingSummary}`
      : `${importLabel} from ${sourceLabel}. ${missingSummary}`,
    missingInfo,
    facts: [
      ...detailFacts,
      {
        label: "Imported source",
        value: `${sourceLabel} / ${
          options.reviewImport
            ? "needs triage"
            : event.manualImport
              ? "manual import"
              : "automatic import"
        }`,
        confidence: 1,
        sourceMessageId: event.thread.gmailThreadId,
      },
      {
        label: "Gmail thread ID",
        value: event.thread.gmailThreadId,
        confidence: 1,
        sourceMessageId: event.thread.gmailThreadId,
      },
      {
        label: "Message count",
        value: `${event.thread.messageCount}`,
        confidence: 1,
        sourceMessageId: event.thread.gmailThreadId,
      },
      {
        label: "Recommended next action",
        value: latestCustomerNextAction,
        confidence: 1,
        sourceMessageId: latestCustomerMessage?.id ?? event.id,
      },
      {
        label: "Agent organization",
        value: options.reviewImport
          ? "Grouped by Gmail thread and held in Needs Triage until the customer-work signal is clear."
          : "Imported and grouped by Gmail thread. Drafting/extraction can be added after review; no AI action has run here.",
        confidence: 1,
        sourceMessageId: event.thread.gmailThreadId,
      },
      ...event.evidence.map((item) => ({
        label: formatInboxSource(item.kind),
        value: item.evidenceText,
        confidence: item.confidence ?? 1,
        sourceMessageId: item.locator ?? item.id,
      })),
    ],
    thread: threadMessages.length
      ? threadMessages
      : [
          {
            id: `${event.id}-empty-thread`,
            sender: "customer",
            author: importLabel,
            at: latestAt,
            body:
              cleanImportedEmailBody(event.thread.firstSnippet ?? "") ||
              "This Inbox event exists, but no Gmail messages were returned by the API.",
          },
        ],
    draftReply: {
      subject: latestDraft?.subject ?? `Re: ${event.thread.subject || "Imported Gmail thread"}`,
      body:
        latestDraft
          ? latestDraft.body
          : status === "waiting_on_customer" || status === "closed"
          ? "No active draft is queued for this imported Gmail thread."
          : options.reviewImport
            ? "This thread needs triage. Confirm it is customer work before drafting a reply."
            : eventDetails.missingFields.length
              ? `${latestCustomerPrompt}\n\nImported Gmail thread needs these details before a real draft is generated:\n\n- ${eventDetails.missingFields.join("\n- ")}\n\nPlaceholder only. Ask for the missing details manually before approval.`
              : `${latestCustomerPrompt}\n\n${latestCustomerNextAction}\n\nPlaceholder only. No AI draft has been generated.`,
      status: latestDraft
        ? mapPersistedDraftStatus(latestDraft.status)
        : status === "waiting_on_customer" || status === "closed"
          ? "approved"
          : "draft",
    },
    correctionCandidates: [
      latestCustomerMessage
        ? `Check latest customer message (${latestCustomerMessage.author}): "${latestCustomerMessage.snippet}"`
        : "No customer message was identified after sender classification.",
      "Open the source Gmail thread if the full message body is needed.",
      ...eventDetails.invoiceReadiness.hints,
    ],
    invoicePreview,
    eventDetails,
    draftExplanation,
    latestCustomerMessage,
    zohoInvoice,
    history: event.actions.map((action) => ({
      id: action.id,
      label: formatHistoryAction(action.actionType),
      note: action.note,
      at: action.createdAt,
    })),
    closeState: status === "closed" ? "completed" : undefined,
    closedAt: status === "closed" ? event.updatedAt : undefined,
    archiveNote: status === "closed" ? "Imported Gmail thread marked complete." : undefined,
  };
}

function statusVariant(status: CateringEventStatus) {
  if (status === "needs_approval" || status === "needs_correction") {
    return "destructive";
  }
  if (status === "invoice_ready" || status === "invoiced") return "default";
  return "secondary";
}

function eventTone(event: DisplayCateringEvent) {
  if (isImportedReviewEvent(event)) return toneByKey("review");
  return toneByStatus(event.status);
}

function toneByStatus(status: CateringEventStatus) {
  if (status === "invoice_ready" || status === "invoiced") return toneByKey("ready");
  if (status === "needs_correction") return toneByKey("missing");
  if (status === "waiting_on_customer") return toneByKey("waiting");
  if (status === "follow_up") return toneByKey("waiting");
  if (status === "closed") return toneByKey("archived");
  return toneByKey("active");
}

function toneByQueue(value: QueueFilter) {
  if (value === "invoice") return toneByKey("ready");
  if (value === "waiting") return toneByKey("waiting");
  if (value === "imported") return toneByKey("review");
  if (value === "follow_up") return toneByKey("waiting");
  if (value === "archive") return toneByKey("archived");
  return toneByKey("active");
}

function toneByKey(key: "active" | "missing" | "ready" | "review" | "waiting" | "archived") {
  const tones = {
    active: {
      rail: "border-l-blue-500",
      soft: "border-blue-400/30 bg-blue-500/10",
      chip: "border-blue-400/35 bg-blue-500/10 text-blue-700 dark:text-blue-200",
      icon: "text-blue-600 dark:text-blue-300",
      dot: "bg-blue-500",
      selected: "bg-blue-500/10 ring-blue-400/40",
      hover: "hover:bg-blue-500/10",
      button: "border-blue-400/35 bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-200",
    },
    missing: {
      rail: "border-l-amber-500",
      soft: "border-amber-400/35 bg-amber-500/10",
      chip: "border-amber-400/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      icon: "text-amber-600 dark:text-amber-300",
      dot: "bg-amber-500",
      selected: "bg-amber-500/10 ring-amber-400/40",
      hover: "hover:bg-amber-500/10",
      button: "border-amber-400/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200",
    },
    ready: {
      rail: "border-l-emerald-500",
      soft: "border-emerald-400/35 bg-emerald-500/10",
      chip: "border-emerald-400/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
      icon: "text-emerald-600 dark:text-emerald-300",
      dot: "bg-emerald-500",
      selected: "bg-emerald-500/10 ring-emerald-400/40",
      hover: "hover:bg-emerald-500/10",
      button: "border-emerald-400/40 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-200",
    },
    review: {
      rail: "border-l-violet-500",
      soft: "border-violet-400/30 bg-violet-500/10",
      chip: "border-violet-400/35 bg-violet-500/10 text-violet-800 dark:text-violet-200",
      icon: "text-violet-600 dark:text-violet-300",
      dot: "bg-violet-500",
      selected: "bg-violet-500/10 ring-violet-400/40",
      hover: "hover:bg-violet-500/10",
      button: "border-violet-400/35 bg-violet-500/10 text-violet-800 hover:bg-violet-500/15 dark:text-violet-200",
    },
    waiting: {
      rail: "border-l-sky-500",
      soft: "border-sky-400/30 bg-sky-500/10",
      chip: "border-sky-400/35 bg-sky-500/10 text-sky-800 dark:text-sky-200",
      icon: "text-sky-600 dark:text-sky-300",
      dot: "bg-sky-500",
      selected: "bg-sky-500/10 ring-sky-400/40",
      hover: "hover:bg-sky-500/10",
      button: "border-sky-400/35 bg-sky-500/10 text-sky-800 hover:bg-sky-500/15 dark:text-sky-200",
    },
    archived: {
      rail: "border-l-slate-400",
      soft: "border-slate-300/30 bg-slate-500/10",
      chip: "border-slate-300/35 bg-slate-500/10 text-slate-700 dark:text-slate-200",
      icon: "text-slate-500",
      dot: "bg-slate-400",
      selected: "bg-slate-500/10 ring-slate-400/35",
      hover: "hover:bg-slate-500/10",
      button: "border-slate-300/35 bg-slate-500/10 text-slate-700 hover:bg-slate-500/15 dark:text-slate-200",
    },
  };

  return tones[key];
}

function getWorkflowSummary(event: DisplayCateringEvent) {
  const latestCustomerContext = event.latestCustomerMessage
    ? `Latest customer: "${event.latestCustomerMessage.snippet}"`
    : null;

  if (isImportedReviewEvent(event)) {
    return {
      label: "Needs triage",
      action: "Confirm this Gmail thread is customer work before drafting.",
      icon: FileBraces,
      badgeVariant: "secondary" as const,
    };
  }

  if (event.status === "closed") {
    return {
      label: event.closeState ? `Archived: ${formatStatus(event.closeState)}` : "Archived",
      action: event.archiveNote ?? "Review for Company Brain extraction.",
      icon: Archive,
      badgeVariant: "secondary" as const,
    };
  }

  if (event.status === "waiting_on_customer") {
    return {
      label: "Waiting customer",
      action: "No fresh reply until the customer answers.",
      icon: Clock,
      badgeVariant: "secondary" as const,
    };
  }

  if (event.status === "invoiced") {
    return {
      label: "Invoiced",
      action: "Zoho invoice was emailed to the customer.",
      icon: DollarSign,
      badgeVariant: "default" as const,
    };
  }

  if (event.status === "invoice_ready") {
    return {
      label: "Ready to invoice",
      action: latestCustomerContext
        ? `${latestCustomerContext} Review invoice reply against that message.`
        : event.invoicePreview
          ? "Review invoice preview and approve the local reply."
          : "Invoice details look ready, but no preview exists.",
      icon: DollarSign,
      badgeVariant: "default" as const,
    };
  }

  if (event.status === "needs_correction") {
    const gapCopy = event.missingInfo.length
      ? `${event.missingInfo.length} gap${event.missingInfo.length === 1 ? "" : "s"}`
      : "the open questions";

    return {
      label: "Missing info",
      action: latestCustomerContext
        ? `${latestCustomerContext} Resolve ${gapCopy} before replying.`
        : event.missingInfo.length
          ? `Resolve ${event.missingInfo.length} gap${event.missingInfo.length === 1 ? "" : "s"} before replying.`
          : "Owner review needed before this can move forward.",
      icon: AlertCircle,
      badgeVariant: "destructive" as const,
    };
  }

  return {
    label: "Needs approval",
    action: latestCustomerContext
      ? `${latestCustomerContext} Review the local draft for that customer message.`
      : event.missingInfo.length
        ? "Review the drafted request for missing details."
        : "Review the local draft before any customer action.",
    icon: CheckCircle2,
    badgeVariant: "destructive" as const,
  };
}

function canShowDraftComposer(event: DisplayCateringEvent) {
  if (isImportedReviewEvent(event)) return false;
  return (
    event.status === "needs_approval" ||
    event.status === "needs_correction" ||
    event.status === "invoice_ready" ||
    event.status === "follow_up"
  );
}

function isPersistedDisplayEvent(event: DisplayCateringEvent) {
  return event.id.startsWith("persisted-");
}

function isImportedReviewEvent(event: DisplayCateringEvent) {
  return isPersistedDisplayEvent(event) && event.summary.includes(triageSummaryMarker);
}

export default function CustomerOpsPage() {
  const [mounted, setMounted] = useState(false);
  const [events, setEvents] = useState<CateringEvent[]>([]);
  const [archive, setArchive] = useState<CateringEvent[]>([]);
  const [persistedEvents, setPersistedEvents] = useState<PersistedInboxEvent[]>([]);
  const [persistedLoading, setPersistedLoading] = useState(true);
  const [gmailSyncLoading, setGmailSyncLoading] = useState(false);
  const [gmailSyncMessage, setGmailSyncMessage] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [inboxSidebarCollapsed, setInboxSidebarCollapsed] = useState(
    getStoredInboxSidebarCollapsed,
  );
  const [activeTab, setActiveTab] = useState<DetailTab>("thread");
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftActionMessage, setDraftActionMessage] = useState("");
  const [draftActionLoading, setDraftActionLoading] = useState(false);
  const [analysisActionMessage, setAnalysisActionMessage] = useState("");
  const [analysisActionLoading, setAnalysisActionLoading] = useState(false);
  const [attachmentActionId, setAttachmentActionId] = useState("");
  const [zohoStatus, setZohoStatus] = useState<ZohoIntegrationStatus | null>(null);
  const [zohoInvoiceTemplate, setZohoInvoiceTemplate] =
    useState<ZohoInvoiceTemplateStatus | null>(null);

  useEffect(() => {
    setMounted(true);
    void loadPersistedInboxEvents();
  }, []);


  useEffect(() => {
    window.localStorage.setItem(
      inboxSidebarStorageKey,
      String(inboxSidebarCollapsed),
    );
  }, [inboxSidebarCollapsed]);

  async function loadPersistedInboxEvents() {
    setPersistedLoading(true);
    try {
      const response = await fetch("/api/inbox/events?summary=1", { cache: "no-store" });
      const body = (await response.json()) as {
        events?: PersistedInboxEvent[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load inbox events.");
      setPersistedEvents(body.events ?? []);
    } catch {
      setPersistedEvents([]);
    } finally {
      setPersistedLoading(false);
    }
  }


  async function loadPersistedInboxEventDetail(eventId: string) {
    try {
      const response = await fetch(`/api/inbox/events?eventId=${encodeURIComponent(eventId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        events?: PersistedInboxEvent[];
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
  }
  async function loadZohoStatus() {
    try {
      const response = await fetch("/api/integrations/zoho/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Zoho status failed.");
      setZohoStatus((await response.json()) as ZohoIntegrationStatus);
    } catch {
      setZohoStatus(null);
    }
  }

  async function loadZohoInvoiceTemplate() {
    try {
      const response = await fetch("/api/integrations/zoho/invoice-template", {
        cache: "no-store",
      });
      const body = (await response.json()) as ZohoInvoiceTemplateStatus;
      if (!response.ok) throw new Error("Could not load Zoho invoice template.");
      setZohoInvoiceTemplate(body);
    } catch {
      setZohoInvoiceTemplate(null);
    }
  }

  async function syncGmailInbox() {
    setGmailSyncLoading(true);
    setGmailSyncMessage("Starting background Gmail sync...");
    try {
      const response = await fetch("/api/inbox/sync/gmail/background", { method: "POST" });
      const body = (await response.json()) as GmailBackgroundSyncStatus;
      if (!response.ok) throw new Error(body.error ?? "Gmail sync failed.");
      setGmailSyncMessage(
        body.started ? "Background sync started." : "A Gmail sync is already running.",
      );

      const finished = await waitForBackgroundGmailSync();
      if (finished.lastError) throw new Error(finished.lastError);
      const latestRun = finished.latestRun;
      if (latestRun?.status === "FAILED") {
        throw new Error(latestRun.error ?? "Gmail sync failed.");
      }
      if (latestRun?.status === "SUCCEEDED") {
        setGmailSyncMessage(
          `Synced ${latestRun.threadsMatched} of ${latestRun.threadsScanned} threads (${latestRun.messagesSynced} messages).`,
        );
      } else {
        setGmailSyncMessage("Background sync is still running.");
      }
      await loadPersistedInboxEvents();
    } catch (error) {
      setGmailSyncMessage(
        error instanceof Error ? error.message : "Gmail sync failed.",
      );
    } finally {
      setGmailSyncLoading(false);
    }
  }

  async function waitForBackgroundGmailSync() {
    let latest: GmailBackgroundSyncStatus | null = null;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await delay(2000);
      const response = await fetch("/api/inbox/sync/gmail/background", {
        cache: "no-store",
      });
      const body = (await response.json()) as GmailBackgroundSyncStatus;
      if (!response.ok) throw new Error(body.error ?? "Gmail sync status failed.");
      latest = body;
      if (!body.active) return body;
      setGmailSyncMessage(`Background sync running${".".repeat((attempt % 3) + 1)}`);
    }
    return latest ?? { active: true, lastError: null, latestRun: null };
  }

  const mappedPersistedEvents = useMemo(
    () =>
      persistedEvents.map((event) => {
        const reviewImport = shouldReviewImportedEvent(event);
        return mapPersistedInboxEvent(event, { reviewImport });
      }),
    [persistedEvents],
  );
  const persistedImportedReviewEvents = useMemo(
    () =>
      mappedPersistedEvents.filter(
        (event) => event.status !== "closed" && isImportedReviewEvent(event),
      ),
    [mappedPersistedEvents],
  );
  const persistedActiveEvents = useMemo(
    () =>
      mappedPersistedEvents.filter(
        (event) => event.status !== "closed" && !isImportedReviewEvent(event),
      ),
    [mappedPersistedEvents],
  );
  const persistedArchivedEvents = useMemo(
    () => mappedPersistedEvents.filter((event) => event.status === "closed"),
    [mappedPersistedEvents],
  );
  const hasPersistedEvents = mappedPersistedEvents.length > 0;
  const activeEvents = useMemo<DisplayCateringEvent[]>(
    () => (hasPersistedEvents ? persistedActiveEvents : events),
    [events, hasPersistedEvents, persistedActiveEvents],
  );
  const archivedInboxEvents = useMemo<DisplayCateringEvent[]>(
    () => (hasPersistedEvents ? persistedArchivedEvents : archive),
    [archive, hasPersistedEvents, persistedArchivedEvents],
  );
  const visibleEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = filterEvents(
      activeEvents,
      archivedInboxEvents,
      persistedImportedReviewEvents,
      filter,
    );
    if (!query) return filtered;

    return filtered.filter((event) =>
      [event.title, event.customer, event.company, event.eventDate, event.summary, event.threadId]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [
    activeEvents,
    archivedInboxEvents,
    filter,
    persistedImportedReviewEvents,
    searchQuery,
  ]);

  const selectedEvent =
    visibleEvents.find((event) => event.id === selectedId) ??
    visibleEvents[0];

  useEffect(() => {
    if (!selectedEvent || !isPersistedDisplayEvent(selectedEvent)) return;
    const persistedEvent = persistedEvents.find((event) => event.id === selectedEvent.persistedEventId);
    if (!persistedEvent) return;
    const hasFullThread =
      persistedEvent.thread.messages.length >= persistedEvent.thread.messageCount &&
      persistedEvent.thread.messages.every((message) => message.bodyPlain !== null || message.bodyHtml !== null);
    if (!hasFullThread) void loadPersistedInboxEventDetail(persistedEvent.id);
  }, [persistedEvents, selectedEvent]);

  useEffect(() => {
    if (activeTab !== "invoice" && selectedEvent?.status !== "invoice_ready") return;
    if (!zohoStatus) void loadZohoStatus();
    if (!zohoInvoiceTemplate) void loadZohoInvoiceTemplate();
  }, [activeTab, selectedEvent?.status, zohoInvoiceTemplate, zohoStatus]);

  useEffect(() => {
    if (!selectedEvent) {
      setDraftBody("");
      return;
    }

    setDraftBody(selectedEvent.draftReply.body);
    if (!selectedId) setSelectedId(selectedEvent.id);
  }, [selectedEvent, selectedId]);

  const queueCounts = {
    open: activeEvents.filter(
      (event) => event.status === "needs_approval" || event.status === "needs_correction",
    ).length,
    waiting: activeEvents.filter((event) => event.status === "waiting_on_customer").length,
    invoice: activeEvents.filter((event) => event.status === "invoice_ready" || event.status === "invoiced").length,
    follow_up: activeEvents.filter((event) => event.status === "follow_up").length,
    imported: persistedImportedReviewEvents.length,
    archive: archivedInboxEvents.length,
  };

  function selectFilter(nextFilter: QueueFilter) {
    const nextEvents = filterEvents(
      activeEvents,
      archivedInboxEvents,
      persistedImportedReviewEvents,
      nextFilter,
    );
    setFilter(nextFilter);
    setActiveTab(nextFilter === "archive" ? "history" : "thread");
    setMobilePane("list");
    if (nextEvents[0]) {
      setSelectedId(nextEvents[0].id);
      setDraftBody(nextEvents[0].draftReply.body);
    } else {
      setSelectedId("");
      setDraftBody("");
    }
  }

  function selectEvent(event: DisplayCateringEvent) {
    setSelectedId(event.id);
    setDraftBody(event.draftReply.body);
    setDraftActionMessage("");
    setAnalysisActionMessage("");
    setActiveTab(filter === "archive" ? "history" : "thread");
    setMobilePane("detail");
  }

  async function runPersistedAgentAnalysis() {
    if (!selectedEvent?.persistedEventId) return;

    setAnalysisActionLoading(true);
    setAnalysisActionMessage("Running agent analysis...");

    try {
      const response = await fetch(
        `/api/inbox/events/${selectedEvent.persistedEventId}/analysis`,
        { method: "POST" },
      );
      const body = (await response.json()) as {
        event?: { status: string; recommendedNextAction: string | null };
        draft?: { body: string };
        draftSkipped?: string | null;
        aiExtractionError?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Agent analysis failed.");

      if (body.draft?.body) setDraftBody(body.draft.body);
      setAnalysisActionMessage(
        body.aiExtractionError
          ? `Analysis saved with fallback: ${body.aiExtractionError}`
          : body.draftSkipped
            ? `Analysis saved. Draft skipped: ${body.draftSkipped}`
            : "Analysis and local draft refreshed. No Gmail action occurred.",
      );
      await loadPersistedInboxEvents();
    } catch (error) {
      setAnalysisActionMessage(
        error instanceof Error ? error.message : "Agent analysis failed.",
      );
    } finally {
      setAnalysisActionLoading(false);
    }
  }

  async function sendPersistedDraft() {
    if (!selectedEvent?.persistedEventId) return;

    setDraftActionLoading(true);
    setDraftActionMessage("Sending email via Gmail...");

    try {
      const response = await fetch(`/api/inbox/events/${selectedEvent.persistedEventId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draftBody }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Failed to send email.");

      setDraftBody("");
      setDraftActionMessage("Email sent successfully!");
      await loadPersistedInboxEvents();
    } catch (error) {
      setDraftActionMessage(error instanceof Error ? error.message : "Failed to send email.");
    } finally {
      setDraftActionLoading(false);
    }
  }

  async function runPersistedDraftAction(intent: "generate" | "regenerate" | "reject") {
    if (!selectedEvent?.persistedEventId) return;

    setDraftActionLoading(true);
    setDraftActionMessage(
      intent === "reject"
        ? "Rejecting local draft..."
        : intent === "regenerate"
          ? "Regenerating local draft..."
          : "Generating local draft...",
    );

    try {
      const response = await fetch(`/api/inbox/events/${selectedEvent.persistedEventId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      let body: { draft?: { body: string }; actionType?: string; error?: string } = {};
      if (response.status !== 204) {
        body = (await response.json()) as typeof body;
      }
      if (!response.ok) throw new Error(body.error ?? "Draft action failed.");

      if (response.status === 204) {
        setDraftActionMessage("No new draft generated. The latest message in this thread is already from us.");
      } else {
        if (intent === "reject") {
          setDraftBody("");
        } else if (body.draft?.body) {
          setDraftBody(body.draft.body);
        }
        setDraftActionMessage(
          intent === "reject"
            ? "Local draft rejected. No Gmail action occurred."
            : "Local draft saved. No Gmail draft or send occurred.",
        );
      }
      await loadPersistedInboxEvents();
    } catch (error) {
      setDraftActionMessage(error instanceof Error ? error.message : "Draft action failed.");
    } finally {
      setDraftActionLoading(false);
    }
  }

  async function updatePersistedStatus(
    intent: "needs_reply" | "awaiting_customer" | "manual_review" | "invoice_ready" | "follow_up" | "reopen",
  ) {
    if (!selectedEvent?.persistedEventId) return;

    setDraftActionMessage("Updating triage status...");
    try {
      const response = await fetch(
        `/api/inbox/events/${selectedEvent.persistedEventId}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Status update failed.");
      setDraftActionMessage(
        selectedEvent.status === "closed" || intent === "reopen"
          ? "Thread reopened locally. No Gmail action occurred."
          : "Triage status updated locally. No Gmail action occurred.",
      );
      await loadPersistedInboxEvents();
      setFilter(queueFilterForStatusIntent(intent));
      setActiveTab("thread");
      setSelectedId(`persisted-${selectedEvent.persistedEventId}`);
      setMobilePane("detail");
    } catch (error) {
      setDraftActionMessage(error instanceof Error ? error.message : "Status update failed.");
    }
  }

  async function runAttachmentAction(
    attachmentId: string,
    intent: "view",
  ) {
    const previewWindow = window.open("", "_blank", "noreferrer");
    setAttachmentActionId(`${attachmentId}:${intent}`);
    setAnalysisActionMessage("Opening attachment...");
    try {
      const response = await fetch(`/api/inbox/attachments/${attachmentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Attachment action failed.");
      if (previewWindow) {
        previewWindow.location.href = `/api/inbox/attachments/${attachmentId}`;
      } else {
        window.open(`/api/inbox/attachments/${attachmentId}`, "_blank", "noreferrer");
      }
      setAnalysisActionMessage("Attachment opened locally.");
      await loadPersistedInboxEvents();
    } catch (error) {
      previewWindow?.close();
      setAnalysisActionMessage(error instanceof Error ? error.message : "Attachment action failed.");
    } finally {
      setAttachmentActionId("");
    }
  }

  function queueFilterForStatusIntent(
    intent: "needs_reply" | "awaiting_customer" | "manual_review" | "invoice_ready" | "follow_up" | "reopen",
  ): QueueFilter {
    if (intent === "awaiting_customer") return "waiting";
    if (intent === "invoice_ready") return "invoice";
    if (intent === "manual_review") return "imported";
    if (intent === "follow_up") return "follow_up";
    return "open";
  }

  function updateSelectedTitle(title: string) {
    if (!selectedEvent) return;
    setEvents((current) =>
      current.map((event) =>
        event.id === selectedEvent.id
          ? {
              ...event,
              title,
            }
          : event,
      ),
    );
  }

  function updateSelected(status: CateringEventStatus, draftStatus?: CateringEvent["draftReply"]["status"]) {
    if (!selectedEvent || selectedEvent.status === "closed") return;

    setEvents((current) =>
      current.map((event) =>
        event.id === selectedEvent.id
          ? {
              ...event,
              status,
              draftReply: {
              ...event.draftReply,
              body: draftBody,
              status:
                draftStatus ??
                (status === "needs_correction"
                    ? "edited"
                    : status === "needs_approval"
                      ? "edited"
                      : status === "waiting_on_customer"
                        ? "approved"
                        : event.draftReply.status),
            },
          }
          : event,
      ),
    );
  }

  async function closeSelected(closeState: EventCloseState) {
    if (!selectedEvent || selectedEvent.status === "closed") return;

    if (selectedEvent.persistedEventId) {
      setDraftActionMessage("Updating thread status...");
      try {
        const response = await fetch(
          `/api/inbox/events/${selectedEvent.persistedEventId}/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intent: "complete", closeState }),
          },
        );
        const body = (await response.json()) as {
          event?: { id: string; status: string };
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "Status update failed.");
        await loadPersistedInboxEvents();
        setDraftActionMessage("Thread moved to Archive. No Gmail action occurred.");
        setFilter("archive");
        setActiveTab("history");
        setSelectedId(`persisted-${selectedEvent.persistedEventId}`);
        setMobilePane("detail");
      } catch (error) {
        setDraftActionMessage(
          error instanceof Error ? error.message : "Status update failed.",
        );
      }
      return;
    }

    const closedEvent: CateringEvent = {
      ...selectedEvent,
      closeState,
      closedAt: "2026-05-26 12:00",
      status: "closed",
      draftReply: { ...selectedEvent.draftReply, body: draftBody },
      archiveNote: "Archived for review and optional brain extraction.",
    };

    setEvents((current) => current.filter((event) => event.id !== selectedEvent.id));
    setArchive((current) => [closedEvent, ...current]);
    setFilter("archive");
    setActiveTab("history");
    setSelectedId(closedEvent.id);
    setDraftBody(closedEvent.draftReply.body);
    setMobilePane("detail");
  }

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <RefreshCw className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
      <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-1 flex-col gap-2 sm:gap-3 overflow-hidden p-2 sm:p-4">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
            <Badge variant="secondary" className="h-5 px-1.5 text-xs font-semibold select-none">
              {visibleEvents.length} Active
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {gmailSyncMessage && (
              <span className="hidden md:inline text-xs text-muted-foreground animate-pulse max-w-xs truncate">
                {gmailSyncMessage}
              </span>
            )}
            <Button
              className={cn(
                "gap-1.5 h-8 px-2.5 sm:px-3 text-xs border-blue-400/35 bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-200",
                gmailSyncLoading && "bg-blue-500/15",
              )}
              disabled={gmailSyncLoading || persistedLoading}
              size="sm"
              variant="outline"
              type="button"
              onClick={syncGmailInbox}
            >
              <RefreshCw className={cn("size-3.5", gmailSyncLoading && "animate-spin")} />
              <span className="hidden sm:inline">{gmailSyncLoading ? "Syncing..." : "Sync Gmail"}</span>
            </Button>
            <SafetyStatus variant="pill" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
          <div className="flex h-full min-h-0 flex-1 flex-col 2xl:hidden">
            <div
              className={cn(
                "grid shrink-0 gap-2 border-b p-2 sm:p-3",
                mobilePane === "detail" ? "hidden md:grid" : "grid",
              )}
            >
              <QueueButtonRow
                filter={filter}
                queueCounts={queueCounts}
                onSelectFilter={selectFilter}
              />
              <div className="flex min-w-0 gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-2.5 top-3 md:top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="h-10 md:h-8 pl-8 text-sm"
                    placeholder="Search threads"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <section
                className={cn(
                  "min-h-0 flex-1 flex-col md:flex-none md:w-[24rem] md:shrink-0 md:border-r",
                  mobilePane === "detail" ? "hidden md:flex" : "flex",
                )}
              >
                <EventList
                  events={visibleEvents}
                  selectedId={selectedEvent?.id}
                  onSelect={selectEvent}
                />
              </section>

              <section
                className={cn(
                  "min-h-0 flex-1 flex-col",
                  mobilePane === "list" ? "hidden md:flex" : "flex",
                )}
              >
                <InboxDetailPanel
                  activeTab={activeTab}
                  closeSelected={closeSelected}
                  analysisActionLoading={analysisActionLoading}
                  analysisActionMessage={analysisActionMessage}
                  draftActionLoading={draftActionLoading}
                  draftActionMessage={draftActionMessage}
                  draftBody={draftBody}
	                  attachmentActionId={attachmentActionId}
	                  zohoStatus={zohoStatus}
                  onTitleChange={updateSelectedTitle}
	                  zohoInvoiceTemplate={zohoInvoiceTemplate}
	                  onBack={() => setMobilePane("list")}
                  onAttachmentAction={runAttachmentAction}
                  onRunAnalysis={runPersistedAgentAnalysis}
                  onDraftAction={runPersistedDraftAction}
                  onTriageStatus={updatePersistedStatus}
                  onSendEmail={sendPersistedDraft}
                  selectedEvent={selectedEvent}
                  setActiveTab={setActiveTab}
                  setDraftBody={setDraftBody}
                  updateSelected={updateSelected}
                />
              </section>
            </div>
          </div>

          <div className="hidden h-full min-h-0 flex-1 overflow-hidden 2xl:block">
          {inboxSidebarCollapsed ? (
            <div className="flex h-full min-w-0">
              <aside
                aria-label="Inbox controls"
                className="flex h-full w-[4.5rem] shrink-0 flex-col items-center overflow-hidden border-r py-2"
              >
                <Button
                  aria-label="Expand inbox sidebar"
                  aria-pressed={inboxSidebarCollapsed}
                  className="size-10 shrink-0"
                  size="icon"
                  title="Expand inbox sidebar"
                  variant="ghost"
                  onClick={() => setInboxSidebarCollapsed(false)}
                >
                  <PanelLeftOpen className="size-5" />
                </Button>
                <Separator className="my-2 w-full" />
                <nav className="flex w-full flex-col items-center gap-1 px-2">
                  {queueFilters.map((item) => (
                    <Button
                      aria-label={`${item.label}: ${queueCounts[item.value]}`}
                      aria-current={filter === item.value ? "page" : undefined}
                      aria-pressed={filter === item.value}
                      className={cn(
                        "size-10 shrink-0",
                        filter === item.value && "bg-muted text-foreground",
                      )}
                      key={item.value}
                      size="icon"
                      title={`${item.label}: ${queueCounts[item.value]}`}
                      variant="ghost"
                      onClick={() => selectFilter(item.value)}
                    >
                      <item.icon className="size-5" />
                    </Button>
                  ))}
                </nav>
              </aside>

              <ResizablePanelGroup
                orientation="horizontal"
                className="min-h-0 min-w-0 flex-1"
              >
                <ResizablePanel defaultSize="39%" minSize="16rem">
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div className="shrink-0 px-4 py-3">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                        <Input
                          className="pl-8"
                          placeholder="Search threads"
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                        />
                      </div>
                    </div>
                    <Separator />
                    <EventList
                      events={visibleEvents}
                      selectedId={selectedEvent?.id}
                      onSelect={selectEvent}
                    />
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel
                  className="min-h-0 overflow-hidden"
                  defaultSize="61%"
                  minSize="28rem"
                >
                  <InboxDetailPanel
                    activeTab={activeTab}
                    closeSelected={closeSelected}
                    analysisActionLoading={analysisActionLoading}
                    analysisActionMessage={analysisActionMessage}
                    draftActionLoading={draftActionLoading}
                    draftActionMessage={draftActionMessage}
                    draftBody={draftBody}
	                    attachmentActionId={attachmentActionId}
                    onTitleChange={updateSelectedTitle}
	                    zohoStatus={zohoStatus}
	                    zohoInvoiceTemplate={zohoInvoiceTemplate}
	                    onAttachmentAction={runAttachmentAction}
                    onRunAnalysis={runPersistedAgentAnalysis}
                    onDraftAction={runPersistedDraftAction}
                    onTriageStatus={updatePersistedStatus}
                    onSendEmail={sendPersistedDraft}
                    selectedEvent={selectedEvent}
                    setActiveTab={setActiveTab}
                    setDraftBody={setDraftBody}
                    updateSelected={updateSelected}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          ) : (
            <ResizablePanelGroup
              orientation="horizontal"
              className="h-full min-h-0"
            >
              <ResizablePanel
                className="overflow-hidden"
                defaultSize="24%"
                minSize="17rem"
              >
              <aside className="flex h-full min-w-0 flex-col overflow-hidden">
                <div className="flex min-w-0 items-center gap-2 p-3">
                  <div className="min-w-0 flex-1" />
                  <Button
                    aria-label="Collapse inbox sidebar"
                    aria-pressed={inboxSidebarCollapsed}
                    className="size-10 shrink-0"
                    size="icon"
                    title="Collapse inbox sidebar"
                    variant="ghost"
                    onClick={() => setInboxSidebarCollapsed(true)}
                  >
                    <PanelLeftClose className="size-5" />
                  </Button>
                </div>
                <Separator />
                <div className="px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                    <span className="truncate">Queues</span>
                    <span className="shrink-0">{visibleEvents.length} shown</span>
                  </div>
                  <nav className="grid gap-1" aria-label="Inbox queues">
                    {queueFilters.map((item) => (
                      <button
                        aria-label={`${item.label}: ${queueCounts[item.value]}`}
                        aria-current={filter === item.value ? "page" : undefined}
                        aria-pressed={filter === item.value}
                        className={cn(
                          "flex h-10 min-w-0 items-center gap-2 rounded-md px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                          filter === item.value && "bg-muted text-foreground ring-1 ring-accent/45",
                        )}
                        key={item.value}
                        title={`${item.label}: ${queueCounts[item.value]}`}
                        type="button"
                        onClick={() => selectFilter(item.value)}
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

              <ResizablePanel defaultSize="30%" minSize="16rem">
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="shrink-0 px-4 py-3">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        className="pl-8"
                        placeholder="Search threads"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                      />
                    </div>
                  </div>
                  <Separator />
                  <EventList
                    events={visibleEvents}
                    selectedId={selectedEvent?.id}
                    onSelect={selectEvent}
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                className="min-h-0 overflow-hidden"
                defaultSize="46%"
                minSize="28rem"
              >
                <InboxDetailPanel
                  activeTab={activeTab}
                  closeSelected={closeSelected}
                  analysisActionLoading={analysisActionLoading}
                  analysisActionMessage={analysisActionMessage}
                  draftActionLoading={draftActionLoading}
                  draftActionMessage={draftActionMessage}
                  draftBody={draftBody}
	                  attachmentActionId={attachmentActionId}
	                  zohoStatus={zohoStatus}
	                  zohoInvoiceTemplate={zohoInvoiceTemplate}
	                  onAttachmentAction={runAttachmentAction}
                  onRunAnalysis={runPersistedAgentAnalysis}

                  onDraftAction={runPersistedDraftAction}
                  onTriageStatus={updatePersistedStatus}
                  onSendEmail={sendPersistedDraft}
                  onTitleChange={updateSelectedTitle}
                  selectedEvent={selectedEvent}
                  setActiveTab={setActiveTab}
                  setDraftBody={setDraftBody}
                  updateSelected={updateSelected}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
          </div>
        </div>
      </main>
  );
}
function EditableThreadTitle({
  event,
  onTitleChange,
}: {
  event: DisplayCateringEvent;
  onTitleChange: (title: string) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(event.title);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraftTitle(event.title);
    setMessage("");
  }, [event.id, event.title]);

  async function saveTitle() {
    const title = draftTitle.trim();
    if (!title || title === event.title || !event.persistedEventId) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/inbox/events/${event.persistedEventId}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const body = (await response.json()) as { error?: string; threadTitle?: { title?: string } };
      if (!response.ok) throw new Error(body.error ?? "Could not save thread title.");
      const savedTitle = body.threadTitle?.title ?? title;
      onTitleChange(savedTitle);
      setDraftTitle(savedTitle);
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save thread title.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      void saveTitle();
    }
  }

  return (
    <div className="grid min-w-0 flex-1 gap-1">
      <Input
        aria-label="Thread title"
        className="h-10 min-w-0 border-transparent bg-transparent px-0 text-lg font-semibold leading-tight shadow-none focus-visible:border-input focus-visible:px-2"
        disabled={!event.persistedEventId || saving}
        maxLength={120}
        value={draftTitle}
        onBlur={() => void saveTitle()}
        onChange={(event) => setDraftTitle(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {message ? <p className="text-[11px] text-muted-foreground">{message}</p> : null}
    </div>
  );
}


function InboxDetailPanel({
  activeTab,
  analysisActionLoading,
  analysisActionMessage,
  attachmentActionId,
  closeSelected,
  draftActionLoading,
  draftActionMessage,
  draftBody,
  zohoStatus,
  onBack,
  onAttachmentAction,
  onDraftAction,
  onRunAnalysis,
  onTriageStatus,
  onTitleChange,
  onSendEmail,
  selectedEvent,
  setActiveTab,
  setDraftBody,
  updateSelected,
  zohoInvoiceTemplate,
}: {
  activeTab: DetailTab;
  analysisActionLoading: boolean;
  analysisActionMessage: string;
  attachmentActionId: string;
  closeSelected: (closeState: EventCloseState) => void;
  draftActionLoading: boolean;
  draftActionMessage: string;
  draftBody: string;
  zohoStatus: ZohoIntegrationStatus | null;
  zohoInvoiceTemplate: ZohoInvoiceTemplateStatus | null;
  onBack?: () => void;
  onAttachmentAction: (
    attachmentId: string,
    intent: "view",
  ) => void;
  onTitleChange: (title: string) => void;
  onDraftAction: (intent: "generate" | "regenerate" | "reject") => void;
  onRunAnalysis: () => void;
  onTriageStatus: (
    intent: "needs_reply" | "awaiting_customer" | "manual_review" | "invoice_ready" | "follow_up" | "reopen",
  ) => void;
  onSendEmail?: () => void;
  selectedEvent?: DisplayCateringEvent;
  setActiveTab: (value: DetailTab) => void;
  setDraftBody: (value: string) => void;
  updateSelected: (
    status: CateringEventStatus,
    draftStatus?: CateringEvent["draftReply"]["status"],
  ) => void;
}) {
  const workflow = selectedEvent ? getWorkflowSummary(selectedEvent) : undefined;
  const WorkflowIcon = workflow?.icon ?? Info;
  const [threadHeaderCollapsed, setThreadHeaderCollapsed] = useState(false);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const threadTouchStartY = useRef<number | null>(null);

  useEffect(() => {
    setThreadHeaderCollapsed(false);
  }, [activeTab, selectedEvent?.id]);

  const collapseThreadHeader = useCallback(() => {
    setThreadHeaderCollapsed(true);
  }, []);

  const expandThreadHeader = useCallback(() => {
    setThreadHeaderCollapsed(false);
  }, []);

  function handleThreadScroll(event: UIEvent<HTMLDivElement>) {
    if (event.currentTarget.scrollTop > 48) {
      collapseThreadHeader();
    }
  }

  function handleThreadWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY > 0) {
      collapseThreadHeader();
      return;
    }

    if (event.deltaY < 0 && event.currentTarget.scrollTop <= 0) {
      expandThreadHeader();
    }
  }

  function handleThreadTouchStart(event: TouchEvent<HTMLDivElement>) {
    threadTouchStartY.current = event.touches[0]?.clientY ?? null;
  }

  function handleThreadTouchMove(event: TouchEvent<HTMLDivElement>) {
    const startY = threadTouchStartY.current;
    const currentY = event.touches[0]?.clientY;

    if (startY === null || currentY === undefined) return;

    const deltaY = startY - currentY;
    if (deltaY > 12) {
      collapseThreadHeader();
      return;
    }

    if (deltaY < -12 && event.currentTarget.scrollTop <= 0) {
      expandThreadHeader();
    }
  }

  return (
    <>
            {selectedEvent ? (
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div
                  className={cn(
                    "z-10 shrink-0 border-b bg-card/95 backdrop-blur transition-all duration-200 ease-out",
                    threadHeaderCollapsed ? "shadow-sm" : "shadow-none",
                  )}
                >
                  <div className="flex min-h-14 items-center gap-2 px-3 py-2">
                    {onBack ? (
                      <Button
                        aria-label="Back to threads"
                        className="flex shrink-0 items-center gap-1 md:hidden"
                        variant="ghost"
                        onClick={onBack}
                      >
                        <ChevronLeft className="size-4" />
                        Back
                      </Button>
                    ) : null}
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 flex-wrap">
                      <Badge variant={workflow?.badgeVariant ?? statusVariant(selectedEvent.status)} className="gap-1 shrink-0">
                        <WorkflowIcon className="size-3" />
                        {workflow?.label ?? formatStatus(selectedEvent.status)}
                      </Badge>
                      {selectedEvent.missingInfo.length > 0 && (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 h-5 px-1.5 text-[10px] shrink-0">
                          <AlertCircle className="size-3" />
                          <span>{selectedEvent.missingInfo.length} missing</span>
                        </Badge>
                      )}
                      {(selectedEvent.invoicePreview || selectedEvent.eventDetails?.invoiceReadiness.ready) && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 gap-1 h-5 px-1.5 text-[10px] shrink-0 font-medium">
                          <DollarSign className="size-3" />
                          <span>{selectedEvent.invoicePreview ? "Invoice" : "Ready"}</span>
                        </Badge>
                      )}
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        Latest reply {formatRelativeDate(selectedEvent.latestCustomerReplyAt)}
                      </span>
                      {isPersistedDisplayEvent(selectedEvent) ? (
                        <span className="hidden truncate text-xs text-muted-foreground md:inline">
                          Source: Gmail
                        </span>
                      ) : null}
                    </div>
                    <DetailActionButtons
                      event={selectedEvent}
                      analysisActionLoading={analysisActionLoading}
                      closeSelected={closeSelected}
                      onRunAnalysis={onRunAnalysis}
                      onTriageStatus={onTriageStatus}
                      updateSelected={updateSelected}
                    />
                    <Button
                      className="hidden md:inline-flex"
                      aria-label={
                        threadHeaderCollapsed
                          ? "Expand thread details"
                          : "Minimize thread details"
                      }
                      aria-pressed={!threadHeaderCollapsed}
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setThreadHeaderCollapsed((current) => !current)
                      }
                    >
                      {threadHeaderCollapsed ? (
                        <Maximize2 className="size-4" />
                      ) : (
                        <Minimize2 className="size-4" />
                      )}
                    </Button>
                  </div>
                  <div
                    className={cn(
                      "hidden md:grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                      threadHeaderCollapsed
                        ? "grid-rows-[0fr] opacity-0"
                        : "grid-rows-[1fr] opacity-100",
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="grid gap-3 px-4 pb-4 pt-2">
                        <div className="flex min-w-0 items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <EditableThreadTitle event={selectedEvent} onTitleChange={onTitleChange} />
                            <p className="mt-1 text-sm text-muted-foreground">
                              {selectedEvent.customer} / {selectedEvent.company}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 gap-1">
                            <CalendarDays className="size-3" />
                            {formatEventDate(selectedEvent.eventDate)}
                          </Badge>
                        </div>
                        <div className="hidden md:block">
                          <ContextSummary event={selectedEvent} />
                        </div>
                        {analysisActionMessage ? (
                          <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            {analysisActionMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "hidden md:grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                      threadHeaderCollapsed
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-3 text-xs text-muted-foreground">
                        <strong className="min-w-0 max-w-full truncate text-sm text-foreground sm:max-w-[45%]">
                          {selectedEvent.title}
                        </strong>
                        <span className="truncate">
                          {selectedEvent.customer} / {selectedEvent.company}
                        </span>
                        <Badge variant="outline" className="shrink-0 gap-1">
                          <CalendarDays className="size-3" />
                          {formatEventDate(selectedEvent.eventDate)}
                        </Badge>
                        <span className="hidden min-w-0 flex-1 truncate md:block">
                          {workflow?.action}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Mobile-only compact title row */}
                  <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground bg-muted/10 md:hidden shrink-0">
                    <span className="truncate max-w-[65%] font-medium text-foreground">
                      {selectedEvent.title}
                    </span>
                    <span className="truncate ml-2 max-w-[30%] opacity-85">
                      {selectedEvent.customer}
                    </span>
                  </div>
                </div>
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => setActiveTab(value as DetailTab)}
                  className="min-h-0 flex-1 gap-0 overflow-hidden"
                >
                  <div className="shrink-0 overflow-x-auto px-4 py-3">
                    <TabsList className="min-w-max">
                      <TabsTrigger value="thread">Thread</TabsTrigger>
                      <TabsTrigger value="invoice">Invoice</TabsTrigger>
                      <TabsTrigger value="facts">Event details</TabsTrigger>
                      <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>
                  </div>
                  <Separator />
                  <TabsContent value="thread" className="m-0 min-h-0 flex-1 overflow-hidden">
                    <div className="flex h-full min-h-0 flex-col">
                    <div
                      ref={threadScrollRef}
                      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                      onScroll={handleThreadScroll}
                      onWheel={handleThreadWheel}
                      onTouchStart={handleThreadTouchStart}
                      onTouchMove={handleThreadTouchMove}
                      onFocus={collapseThreadHeader}
                      onPointerDown={collapseThreadHeader}
                      tabIndex={0}
                    >
                      <div className="space-y-4 p-4 pb-5">
                        {selectedEvent.thread.map((message) => (
                          <ThreadMessageBubble
                            attachmentActionId={attachmentActionId}
                            key={message.id}
                            message={message}
                            onAttachmentAction={onAttachmentAction}
                          />
                        ))}
                      </div>
                    </div>
                    {canShowDraftComposer(selectedEvent) ? (
                      <PendingDraftMessage
                        body={draftBody}
                        event={selectedEvent}
                        subject={selectedEvent.draftReply.subject}
                        actionLoading={draftActionLoading}
                        actionMessage={draftActionMessage}
                        onBodyChange={setDraftBody}
                        onDraftAction={onDraftAction}
                        onNeedsCorrection={() => updateSelected("needs_correction", "edited")}
                        onSaveEdits={() => updateSelected("needs_approval", "edited")}
                        onSend={isPersistedDisplayEvent(selectedEvent) && onSendEmail ? onSendEmail : () => updateSelected("waiting_on_customer", "approved")}
                      />
                    ) : (
                      <NoDraftNotice event={selectedEvent} />
                    )}
                    </div>
                  </TabsContent>
                  <TabsContent value="invoice" className="m-0 min-h-0 flex-1 overflow-hidden">
                    <div
                      className="h-full min-h-0 overflow-y-auto overscroll-contain"
                      onFocus={collapseThreadHeader}
                      onPointerDown={collapseThreadHeader}
                      onScroll={handleThreadScroll}
                      onTouchMove={handleThreadTouchMove}
                      onTouchStart={handleThreadTouchStart}
                      onWheel={handleThreadWheel}
                      tabIndex={0}
                    >
                      <div className="grid gap-3 p-4 pb-5">
                        {selectedEvent.invoicePreview ? (
                          <EditableInvoicePreview
                            key={selectedEvent.id}
                            event={selectedEvent}
                            preview={selectedEvent.invoicePreview}
                            zohoStatus={zohoStatus}
                            templateStatus={zohoInvoiceTemplate}
                            onStatusChange={(status) => updateSelected(status)}
                          />
                        ) : (
                          <div className="rounded-lg border p-6 text-sm text-muted-foreground">
                            No invoice preview. Use this queue for invoice review only after the details are confirmed.
                          </div>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="facts" className="m-0 min-h-0 overflow-hidden">
                    <ScrollArea className="h-full min-h-0">
                      <EventDetailsPanel event={selectedEvent} />
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="history" className="m-0 min-h-0 overflow-y-auto overscroll-contain p-4">
                    <HistoryPanel event={selectedEvent} />
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex min-h-14 items-center border-b px-3 py-2 md:hidden">
                  {onBack && (
                    <Button
                      aria-label="Back to threads"
                      className="flex shrink-0 items-center gap-1"
                      variant="ghost"
                      onClick={onBack}
                    >
                      <ChevronLeft className="size-4" />
                      Back
                    </Button>
                  )}
                </div>
                <div className="p-8 text-center text-muted-foreground">
                  No event selected.
                </div>
              </div>
            )}
    </>
  );
}

function DetailActionButtons({
  analysisActionLoading,
  closeSelected,
  event,
  onRunAnalysis,
  onTriageStatus,
  updateSelected,
}: {
  analysisActionLoading: boolean;
  closeSelected: (closeState: EventCloseState) => void;
  event: DisplayCateringEvent;
  onRunAnalysis: () => void;
  onTriageStatus: (
    intent: "needs_reply" | "awaiting_customer" | "manual_review" | "invoice_ready" | "follow_up" | "reopen",
  ) => void;
  updateSelected: (
    status: CateringEventStatus,
    draftStatus?: CateringEvent["draftReply"]["status"],
  ) => void;
}) {
  const tone = eventTone(event);

  if (isPersistedDisplayEvent(event)) {
    const isArchived = event.status === "closed";
    return (
      <div className="shrink-0">
        <div className="hidden items-center gap-2 xl:flex">
        {isArchived ? null : (
          <Button
            className={cn("gap-2", tone.button)}
            disabled={analysisActionLoading}
            size="sm"
            variant="outline"
            onClick={onRunAnalysis}
          >
            <RefreshCw
              className={cn("size-4", analysisActionLoading && "animate-spin")}
            />
            {analysisActionLoading ? "Reanalyzing" : "Reanalyze"}
          </Button>
        )}
        {isArchived ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => closeSelected("completed")}
          >
            Move to Archive
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              Triage
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onTriageStatus("needs_reply")}>
              {isArchived ? "Reopen as needs reply" : "Mark needs reply"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("awaiting_customer")}>
              {isArchived ? "Reopen as waiting" : "Mark waiting"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("follow_up")}>
              {isArchived ? "Reopen as follow-up" : "Mark follow-up"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("manual_review")}>
              {isArchived ? "Reopen as needs triage" : "Mark needs triage"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("invoice_ready")}>
              {isArchived ? "Reopen as invoice review" : "Mark invoice review"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Thread actions"
              className="xl:hidden"
              disabled={analysisActionLoading}
              size="icon"
              title="Thread actions"
              variant="outline"
            >
              {analysisActionLoading ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <MoreHorizontal className="size-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isArchived ? (
              <DropdownMenuItem onSelect={onRunAnalysis}>
                Reanalyze thread
              </DropdownMenuItem>
            ) : null}
            {isArchived ? (
              <DropdownMenuItem onSelect={() => onTriageStatus("reopen")}>
                Reopen as needs reply
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => closeSelected("completed")}>
                Move to Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onTriageStatus("needs_reply")}>
              {isArchived ? "Reopen as needs reply" : "Mark needs reply"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("awaiting_customer")}>
              {isArchived ? "Reopen as waiting" : "Mark waiting"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("follow_up")}>
              {isArchived ? "Reopen as follow-up" : "Mark follow-up"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("manual_review")}>
              {isArchived ? "Reopen as needs triage" : "Mark needs triage"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTriageStatus("invoice_ready")}>
              {isArchived ? "Reopen as invoice review" : "Mark invoice review"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  if (event.status === "closed") {
    return (
      <Badge variant="outline">
        {event.closeState ? formatStatus(event.closeState) : "closed"}
      </Badge>
    );
  }

  const canMarkInvoiceReady = event.status !== "invoice_ready";

  return (
    <div className="shrink-0">
      <div className="hidden gap-2 2xl:flex">
        {canMarkInvoiceReady ? (
          <Button
            aria-pressed={event.status === "invoice_ready"}
            size="sm"
            variant="outline"
            onClick={() => updateSelected("invoice_ready", "edited")}
          >
            Mark invoice review
          </Button>
        ) : null}
        <Button
          aria-pressed={event.status === "needs_correction"}
          size="sm"
          variant="outline"
          onClick={() => updateSelected("needs_correction", "edited")}
        >
          Needs info
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => closeSelected("manual")}
        >
          Archive
        </Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Thread actions"
            className="2xl:hidden"
            size="icon"
            title="Thread actions"
            variant="outline"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canMarkInvoiceReady ? (
            <DropdownMenuItem
              onSelect={() => updateSelected("invoice_ready", "edited")}
            >
              Mark invoice review
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => updateSelected("needs_correction", "edited")}
          >
            Needs info
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => closeSelected("manual")}>
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ThreadMessageBubble({
  attachmentActionId,
  message,
  onAttachmentAction,
}: {
  attachmentActionId: string;
  message: DisplayThreadMessage;
  onAttachmentAction: (
    attachmentId: string,
    intent: "view",
  ) => void;
}) {
  const isCustomer = message.sender === "customer";
  const senderLabel = isCustomer ? "Customer" : "Popup Pearl";
  const legacySplit = splitMessageBody(message.body);
  const text = legacySplit.text;
  const attachments =
    message.attachments?.length
      ? message.attachments
      : legacySplit.attachments.map((filename, index) => ({
          id: `${message.id}-legacy-${index}`,
          filename,
          mimeType: null,
          sizeBytes: null,
          storageRef: null,
          lifecycleStatus: "metadata_only",
        }));
  const isLongMessage = text.length > longMessagePreviewLength;
  const [expanded, setExpanded] = useState(!isLongMessage);
  const visibleText =
    expanded || !isLongMessage
      ? text
      : `${text.slice(0, longMessagePreviewLength).trimEnd()}...`;

  return (
    <article
      className={cn(
        "flex w-full",
        isCustomer ? "justify-start" : "justify-end",
      )}
    >
      <div
        className={cn(
          "max-w-[82%] rounded-2xl border px-4 py-3 text-sm shadow-sm",
          isCustomer
            ? "rounded-tl-md border-border bg-muted/60 text-foreground"
            : "rounded-tr-md border-blue-400/25 bg-blue-500/15 text-foreground",
        )}
      >
        <div
          className={cn(
            "mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs",
            "text-muted-foreground",
          )}
        >
          <span className="font-medium text-foreground">{message.author}</span>
          <span>{senderLabel}</span>
          <span className="ml-auto">{message.at}</span>
        </div>
        <p className="whitespace-pre-wrap break-words leading-6">{visibleText}</p>
        {isLongMessage ? (
          <Button
            className="mt-2 px-2 text-xs"
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show less" : "Show full message"}
          </Button>
        ) : null}
        {attachments.length ? (
          <details className="mt-3 rounded-md border bg-background/70">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
              <Paperclip className="size-3.5" />
              <span>
                {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
              </span>
            </summary>
            <div className="grid gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
              {attachments.map((attachment) => (
                <div className="grid gap-1 rounded-md border bg-background/70 p-2" key={attachment.id}>
                  {canPreviewImageAttachment(attachment) ? (
                    <a
                      className="group block overflow-hidden rounded-md border bg-muted/40"
                      href={`/api/inbox/attachments/${attachment.id}`}
                      rel="noreferrer"
                      target="_blank"
                      title="Open image in a new tab"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={attachment.filename}
                        className="max-h-56 w-full object-contain transition-transform group-hover:scale-[1.01]"
                        loading="lazy"
                        src={`/api/inbox/attachments/${attachment.id}`}
                      />
                    </a>
                  ) : null}
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 break-words font-medium text-foreground">
                      {attachment.filename}
                    </p>
                    <Badge variant="outline">
                      {formatAttachmentLifecycle(attachment.lifecycleStatus)}
                    </Badge>
                  </div>
                  {!attachment.id.includes("-legacy-") ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        className="gap-1 px-2 text-xs"
                        disabled={attachmentActionId === `${attachment.id}:view`}
                        size="sm"
                        variant="outline"
                        onClick={() => onAttachmentAction(attachment.id, "view")}
                      >
                        <Eye className="size-3" />
                        View
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function ContextSummary({ event }: { event: DisplayCateringEvent }) {
  const workflow = getWorkflowSummary(event);
  const WorkflowIcon = workflow.icon;
  const tone = eventTone(event);
  const missingTone = event.missingInfo.length ? toneByKey("missing") : toneByKey("ready");
  const invoiceTone = event.eventDetails?.invoiceReadiness.ready || event.invoicePreview
    ? toneByKey("ready")
    : toneByKey("archived");

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-md border bg-background/70 px-3 py-2.5 text-xs">
      <div className="min-w-[14rem] flex-1">
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
          <WorkflowIcon className={cn("size-4", tone.icon)} />
          Next action
        </div>
        <p className="leading-5 text-muted-foreground">{workflow.action}</p>
      </div>
      {event.missingInfo.length ? <div className="min-w-[12rem] flex-1">
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
          <AlertCircle className={cn("size-4", missingTone.icon)} />
          Blockers
        </div>
        <div className="flex flex-wrap gap-1.5">
          {event.missingInfo.map((item) => <Badge className={missingTone.chip} key={item} variant="outline">{item}</Badge>)}
        </div>
      </div> : null}
      {event.invoicePreview || event.eventDetails?.invoiceReadiness.ready ? <div className="min-w-[12rem] flex-1">
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
          <DollarSign className={cn("size-4", invoiceTone.icon)} />
          Invoice ready
        </div>
        <p className="leading-5 text-muted-foreground">
          {event.invoicePreview
            ? `${event.invoicePreview.total} ${formatStatus(event.invoicePreview.status)}`
            : "Fields and customer acceptance confirmed."}
        </p>
      </div> : null}
    </div>
  );
}

function EventDetailsPanel({ event }: { event: DisplayCateringEvent }) {
  const tone = eventTone(event);
  const missingTone = event.missingInfo.length ? toneByKey("missing") : toneByKey("ready");
  const invoiceTone = event.eventDetails?.invoiceReadiness.ready ? toneByKey("ready") : toneByKey("archived");

  if (!event.eventDetails) {
    return (
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {event.facts.map((fact) => (
          <article className="rounded-lg border p-3" key={fact.label}>
            <p className="text-xs text-muted-foreground">{fact.label}</p>
            <strong className="mt-1 block">{fact.value}</strong>
            <p className="mt-2 text-xs text-muted-foreground">
              {Math.round(fact.confidence * 100)}% / {fact.sourceMessageId}
            </p>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr]">
        <section className={cn("rounded-lg border p-4", tone.soft)}>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Info className={cn("size-4", tone.icon)} />
            Event details
          </div>
          {event.eventDetails.fields.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {event.eventDetails.fields.map((field) => (
                <article className="rounded-md border bg-background/75 p-3" key={field.key}>
                  <p className="text-xs text-muted-foreground">{field.label}</p>
                  <strong className="mt-1 block break-words text-sm">{field.value}</strong>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {field.source === "persisted" ? "Saved extraction" : field.sourceMessageId}
                    {field.sourceSnippet ? ` / ${field.sourceSnippet}` : ""}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No deterministic event details were found in this imported thread yet.
            </p>
          )}
        </section>
        <section className="grid gap-3">
          <div className={cn("rounded-lg border p-4", missingTone.soft)}>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <AlertCircle className={cn("size-4", missingTone.icon)} />
              Missing info
            </div>
            {event.missingInfo.length ? (
              <div className="flex flex-wrap gap-1.5">
                {event.missingInfo.map((item) => (
                  <Badge className={missingTone.chip} key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No quote blockers captured.</p>
            )}
          </div>
          <div className={cn("rounded-lg border p-4", invoiceTone.soft)}>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <DollarSign className={cn("size-4", invoiceTone.icon)} />
              Invoice readiness
            </div>
            <Badge className={invoiceTone.chip} variant="outline">
              {event.eventDetails.invoiceReadiness.ready ? "Invoice accepted" : "Not ready"}
            </Badge>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              {event.eventDetails.invoiceReadiness.hints.map((hint) => (
                <p key={hint}>{hint}</p>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function EditableInvoicePreview({
  event,
  preview,
  zohoStatus,
  templateStatus,
  onStatusChange,
}: {
  event: DisplayCateringEvent;
  preview: InvoicePreview;
  zohoStatus: ZohoIntegrationStatus | null;
  templateStatus: ZohoInvoiceTemplateStatus | null;
  onStatusChange: (status: CateringEventStatus) => void;
}) {
  const exactPreview = useMemo(
    () => applyExactZohoPackageDescription(preview, templateStatus?.record?.structuredData.lineItemShape),
    [preview, templateStatus],
  );
  const extractedZohoInvoice = event.zohoInvoice ?? null;
  const [lineItems, setLineItems] = useState(exactPreview.lineItems);
  const [linkedZohoInvoice, setLinkedZohoInvoice] =
    useState<LinkedZohoInvoice | null>(extractedZohoInvoice);
  const [zohoCreateLoading, setZohoCreateLoading] = useState(false);
  const [zohoSendLoading, setZohoSendLoading] = useState(false);
  const [zohoCreateMessage, setZohoCreateMessage] = useState("");
  const [zohoCustomerPreview, setZohoCustomerPreview] = useState<{
    name: string;
    email: string;
    companyName: string;
  } | null>(null);

  useEffect(() => {
    setLineItems(exactPreview.lineItems);
  }, [exactPreview.id, exactPreview.lineItems]);

  const subtotalCents = lineItems.reduce((sum, line) => {
    const amount = parseMoneyToCents(line.amount);
    if (amount !== null) return sum + amount;

    const unitPrice = parseMoneyToCents(line.unitPrice);
    return sum + (unitPrice ?? 0) * line.quantity;
  }, 0);
  const total = subtotalCents ? formatMoneyCents(subtotalCents) : preview.total;
  const customerEmail =
    event.eventDetails?.fields.find((field) => field.key === "customerEmail")?.value ?? "";
  const eventDate =
    event.eventDetails?.fields.find((field) => field.key === "eventDate")?.value ??
    formatEventDate(event.eventDate);
  const serviceWindow =
    event.eventDetails?.fields.find((field) => field.key === "serviceWindow")?.value ?? "";
  const location =
    event.eventDetails?.fields.find((field) => field.key === "location")?.value ?? "";
  const template = templateStatus?.record?.structuredData ?? null;
  const templateLineItem = template?.lineItemShape?.[0];

  function updateLine(index: number, patch: Partial<InvoicePreview["lineItems"][number]>) {
    setLineItems((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;

        const next = { ...line, ...patch };
        const unitPrice = parseMoneyToCents(next.unitPrice);
        next.amount = unitPrice === null
          ? next.amount
          : formatMoneyCents(unitPrice * next.quantity);
        return next;
      }),
    );
  }

  async function createInvoice(options: { createMissingContact?: boolean } = {}) {
    if (!event.persistedEventId) return;

    setZohoCreateLoading(true);
    setZohoCreateMessage("");
    try {
      const response = await fetch(`/api/inbox/events/${event.persistedEventId}/zoho-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems,
          createMissingContact: options.createMissingContact,
          contact: zohoCustomerPreview ?? undefined,
        }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        code?: string;
        error?: string;
        customerPreview?: {
          name?: string | null;
          email?: string | null;
          companyName?: string | null;
        };
        zohoInvoice?: LinkedZohoInvoice;
      };
      if (!response.ok) {
        if (body.code === "missing_contact") {
          setZohoCustomerPreview({
            name: body.customerPreview?.name ?? event.customer,
            email: body.customerPreview?.email ?? customerEmail,
            companyName: body.customerPreview?.companyName ?? "",
          });
        }
        throw new Error(body.error ?? "Could not create Zoho invoice.");
      }
      setLinkedZohoInvoice(body.zohoInvoice ?? null);
      setZohoCustomerPreview(null);
      setZohoCreateMessage(
        body.zohoInvoice?.invoiceNumber
          ? body.zohoInvoice.customerCreated
            ? `Created Zoho customer and invoice ${body.zohoInvoice.invoiceNumber}. Review it, then send it through Zoho.`
            : `Created Zoho invoice ${body.zohoInvoice.invoiceNumber}. Review it, then send it through Zoho.`
          : "Created Zoho invoice. Review it, then send it through Zoho.",
      );
    } catch (error) {
      setZohoCreateMessage(error instanceof Error ? error.message : "Could not create Zoho invoice.");
    } finally {
      setZohoCreateLoading(false);
    }
  }

  async function sendInvoiceEmail() {
    if (!event.persistedEventId || !linkedZohoInvoice?.invoiceId) return;

    setZohoSendLoading(true);
    setZohoCreateMessage("");
    try {
      const response = await fetch(`/api/inbox/events/${event.persistedEventId}/zoho-invoice/send`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        zohoInvoice?: LinkedZohoInvoice;
        status?: CateringEventStatus;
      };
      if (!response.ok) {
        throw new Error(
          body.detail
            ? `${body.error ?? "Could not send Zoho invoice email."} ${body.detail}`
            : body.error ?? "Could not send Zoho invoice email.",
        );
      }
      setLinkedZohoInvoice(body.zohoInvoice ?? linkedZohoInvoice);
      if (body.status) onStatusChange(body.status);
      setZohoCreateMessage(
        body.zohoInvoice?.invoiceNumber
          ? `Sent Zoho invoice ${body.zohoInvoice.invoiceNumber} to the customer.`
          : "Sent Zoho invoice to the customer.",
      );
    } catch (error) {
      setZohoCreateMessage(error instanceof Error ? error.message : "Could not send Zoho invoice email.");
    } finally {
      setZohoSendLoading(false);
    }
  }

  return (
    <section className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Invoice preview</p>
          <h3 className="mt-1 text-lg font-semibold">Popup Pearl</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Bill to {event.customer}{customerEmail ? ` / ${customerEmail}` : ""}
          </p>
        </div>
        <div className="text-left text-sm sm:text-right">
          <div className="flex flex-wrap gap-1 sm:justify-end">
            <Badge variant="outline">{formatStatus(preview.status)}</Badge>
            {template?.templateName ? (
              <Badge variant="secondary">{template.templateName}</Badge>
            ) : null}
          </div>
          <p className="mt-2 font-medium">{total}</p>
          <p className="text-xs text-muted-foreground">
            Local editable preview{template?.currencyCode ? ` / ${template.currencyCode}` : ""}
          </p>
        </div>
      </div>
      <div className="grid gap-3 border-b p-4 text-sm md:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Event date</p>
          <strong>{eventDate}</strong>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Service window</p>
          <strong>{serviceWindow || "Review required"}</strong>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Location</p>
          <strong>{location || "Review required"}</strong>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payment terms</p>
          <strong>{template?.paymentTermsLabel || "Review required"}</strong>
        </div>
      </div>
      {templateStatus?.synced ? (
        <div className="border-b bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground">
          Using Company Brain context from recent Zoho invoices
          {templateLineItem?.name ? `: ${templateLineItem.name}` : ""}.
        </div>
      ) : (
        <div className="border-b bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground">
          No Zoho invoice template context imported yet. Import recent invoice templates from Settings to mirror Zoho more closely.
        </div>
      )}
      <div className="grid gap-3 p-4">
        {lineItems.map((line, index) => (
          <div
            className="grid gap-2 rounded-md border bg-muted/20 p-3 md:grid-cols-[1fr_96px_128px_128px]"
            key={`${preview.id}-${index}`}
          >
            <label className="grid gap-1 text-xs text-muted-foreground">
              Item
              <Input
                value={line.label}
                onChange={(event) => updateLine(index, { label: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Qty
              <Input
                min={1}
                type="number"
                value={line.quantity}
                onChange={(event) =>
                  updateLine(index, {
                    quantity: Math.max(1, Number(event.target.value) || 1),
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Unit price
              <Input
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Amount
              <Input
                value={line.amount}
                onChange={(event) => updateLine(index, { amount: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground md:col-span-4">
              Description
              <Textarea
                className="min-h-28"
                value={line.description ?? ""}
                onChange={(event) => updateLine(index, { description: event.target.value })}
              />
            </label>
          </div>
        ))}
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <strong>{total}</strong>
        </div>
        {template?.notes || template?.terms ? (
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground md:grid-cols-2">
            {template.notes ? (
              <div>
                <strong className="text-foreground">Zoho notes</strong>
                <p className="mt-1">{template.notes}</p>
              </div>
            ) : null}
            {template.terms ? (
              <div>
                <strong className="text-foreground">Zoho terms</strong>
                <p className="mt-1">{template.terms}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-3">
          <Button
            disabled={!zohoStatus?.canCreateInvoice || !event.persistedEventId || zohoCreateLoading}
            onClick={() => createInvoice()}
            size="sm"
            type="button"
          >
            {zohoCreateLoading ? "Creating..." : "Create Zoho invoice"}
          </Button>
          <Button
            disabled={
              !zohoStatus?.canCreateInvoice ||
              !event.persistedEventId ||
              !linkedZohoInvoice?.invoiceId ||
              Boolean(linkedZohoInvoice.emailSent) ||
              zohoSendLoading
            }
            onClick={() => sendInvoiceEmail()}
            size="sm"
            type="button"
            variant="default"
          >
            {zohoSendLoading ? "Sending..." : "Send invoice via Zoho"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Create first, review in Zoho, then send the final invoice email to the customer through Zoho.
            {linkedZohoInvoice?.emailSent ? " Sent from Company Brain." : ""}
            {!zohoStatus?.canCreateInvoice
              ? ` Locked: ${!zohoStatus?.configured ? "Zoho is not configured." : !zohoStatus?.connected ? "Zoho is not connected." : "external writes are disabled."}`
              : ""}
          </span>
        </div>
        {zohoCustomerPreview ? (
          <div className="grid gap-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-3">
            <div>
              <strong className="text-sm">New Zoho customer</strong>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                No matching Zoho contact was found. Review these fields before creating the customer and invoice.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Name
                <Input
                  value={zohoCustomerPreview.name}
                  onChange={(event) =>
                    setZohoCustomerPreview((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Email
                <Input
                  value={zohoCustomerPreview.email}
                  onChange={(event) =>
                    setZohoCustomerPreview((current) =>
                      current ? { ...current, email: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Company
                <Input
                  placeholder="Optional"
                  value={zohoCustomerPreview.companyName}
                  onChange={(event) =>
                    setZohoCustomerPreview((current) =>
                      current ? { ...current, companyName: event.target.value } : current,
                    )
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={!zohoCustomerPreview.email || zohoCreateLoading}
                onClick={() => createInvoice({ createMissingContact: true })}
                size="sm"
                type="button"
                variant="outline"
              >
                Create customer + invoice
              </Button>
              <Button
                onClick={() => setZohoCustomerPreview(null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {zohoCreateMessage ? (
          <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {zohoCreateMessage}
          </p>
        ) : null}
        <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {preview.approvalGate}
        </p>
      </div>
    </section>
  );
}

function HistoryPanel({ event }: { event: DisplayCateringEvent }) {
  const history = event.history ?? [];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={event.status === "closed" ? "secondary" : "outline"}>
          {formatStatus(event.status)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {history.length ? `${history.length} recent actions` : "No actions recorded yet"}
        </span>
      </div>
      {history.length ? (
        <div className="grid gap-2">
          {history.map((item) => (
            <article className="rounded-md border bg-background/70 p-3 text-sm" key={item.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="font-medium">{item.label}</strong>
                <span className="text-xs text-muted-foreground">{formatRelativeDate(item.at)}</span>
              </div>
              {item.note ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">
          Activity will appear here after triage, archive, draft, or analysis actions.
        </div>
      )}
    </div>
  );
}

const draftPanelHeightStorageKey = "company-brain:draft-panel-height";
const draftPanelMinHeight = 220;
const draftPanelMaxHeight = 640;

function clampDraftPanelHeight(value: number) {
  if (!Number.isFinite(value)) return 360;
  const viewportMax =
    typeof window === "undefined" ? draftPanelMaxHeight : Math.min(window.innerHeight * 0.72, draftPanelMaxHeight);
  return Math.min(viewportMax, Math.max(draftPanelMinHeight, value));
}

function initialDraftPanelHeight() {
  if (typeof window === "undefined") return 360;
  const stored = window.localStorage.getItem(draftPanelHeightStorageKey);
  return clampDraftPanelHeight(stored ? Number(stored) : 360);
}

function PendingDraftMessage({
  actionLoading,
  actionMessage,
  body,
  event,
  subject,
  onBodyChange,

  onDraftAction,
  onNeedsCorrection,
  onSaveEdits,
  onSend,
}: {
  actionLoading: boolean;
  actionMessage: string;
  body: string;
  event: DisplayCateringEvent;
  subject: string;
  onBodyChange: (value: string) => void;
  onDraftAction: (intent: "generate" | "regenerate" | "reject") => void;
  onNeedsCorrection: () => void;
  onSaveEdits: () => void;
  onSend: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => event.status === "invoice_ready");
  const autoCollapsedEventIdRef = useRef<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(initialDraftPanelHeight);

  useEffect(() => {
    if (event.status !== "invoice_ready") {
      autoCollapsedEventIdRef.current = null;
      return;
    }
    if (autoCollapsedEventIdRef.current === event.id) return;
    autoCollapsedEventIdRef.current = event.id;
    setCollapsed(true);
  }, [event.id, event.status]);
  const isPersisted = isPersistedDisplayEvent(event);
  const hasPersistedDraft = Boolean(
    event.draftExplanation && event.draftReply.status !== "rejected",
  );
  const reviewLabel =
    event.status === "invoice_ready" ? "Review invoice draft" : "Review draft";
  const helperText =
    isPersisted
      ? "Local database draft only. Manually edit and click Approve and Send to deliver."
      : event.status === "needs_correction"
      ? "Edits stay in review until the draft is ready."
      : "Local preview only: no external email leaves this screen.";
  function startPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight;
    function onPointerMove(moveEvent: PointerEvent) {
      const nextHeight = clampDraftPanelHeight(startHeight + startY - moveEvent.clientY);
      setPanelHeight(nextHeight);
      window.localStorage.setItem(draftPanelHeightStorageKey, String(Math.round(nextHeight)));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  return (
    <article
      className="relative sticky bottom-0 z-10 flex w-full shrink-0 justify-end overflow-y-auto border-t bg-card/95 p-1.5 backdrop-blur sm:p-2"
      style={collapsed ? undefined : { height: panelHeight, maxHeight: "72dvh" }}
    >
      <button
        aria-label="Resize draft panel"
        className="absolute left-0 right-0 top-0 h-2 cursor-ns-resize touch-none border-t border-blue-400/20 bg-transparent hover:bg-blue-400/10"
        onPointerDown={startPanelResize}
        type="button"
      />
      <div className="flex h-full w-full flex-col rounded-md border border-blue-400/30 bg-blue-500/10 px-2.5 py-2 text-sm shadow-sm sm:px-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Local draft</span>
          <span className="min-w-0 flex-1 truncate text-[11px]">{subject}</span>
          <span className="ml-auto rounded-full border border-blue-400/30 px-2 py-0.5 text-[11px] uppercase tracking-normal">
            {formatStatus(event.draftReply.status)}
          </span>
          <Button
            aria-label={collapsed ? "Expand draft composer" : "Collapse draft composer"}
            className="size-7"
            size="icon"
            title={collapsed ? "Expand draft composer" : "Collapse draft composer"}
            variant="ghost"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? (
              <Maximize2 className="size-3.5" />
            ) : (
              <Minimize2 className="size-3.5" />
            )}
          </Button>
        </div>
        {collapsed ? null : (
          <>
            <Textarea
              className="min-h-0 flex-1 resize-none border-blue-400/20 bg-background/80 text-sm leading-6"
              value={body}
              placeholder="No active draft. Generate a local draft to preview/edit it here."
              onChange={(event) => onBodyChange(event.target.value)}
            />
            <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <p className="max-w-md text-xs text-muted-foreground">
                {actionMessage || helperText}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                {isPersisted ? (
                  <>
                    <Button
                      disabled={actionLoading}
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        onDraftAction(hasPersistedDraft ? "regenerate" : "generate")
                      }
                    >
                      {hasPersistedDraft ? "Regenerate" : "Generate draft"}
                    </Button>
                    <Button
                      disabled={actionLoading || !hasPersistedDraft}
                      size="sm"
                      onClick={onSend}
                    >
                      <Send className="size-4" />
                      Approve and Send
                    </Button>
                    <Button
                      disabled={actionLoading || !hasPersistedDraft}
                      size="sm"
                      variant="ghost"
                      onClick={() => onDraftAction("reject")}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
                {!isPersisted ? (
                  <>
                    <Button size="sm" onClick={onSend}>
                      <Send className="size-4" />
                      {reviewLabel}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onSaveEdits}
                    >
                      Save edits
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onNeedsCorrection}
                    >
                      Request rewrite
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function NoDraftNotice({ event }: { event: DisplayCateringEvent }) {
  const message =
    isImportedReviewEvent(event)
      ? "Needs triage. Confirm it is real customer work before drafting a reply."
      : event.status === "waiting_on_customer"
      ? "Waiting on the customer. No new reply is queued until they answer."
      : event.status === "follow_up"
      ? "No active follow-up draft is queued. Generate one manually."
      : "Archived thread. No active customer reply is queued.";

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function EventList({
  events,
  selectedId,
  onSelect,
}: {
  events: DisplayCateringEvent[];
  selectedId?: string;
  onSelect: (event: DisplayCateringEvent) => void;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1 overscroll-contain">
      <div className="grid gap-1.5 p-2 sm:p-4 pt-0">
        {events.map((event) => {
          const workflow = getWorkflowSummary(event);
          const WorkflowIcon = workflow.icon;
          const tone = eventTone(event);

          return (
            <button
              aria-current={selectedId === event.id ? "true" : undefined}
              aria-pressed={selectedId === event.id}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border border-l-4 p-3 text-left text-sm transition-colors",
                tone.rail,
                selectedId === event.id ? tone.selected : tone.hover,
              )}
              key={event.id}
              type="button"
              onClick={() => onSelect(event)}
            >
              <div className="flex w-full min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="truncate">{event.customer}</strong>
                    {event.priority === "high" && (
                      <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} title="High priority" />
                    )}
                  </div>
                  <p className="mt-0.5 hidden sm:block truncate text-xs text-muted-foreground">
                    {event.company}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeDate(event.latestCustomerReplyAt)}
                </span>
              </div>

              <div className="grid w-full gap-1.5">
                <div className="line-clamp-1 font-medium">{event.title}</div>
                <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {event.latestCustomerMessage?.snippet ?? event.summary}
                </p>
              </div>

              <div className="flex w-full flex-wrap gap-2">
                <Badge className={tone.chip} variant="outline">
                  <WorkflowIcon className="mr-1 size-3" />
                  {workflow.label}
                </Badge>
                <span className="self-center hidden sm:inline text-xs text-muted-foreground">{formatEventDate(event.eventDate)}</span>
                {event.missingInfo.length && ["needs_correction", "manual_review"].includes(event.status) ? (
                  <Badge className={toneByKey("missing").chip} variant="outline">
                    {event.missingInfo.length} missing
                  </Badge>
                ) : null}
                {event.invoicePreview && event.status === "invoice_ready" ? (
                  <Badge className={toneByKey("ready").chip} variant="outline">{event.invoicePreview.total}</Badge>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function QueueButtonRow({
  filter,
  queueCounts,
  onSelectFilter,
}: {
  filter: QueueFilter;
  queueCounts: Record<QueueFilter, number>;
  onSelectFilter: (value: QueueFilter) => void;
}) {
  return (
    <nav
      aria-label="Inbox queues"
      className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-none shrink-0 sm:grid sm:grid-cols-5 sm:gap-2 sm:pb-0"
    >
      {queueFilters.map((item) => {
        const tone = toneByQueue(item.value);

        return (
          <button
            aria-label={`${item.label}: ${queueCounts[item.value]}`}
            aria-current={filter === item.value ? "page" : undefined}
            aria-pressed={filter === item.value}
            className={cn(
              "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-center text-xs text-muted-foreground transition-colors sm:h-11 sm:w-auto sm:justify-start sm:text-left",
              filter === item.value ? `${tone.soft} text-foreground font-semibold` : `${tone.hover} hover:text-foreground`,
            )}
            key={item.value}
            title={`${item.label}: ${queueCounts[item.value]}`}
            type="button"
            onClick={() => onSelectFilter(item.value)}
          >
            <item.icon className={cn("size-3.5 shrink-0 sm:size-4", filter === item.value && tone.icon)} />
            <span className="min-w-0 truncate text-[11px] sm:text-xs">{item.label}</span>
            <span className="shrink-0 text-[10px] sm:text-[11px] font-medium opacity-80">
              {queueCounts[item.value]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
