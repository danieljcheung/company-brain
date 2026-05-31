# Popup Pearl Catering Agent - V1 Spec

Date: 2026-05-26

## Product Goal

Build a Popup Pearl-specific Company Brain workflow that handles one catering inquiry end-to-end with human approval at each risky step.

The first version is not a general company brain product. It is a vertical slice for Popup Pearl catering operations that can later be generalized.

## Core Principle

The agent may draft, classify, retrieve context, and prepare actions. It may only send customer emails or create/send Stripe invoices after explicit human approval in the web app.

Approved brain knowledge is trusted. Raw sources and unreviewed extracted knowledge are evidence, not truth.

## V1 Outcome

A successful V1 demo:

1. A WordPress catering form email arrives in the shared Popup Pearl Gmail inbox.
2. The app creates a catering inquiry task.
3. The agent extracts event details and missing information.
4. The agent drafts the first reply using approved company knowledge and similar past threads.
5. The human approver edits or approves the draft in the web app.
6. The app sends the email from the shared Popup Pearl Gmail account.
7. The app monitors replies in the same thread.
8. The agent drafts follow-ups until the event is ready for invoicing.
9. The app shows the evidence for "invoice ready."
10. The agent prepares a Stripe invoice preview.
11. The human clicks "Approve & Send Invoice."
12. The app creates, finalizes, and sends the Stripe invoice.
13. The inquiry is marked complete.
14. The app suggests any new brain updates learned from the completed workflow for human review.

## Users

### Admin

Configures sources, reviews brain health, manages Stripe/Gmail settings, and can approve any action.

### Approver

The current person responsible for replying to emails and creating invoices. Works primarily from the web app inbox.

No SMS or email notifications in V1. The web app is the operating surface.

## Data Sources

### V1 Sources

- Shared Popup Pearl Gmail account.
- WordPress catering form notification emails delivered to Gmail.
- Google Sheets for menu, pricing, backend operations, and order rules.
- Stripe invoices and customers.
- A seed set of roughly 20 complete catering email threads.
- A seed set of roughly 10 matching Stripe invoices.

### Phase 2 Sources

- Discord internal company messages, only if Gmail/Sheets/Stripe do not provide enough operational context.
- Direct WordPress webhook/form API.
- Additional Drive/local invoice archives.

## Intake Strategy

Ingesting all Gmail is acceptable because current volume is low, but V1 should distinguish between trigger scope and context scope.

Detailed Gmail-backed Inbox Agent decisions are captured in [Gmail-Backed Inbox Agent - V1 Spec](inbox-agent-gmail-v1.md).

- Workflow triggers: only WordPress catering form notification emails.
- Context retrieval: all shared Gmail threads, with citations.
- Brain extraction: start with catering-related threads, Stripe invoices, and Sheets.

This avoids random emails creating tasks while still allowing the agent to learn from broader company context.

## Main Screens

### Inbox

Daily work queue:

- new catering inquiries
- email drafts awaiting approval
- follow-ups awaiting approval
- invoice-ready confirmations
- Stripe invoice previews awaiting approval
- brain update suggestions from completed workflows

### Inquiry Detail

Operational workspace for one catering thread:

- customer and event details
- email thread timeline
- extracted missing fields
- draft reply editor
- similar past inquiries
- source citations
- state transition history
- action buttons: approve/send, edit/send, regenerate, mark manual, mark invoice ready

### Brain

Approved company knowledge:

- Tone & Voice
- Catering Inquiry Workflow
- Menu / Product Rules
- Pricing Rules
- Discounts / Deposits / Payment Terms
- Invoice Creation Rules
- Known Customers
- Approval Rules

Each item must show source evidence, reviewer, status, and version history.

### Sources

Connected and imported source status:

- Gmail sync health
- WordPress form detection rules
- Stripe sync health
- Sheets sync health
- source library and extraction status

### Settings

Integration and safety settings:

- Gmail account
- Stripe mode and account
- allowed sender identity
- approval roles
- automation gates
- prompt/tool configuration

## Inquiry Lifecycle

Suggested state machine:

```text
new_inquiry
-> needs_reply
-> reply_approved_sent
-> awaiting_customer
-> collecting_details
-> quote_requested
-> customer_ready_to_book
-> invoice_ready_review
-> invoice_preview_ready
-> invoice_approved_sent
-> complete
```

Fallback states:

```text
unclear_needs_human_review
manual_handling
cancelled
```

V1 should not hard-code what "confirmed" means. The agent should classify readiness with evidence and confidence, then ask for human approval before moving to invoicing.

Example:

```text
I think this is invoice-ready because the customer agreed to 40 drinks for June 12 pickup and asked for payment details.
```

## Approval Gates

### Email Reply Gate

The agent may draft. The app may send only after a human approves or edits and approves.

Actions:

- approve and send
- edit and send
- regenerate
- reject
- mark manual

### Invoice Gate

The agent may prepare a Stripe invoice preview. The app may create, finalize, and send only when the human clicks "Approve & Send Invoice."

The preview must show:

- customer
- email
- event date
- line items
- quantities
- pricing
- taxes/fees if applicable
- payment/deposit notes
- source evidence from the email thread and approved rules

### Brain Update Gate

The system may suggest new brain records after completed workflows. Those records do not affect automation until approved.

Actions:

- approve
- edit and approve
- reject
- needs clarification

## Company Brain Architecture

Use a governed hybrid model, not vector-only RAG.

### Raw Sources

Immutable evidence:

- Gmail messages and threads
- WordPress form notification emails
- Stripe invoices/customers
- Sheets rows and ranges
- uploaded/imported documents

### Extracted Memory

Unreviewed candidate entities and facts:

- Customer
- EventInquiry
- Event
- Product/MenuItem
- PricingRule
- InvoiceRule
- ToneRule
- WorkflowRule

### Approved Wiki

Human-reviewed operational knowledge:

- pages/sections that humans can inspect
- cited claims
- approval history
- version history
- superseded records

### Automation Read Model

A materialized view of approved knowledge only. Email and invoice agents should read from this layer, not from raw unapproved extraction.

## Hybrid Retrieval / Graph Model

Vector search is useful for finding similar past inquiries. Graph links are useful for explaining why an action was drafted and for connecting customer, event, invoice, and rules.

Core relationships:

```text
GmailThread -> contains -> EventInquiry
EventInquiry -> belongs_to -> Customer
EventInquiry -> references -> Product/MenuItem
EventInquiry -> becomes -> StripeInvoice
PastThread + PastInvoice -> supports -> ApprovedRule
ApprovedRule -> used_by -> EmailDraftAutomation
ApprovedRule -> used_by -> InvoiceDraftAutomation
SourceRecord -> supports -> BrainClaim
BrainClaim -> approved_by -> Reviewer
BrainClaim -> supersedes -> BrainClaim
```

Every generated draft should have a "why" panel:

- matched similar past inquiries
- approved tone rules used
- approved pricing/order rules used
- missing details
- invoice line items inferred
- exact source citations

## Research Notes

Karpathy's gist argues for a persistent, LLM-maintained wiki layer between raw sources and answers. The important adaptation here is that the company brain should compile durable reviewed knowledge over time instead of rediscovering everything from raw RAG on every query.

Design implications:

- Raw source library remains immutable evidence.
- Wiki/brain records are maintained, reviewed, and linted.
- Contradictions and stale claims should become review tasks.
- Automations consume approved snapshots, not the whole messy source pool.
- Provenance must be schema-level data, not UI decoration.

Related references:

- Karpathy gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Microsoft GraphRAG: https://github.com/microsoft/graphrag
- GraphRAG paper: https://arxiv.org/abs/2404.16130
- Retrieval-Augmented Generation paper: https://arxiv.org/abs/2005.11401
- W3C PROV overview: https://www.w3.org/TR/prov-overview/

## Non-Goals

- No Discord ingestion in V1 unless required by missing source coverage.
- No direct WordPress webhook in V1.
- No autonomous email sending without approval.
- No autonomous invoice creation/sending without approval.
- No graph visualization as a core requirement.
- No learning directly from every new email without review.

## Open Questions

- Exact Gmail query/markers used by the WordPress catering form notification.
- Stripe tax/payment/deposit rules for catering invoices.
- Whether the first build should use Stripe test mode only until the demo is verified.
- Whether the approver identity should be shared account-only or individual app users.
- Required menu/pricing Sheet IDs and ranges.
