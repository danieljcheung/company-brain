export type EventCloseState =
  | "booked"
  | "cancelled"
  | "manual"
  | "lost_no_response"
  | "completed";

export type CateringEventStatus =
  | "needs_approval"
  | "waiting_on_customer"
  | "invoice_ready"
  | "invoiced"
  | "needs_correction"
  | "follow_up"
  | "closed";

export type ThreadMessage = {
  id: string;
  sender: "customer" | "agent" | "owner";
  author: string;
  at: string;
  body: string;
};

export type InvoicePreview = {
  id: string;
  status: "preview" | "approved_mock" | "blocked";
  lineItems: Array<{
    label: string;
    description?: string;
    quantity: number;
    unitPrice: string;
    amount: string;
  }>;
  total: string;
  approvalGate: string;
};

export type CateringEvent = {
  id: string;
  threadId: string;
  customer: string;
  company: string;
  title: string;
  eventDate: string;
  latestCustomerReplyAt: string;
  status: CateringEventStatus;
  priority: "high" | "medium" | "low";
  summary: string;
  missingInfo: string[];
  facts: Array<{
    label: string;
    value: string;
    confidence: number;
    sourceMessageId: string;
  }>;
  thread: ThreadMessage[];
  draftReply: {
    subject: string;
    body: string;
    status: "draft" | "edited" | "approved" | "rejected";
  };
  invoicePreview?: InvoicePreview;
  correctionCandidates: string[];
  closeState?: EventCloseState;
  closedAt?: string;
  archiveNote?: string;
};
