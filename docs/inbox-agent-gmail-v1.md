# Gmail-Backed Inbox Agent - V1 Spec

Date: 2026-06-02

## Purpose

Build the V1 Inbox Agent for Popup Pearl as a Gmail-backed work queue for catering inquiries. The agent turns relevant Gmail threads into Inbox events, extracts event details, drafts replies in Popup Pearl's approved voice, and sends approved emails in the original thread.

V1 is deliberately conservative: it may classify, extract, draft, suggest links, and prepare action history, but it must not send email, create invoices, merge events, or trust new brain facts without explicit human review.

## Scope

### Gmail Account

Use the shared Popup Pearl Gmail inbox as the source account for V1.

### Trigger Sources

Inbox events are created from:

- WordPress booking form notification emails delivered to Gmail.
- Emails whose subject or content pattern includes `New Booking Request from:`.
- Direct customer emails, only when confidently catering-related.
- Manually imported Gmail threads selected by the user.

Direct customer email classification must be conservative. Non-catering messages, promotions, routine marketing, and unrelated vendor mail should not create active Inbox items.

Useful vendor or context emails may later become source/context records for Company Brain, but they are not active Inbox tasks in V1.

### Sync Window

Automated sync should consider only the last 1 month of Gmail activity.

For any matched or manually imported thread, pull the full Gmail thread history, even when older messages in that thread fall outside the 1-month sync window.

### Archived Threads

Archived Gmail threads are ignored by normal V1 sync unless manually imported.

Tracked or completed threads can reopen when a new customer reply arrives, even if the corresponding Inbox event was previously marked complete.

## Thread-to-Event Model

One Gmail thread maps to one Inbox event in V1.

If a customer starts a new Gmail thread about an existing event, V1 creates a separate Inbox event and suggests a possible match/link to the existing event. Automatic merge is a Phase 2 capability.

Manual import is supported for threads that did not match the normal trigger rules, including archived threads or older relevant history.

## Users and Permissions

V1 uses one shared app user/admin. There is no staff assignment model in V1.

Gmail labels should not be auto-created in V1. The app should track status and action history internally instead of mutating Gmail organization state beyond approved sends.

## Statuses

User-facing Inbox statuses:

- `needs_reply`
- `awaiting_customer`
- `invoice_ready`
- `manual_review`
- `complete`

Optional internal/system status:

- `draft_ready`

If `draft_ready` exists internally, it should map to Needs Reply in the UI rather than becoming a separate user-facing queue concept.

## Event Detail Extraction

The agent should extract event detail fields from WordPress form emails and customer thread history.

Expected fields include:

- Service
- Tier/package
- Event date
- Start time or service window
- Location
- Quantity or guest count
- Size
- Selections, flavours, and toppings
- Sticker/logo request
- Setup constraints
- Special notes or comments
- Delivery/setup needed
- Total price or rough total price when the form provides it

Attachments are supported in V1, especially sticker logos and related brand assets.

## Required Fields Before Quote

Before a useful quote or first detailed response, the thread should have enough information for:

- Service
- Tier/package
- Event date
- Start time or service window
- Location
- Quantity or guest count
- Size
- Flavours
- Toppings
- Sticker/logo request
- Setup constraints
- Special notes
- Delivery/setup needed
- Rough total price when the form provides it

Missing fields should be surfaced in the draft and asked as concise clarifying questions.

## Required Fields Before Invoice

Before marking an event `invoice_ready`, the agent must find evidence in the thread for:

- Agreed price
- Agreed package/tier
- Event date, time, and location
- Quantity and size
- Customer name and email
- Final or acceptable flavour/topping state
- Sticker or custom add-ons clarified when applicable
- Payment or deposit terms clear
- Evidence from the customer thread supporting readiness

The agent may recommend `invoice_ready`, but V1 must not create or send an invoice without a separate human-approved invoice workflow.

## Drafting Behavior

For each thread that needs a reply, the agent should generate one best reply.

Drafts must:

- Match Popup Pearl's exact tone and wording from approved email threads.
- Use `we` as the sender voice.
- Include pricing when enough information is available.
- Ask clear clarifying questions when required fields are missing.
- Avoid over-answering and avoid inventing unavailable details.
- Use approved Company Brain records and similar past threads as supporting context.

The UI must support a regenerate action. Rejecting a draft should generate a new draft rather than leaving the user blocked.

## Evidence UI

The Inbox should avoid evidence overload in the main workflow.

The primary draft panel should show the proposed reply.

A collapsed `Why this draft?` panel should show:

- Missing fields.
- Brain records used.
- Thread evidence.
- Similar past threads used for tone or examples.
- Confidence and warnings.

## Email Sending

Sending emails is included in V1 for testing, but only after human approval.

Rules:

- No auto-send.
- No Gmail draft creation in V1.
- Approved email sends directly in the same Gmail thread.
- Store sent metadata and action history in the app.
- Record who approved, what was sent, when it was sent, and the Gmail message/thread identifiers.

## Completion and Reopen

The user can mark an Inbox event complete.

If a new customer reply arrives in a completed tracked Gmail thread, the Inbox event reopens as `needs_reply`.

## Company Brain Integration

Approved Company Brain records power reasoning, drafting, and readiness checks.

Similar past threads can inform tone, structure, and examples, but raw thread content is evidence, not trusted operating knowledge.

Completed events can suggest new Company Brain candidate records. Those candidates require review before they become trusted knowledge.

No unreviewed brain facts may become trusted knowledge or affect automation as approved rules.

## Safety Rules

V1 must enforce:

- No auto-send.
- No unapproved invoice creation or sending.
- No unreviewed brain facts becoming trusted knowledge.
- Conservative direct-email classification.
- No automatic merging of separate Gmail threads.
- No automatic Gmail label creation.

## Proposed Data Model

Proposed tables:

- `GmailConnection`
- `GmailSyncRun`
- `GmailThread`
- `GmailMessage`
- `GmailAttachment`
- `InboxEvent`
- `InboxDraft`
- `InboxAction`
- `InboxEvidence`

### Data Model Notes

`GmailConnection` stores connection state for the shared Popup Pearl Gmail account.

`GmailSyncRun` records sync attempts, windows, counts, errors, and cursor state.

`GmailThread` stores normalized thread identity, participants, subject, labels/archived state as observed, tracked status, and latest message metadata.

`GmailMessage` stores immutable message evidence for synced or imported thread messages.

`GmailAttachment` stores attachment metadata and retrieval references, including sticker/logo assets.

`InboxEvent` stores the app-level work item, status, extracted event fields, manual import flag, and possible-match/link suggestions.

`InboxDraft` stores generated replies, draft status, model metadata, and approval/rejection history.

`InboxAction` stores human and system actions, including approve/send, regenerate, reject, mark complete, reopen, manual import, and possible-link decisions.

`InboxEvidence` links drafts, readiness checks, and extracted fields back to Gmail messages, attachments, approved brain records, and similar past threads.

## Build Phases

Detailed implementation phases and Phase 1 handoff are tracked in [Gmail-Backed Inbox Agent - Implementation Phases](inbox-agent-implementation-phases.md).

1. DB schema for Gmail sync, Inbox events, drafts, actions, attachments, and evidence.
2. Gmail OAuth for the shared Popup Pearl inbox.
3. Manual sync for the last 1 month, with full history fetch for matched threads.
4. Classifier for WordPress booking emails, `New Booking Request from:` patterns, and conservative direct customer emails.
5. Real Inbox list backed by `InboxEvent` statuses.
6. Thread detail timeline with Gmail messages and attachments.
7. Event detail extraction and missing-field detection.
8. Draft generation using approved Company Brain records and similar past threads.
9. Approve/send flow that sends in the original Gmail thread and stores action history.
10. Reopen-on-reply for completed tracked threads.

## Non-Goals

- No automatic Gmail label creation.
- No Gmail draft creation.
- No auto-send.
- No staff assignment.
- No automatic thread merge.
- No unapproved invoice creation or sending.
- No direct WordPress webhook dependency for V1.
- No broad Gmail task creation from promotions, vendor emails, or unrelated direct emails.

## Open Questions

- Exact Gmail OAuth app and deployment account setup.
- Exact Gmail query syntax for the first production sync.
- Whether manual import should accept Gmail URL, message ID, thread ID, or all three.
- Retention policy for downloaded attachment binaries versus metadata-only records.
