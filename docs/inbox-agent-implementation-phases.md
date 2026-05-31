# Gmail-Backed Inbox Agent - Implementation Phases

Date: 2026-06-02

## Purpose

This plan splits the Popup Pearl Gmail-backed Inbox Agent V1 into pragmatic implementation phases. The goal is to reach a working, human-approved inbox workflow without rushing into Gmail OAuth, production sync, or sending before the internal workflow model is stable.

Primary spec: [Gmail-Backed Inbox Agent - V1 Spec](inbox-agent-gmail-v1.md)

Related product spec: [Popup Pearl Catering Agent - V1 Spec](popuppearl-catering-agent-v1.md)

## Phase 1 - Database And Manual Foundations

### Implementation Goal

Create the durable schema and mocked/manual foundations for Inbox Agent V1 so later workers can build Gmail sync, classification, drafting, and approval flows on top of stable tables and statuses.

This phase must stay small. It should not connect to Gmail, add OAuth, send email, add secrets, or change runtime deployment configuration.

### Scope And Deliverables

- Add Prisma enums and models for the Gmail/Inbox domain.
- Add migrations and generated Prisma client changes only as needed for the schema.
- Add manual/mock helper code or stubs that can create an inbox event from a supplied thread-like object without calling Gmail.
- Add deterministic status handling for the user-facing statuses:
  - `needs_reply`
  - `awaiting_customer`
  - `invoice_ready`
  - `manual_review`
  - `complete`
- Add minimal classification/import helpers for manual or fixture-driven flows:
  - WordPress booking form marker detection.
  - `New Booking Request from:` subject/body detection.
  - conservative direct catering intent stub.
  - manual import path that can force-create a tracked event.
- Add tests or lightweight assertions around schema-adjacent helpers if the repo already has a suitable test pattern. If not, add clear manual acceptance fixtures/helpers without introducing a new heavyweight test framework.
- Preserve existing Company Brain review/provenance patterns where useful.

### Proposed Prisma Enums

Use exact enum names only if they fit the existing Prisma style. Values can be uppercase in Prisma while mapping to the user-facing lowercase strings in UI/helper code.

```prisma
enum GmailConnectionStatus {
  DISCONNECTED
  CONNECTED
  ERROR
}

enum GmailSyncRunStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
}

enum GmailThreadTrackStatus {
  UNTRACKED
  TRACKED
  IGNORED
}

enum InboxEventStatus {
  NEEDS_REPLY
  AWAITING_CUSTOMER
  INVOICE_READY
  MANUAL_REVIEW
  COMPLETE
}

enum InboxDraftStatus {
  DRAFT
  APPROVED
  SENT
  REJECTED
}

enum InboxActionType {
  CREATED
  MANUAL_IMPORTED
  CLASSIFIED
  STATUS_CHANGED
  DRAFT_GENERATED
  DRAFT_REGENERATED
  DRAFT_REJECTED
  DRAFT_APPROVED
  EMAIL_SENT
  MARKED_COMPLETE
  REOPENED
  POSSIBLE_LINK_SUGGESTED
  POSSIBLE_LINK_ACCEPTED
  POSSIBLE_LINK_REJECTED
}

enum InboxEvidenceKind {
  GMAIL_MESSAGE
  GMAIL_ATTACHMENT
  BRAIN_RECORD
  SIMILAR_THREAD
  EXTRACTED_FIELD
  READINESS_CHECK
}
```

### Proposed Prisma Models

The implementation worker should adapt fields to Prisma naming and relation constraints already present in `prisma/schema.prisma`, but the V1 schema should cover these entities:

- `GmailConnection`
  - shared Popup Pearl Gmail account identity.
  - connection status, email address, provider account id, cursor/history metadata.
  - OAuth token fields may exist only if represented safely as nullable placeholders; Phase 1 must not require real secrets.
- `GmailSyncRun`
  - run status, sync window, started/completed timestamps, counts, error details, cursor state.
- `GmailThread`
  - Gmail thread id, company id, subject, participants, labels snapshot, archived state, latest message timestamp, tracked status.
  - one-to-one or one-to-many relation to `InboxEvent` for V1's one thread to one event rule.
- `GmailMessage`
  - Gmail message id, thread relation, sender/recipient metadata, subject snapshot, plain/html body snapshots where available, sent timestamp, internal timestamp.
  - immutable evidence for synced or manually imported messages.
- `GmailAttachment`
  - message relation, Gmail attachment id, filename, MIME type, size, content id, storage or retrieval reference, metadata.
- `InboxEvent`
  - company id, Gmail thread relation, status, source/creation reason, manual import flag.
  - extracted event fields as JSON for V1: service, package/tier, event date/time, location, quantity/guest count, size, flavours, toppings, sticker/logo request, setup constraints, special notes, delivery/setup, rough total price, missing fields, recommended next action.
  - possible match/link suggestions as JSON for V1, not automatic merge state.
- `InboxDraft`
  - event relation, body, subject, status, model metadata, approval/rejection timestamps and actor ids where available.
  - no Gmail draft id in V1 because Gmail draft creation is a non-goal.
- `InboxAction`
  - event relation, optional draft/message relation, action type, actor id if human, before/after JSON, note, created timestamp.
  - audit trail for manual import, classification, status changes, draft events, approval/send metadata, complete/reopen.
- `InboxEvidence`
  - event/draft relation, evidence kind, source ids or external refs, locator, short evidence text, confidence, metadata.
  - links drafts, extracted fields, and readiness checks back to Gmail messages, attachments, approved brain records, and similar threads.

### Non-Goals

- No real Gmail OAuth.
- No Gmail API calls.
- No production sync.
- No email send.
- No Gmail draft creation.
- No env var, secret, deployment, cron, or runtime config changes.
- No UI rebuild beyond the smallest optional manual/mock surface needed to verify the foundations.
- No invoice workflow.
- No automatic thread merge.
- No automatic Gmail label creation.
- No AI drafting or OpenAI calls.

### Test Cases And Acceptance Tests

- Prisma schema validates and client generation succeeds.
- A mock WordPress booking thread can be represented by `GmailThread`, `GmailMessage`, optional `GmailAttachment`, and one `InboxEvent`.
- A mock subject/body containing `New Booking Request from:` classifies into an event with status `needs_reply`.
- A mock unrelated promotion/newsletter does not create an active event unless manual import is explicitly requested.
- A manual import helper can create an event for an archived or older thread-like fixture and records an `InboxAction` of `MANUAL_IMPORTED`.
- Status helper accepts only `needs_reply`, `awaiting_customer`, `invoice_ready`, `manual_review`, and `complete` as user-facing statuses.
- Marking an event complete can be represented with an action and status change without deleting thread/message evidence.
- Fixture/manual helper output includes enough extracted field placeholders to support later missing-field detection.

### Likely Files And Modules Touched

- `prisma/schema.prisma`
- `prisma/migrations/**`
- `app/lib/**` or `lib/**` for manual import/classification helpers, depending on existing placement conventions.
- `app/api/**` only if a tiny manual/mock endpoint is needed for verification.
- `app/lib/mockData.ts` only if fixtures are useful and consistent with current app patterns.
- `package.json` should not change unless an existing script is needed and already missing.

### Completion Criteria

- The database model can support the rest of Inbox Agent V1 without another immediate schema rethink.
- Phase 1 can be verified without Gmail credentials, OAuth consent, environment variables, background jobs, or production sync.
- Manual/mock helper paths demonstrate event creation, conservative classification, status handling, action logging, and evidence linkage.
- Typecheck and Prisma validation/generation pass, or any failure is documented with the exact blocker.

## Phase 2 - Gmail Connection Shell And Manual Import UI

### Implementation Goal

Build the app-side surfaces for Gmail connection state and manual thread import without enabling production OAuth or automated sync until the workflow model is ready.

### Scope And Deliverables

- Add settings/source UI that shows Gmail connection status from `GmailConnection`.
- Add a manual import form for pasted Gmail thread/message fixture data or a local thread id placeholder.
- Persist manually imported thread/message data through Phase 1 helpers.
- Show imported events in a simple Inbox list backed by `InboxEvent`.
- Display action history for manual imports.

### Non-Goals

- No real OAuth token exchange.
- No Gmail API fetch by real thread id.
- No automated sync.
- No send.
- No AI drafting.

### Test Cases And Acceptance Tests

- User can manually import a relevant fixture and see a new Inbox event.
- User can manually import an archived/older fixture and see `manual_imported` action history.
- Unrelated fixture import can be rejected by classifier unless the manual force flag is used.
- Imported event survives page reload because it is database-backed.
- Empty or malformed manual import returns a clear error and does not create partial records.

### Likely Files And Modules Touched

- `app/page.tsx`
- `app/settings/page.tsx`
- `components/app-sidebar.tsx` if navigation labels need a small update.
- `app/api/inbox/**`
- `app/lib/inbox/**` or equivalent helper module.
- Phase 1 Prisma models.

### Completion Criteria

- There is a visible, database-backed Inbox list.
- Manual import is usable enough to seed test threads without Gmail.
- Connection state is visible but clearly not connected to live Gmail yet.

## Phase 3 - Gmail OAuth And Read-Only Thread Fetch

### Implementation Goal

Connect the shared Popup Pearl Gmail account in read-only mode and fetch selected threads safely.

### Scope And Deliverables

- Implement Gmail OAuth connection for the shared account.
- Store connection metadata and token state securely according to the deployment target.
- Add read-only Gmail client helpers for thread/message/attachment metadata fetches.
- Fetch full thread history for a manually selected Gmail thread.
- Normalize Gmail API responses into `GmailThread`, `GmailMessage`, and `GmailAttachment`.
- Record sync/import actions and errors in `InboxAction` or `GmailSyncRun`.

### Non-Goals

- No automated last-month sync yet.
- No send scope.
- No Gmail label mutation.
- No Gmail draft creation.
- No AI drafting.
- No invoice workflow.

### Test Cases And Acceptance Tests

- OAuth connection can be completed for the shared account in the intended environment.
- Revoked/expired credentials show `ERROR` state without breaking the app.
- Fetching a known thread stores all messages in that thread, including messages older than one month.
- Attachments are stored as metadata/retrieval references without losing filename, MIME type, or size.
- Archived thread can be fetched only through manual import path.

### Likely Files And Modules Touched

- `app/settings/page.tsx`
- `app/api/auth/google/**` or integration-specific route handlers.
- `app/api/inbox/import/**`
- `app/lib/integrations/**`
- `app/lib/inbox/**`
- `prisma/schema.prisma` only if token metadata fields need a minor adjustment.

### Completion Criteria

- The app can connect to the shared Gmail and fetch a selected thread read-only.
- Stored data remains normalized and auditable.
- No send permission or send behavior is enabled.

## Phase 4 - Conservative Sync And Classification

### Implementation Goal

Turn Gmail into a safe source of Inbox events by syncing only the last month, matching known booking signals, and conservatively handling direct customer emails.

### Scope And Deliverables

- Add manual "Sync last month" action.
- Query non-archived Gmail messages from the last month.
- Create events for WordPress booking form emails and `New Booking Request from:` patterns.
- Add conservative direct catering classifier.
- Pull full history for matched threads after the initial last-month query finds a relevant thread.
- Ignore promotions, newsletters, unrelated admin/vendor marketing, and archived messages unless manually imported.
- Reopen completed tracked events as `needs_reply` when a new customer reply arrives.

### Non-Goals

- No scheduled/background sync unless required for manual sync reliability.
- No Gmail label mutation.
- No automatic thread merge.
- No send.
- No AI drafting beyond classifier/extractor stubs if not needed.

### Test Cases And Acceptance Tests

- Last-month sync creates an event for WordPress booking form emails.
- Last-month sync creates an event for `New Booking Request from:` matches.
- Direct customer catering email creates an event only when confidence is high.
- Promotion/newsletter/vendor marketing does not create an active task.
- Archived thread is ignored by normal sync.
- Matched thread fetch stores full thread history, including older messages.
- Completed event reopens as `needs_reply` when a new customer reply is synced.
- Existing tracked thread updates messages without creating duplicate events.

### Likely Files And Modules Touched

- `app/api/inbox/sync/**`
- `app/lib/integrations/gmail/**`
- `app/lib/inbox/classifier/**`
- `app/lib/inbox/sync/**`
- `app/page.tsx`
- `prisma/schema.prisma` only for minor metadata additions if needed.

### Completion Criteria

- A human can run a safe sync and get a trustworthy Inbox list.
- Duplicate prevention, ignored-message handling, and reopen behavior are covered by tests or fixtures.
- The sync cannot send mail or mutate Gmail labels.

## Phase 5 - Inbox Detail, Extraction, And Readiness

### Implementation Goal

Make each Inbox event operational: show the thread timeline, attachments, extracted event details, missing fields, and invoice-readiness evidence.

### Scope And Deliverables

- Add Inbox event detail view.
- Show Gmail message timeline and attachment metadata.
- Extract event detail fields from form emails and thread history.
- Store extracted fields on `InboxEvent`.
- Show missing fields before quote.
- Add readiness check for `invoice_ready` with supporting evidence.
- Add collapsed `Why this draft?` or `Why this status?` evidence panel foundation.

### Non-Goals

- No email drafting yet unless read-only preview stubs are useful.
- No send.
- No Stripe invoice creation.
- No automatic merge.
- No unreviewed brain facts becoming trusted knowledge.

### Test Cases And Acceptance Tests

- Event detail page shows all messages in order.
- Attachments appear with useful metadata.
- WordPress form fixture extracts service, package/tier, event date/time, location, quantity/guest count, size, flavours, toppings, sticker/logo request, setup notes, delivery/setup, and rough total when present.
- Missing fields are shown when required quote fields are absent.
- `invoice_ready` recommendation requires evidence for agreed price/package, event date/time/location, quantity/size, customer name/email, finalized selections, custom add-ons, and payment/deposit terms.
- Evidence links point back to messages, attachments, or approved brain records.

### Likely Files And Modules Touched

- `app/inbox/[eventId]/page.tsx` or equivalent route.
- `app/page.tsx`
- `app/components/EvidenceList.tsx`
- `app/components/SafetyStatus.tsx`
- `app/lib/inbox/extraction/**`
- `app/lib/brainApi.ts`
- `app/api/inbox/events/**`

### Completion Criteria

- A human can inspect one event and understand what is known, what is missing, and why the app recommends the current status.
- Extraction output is stored, reviewable, and evidence-backed.

## Phase 6 - Draft Generation And Approval Workflow

### Implementation Goal

Generate one best reply for events needing a response, using approved Company Brain records and thread evidence, with human approval before anything can be sent.

### Scope And Deliverables

- Add draft generation for `needs_reply` events.
- Retrieve approved Company Brain records and similar past threads as context.
- Store draft body, subject, model metadata, status, and evidence.
- Add regenerate and reject-new-draft behavior.
- Add editable draft UI.
- Add approve action that marks a draft approved but does not send unless Phase 7 send flow is enabled.
- Show collapsed `Why this draft?` panel with missing fields, brain records used, thread evidence, similar threads, confidence, and warnings.

### Non-Goals

- No auto-send.
- No Gmail draft creation.
- No invoice creation.
- No unapproved brain updates.
- No broad autonomous agent loop.

### Test Cases And Acceptance Tests

- Draft uses `we` as Popup Pearl voice.
- Draft includes pricing only when enough approved context and thread data exists.
- Draft asks concise clarifying questions when required fields are missing.
- Draft does not invent unavailable details.
- Regenerate creates a new draft/action history entry.
- Rejecting a draft leaves the event actionable and can generate a replacement.
- Evidence panel shows sources used.

### Likely Files And Modules Touched

- `app/lib/inbox/drafting/**`
- `app/lib/brainApi.ts`
- `app/api/inbox/events/[eventId]/drafts/**`
- `app/inbox/[eventId]/page.tsx`
- `app/components/EvidenceList.tsx`
- `prisma/schema.prisma` only for minor draft/evidence metadata additions if needed.

### Completion Criteria

- A human can generate, inspect, edit, regenerate, reject, and approve a reply draft.
- Every draft has evidence and action history.
- Approval does not bypass the send gate.

## Phase 7 - Approved Gmail Send And Completion Loop

### Implementation Goal

Allow a human-approved draft to be sent in the original Gmail thread and record the full audit trail.

### Scope And Deliverables

- Add Gmail send scope only when the previous phases are stable.
- Send approved edited body in the original Gmail thread.
- Store Gmail send metadata, message id, approver, sent timestamp, and action history.
- Transition event to `awaiting_customer` after approved send unless human selects another status.
- Support marking an event complete.
- Keep reopen-on-reply behavior from Phase 4.

### Non-Goals

- No auto-send.
- No Gmail draft creation.
- No automatic Gmail label creation.
- No Stripe invoice creation.
- No automatic thread merge.
- No sending without explicit human approval.

### Test Cases And Acceptance Tests

- Unapproved draft cannot be sent.
- Approved draft sends only in the original thread.
- Edited approved body is what gets sent and stored.
- Send action records approver, sent content, timestamp, Gmail message id, and Gmail thread id.
- Event moves to `awaiting_customer` after send.
- Completed event can be reopened when a customer reply arrives.
- Send failure records an error and does not mark the draft sent.

### Likely Files And Modules Touched

- `app/lib/integrations/gmail/**`
- `app/lib/inbox/send/**`
- `app/api/inbox/events/[eventId]/send/**`
- `app/inbox/[eventId]/page.tsx`
- `prisma/schema.prisma` only if send metadata needs minor additions.

### Completion Criteria

- V1 can handle the email side of the workflow end to end with explicit human approval.
- The app has durable evidence for what was approved, what was sent, who approved it, and where it lives in Gmail.

## Phase 8 - Brain Feedback And V1 Hardening

### Implementation Goal

Close the V1 loop by suggesting post-event Company Brain updates, improving operational reliability, and hardening safety boundaries.

### Scope And Deliverables

- Suggest new Company Brain candidates from completed events.
- Keep those candidates untrusted until reviewed through the existing Brain review flow.
- Add sync health/error visibility.
- Add duplicate detection and possible match UI for separate threads about the same event.
- Improve audit views for actions and evidence.
- Add regression fixtures for high-risk classification, drafting, send gating, and reopen cases.

### Non-Goals

- No automatic merge.
- No automatic approval of brain records.
- No invoice creation unless a separate Stripe invoice phase is explicitly started.
- No staff assignment.
- No broad CRM build-out.

### Test Cases And Acceptance Tests

- Completed event can suggest candidate brain records with source evidence.
- Suggested brain records remain pending until human review.
- Possible duplicate/link suggestions do not merge automatically.
- Sync failure is visible and retryable.
- Safety checks prevent auto-send, unreviewed knowledge trust, Gmail label mutation, and unapproved invoice behavior.

### Likely Files And Modules Touched

- `app/lib/brainCandidatePipeline.ts`
- `app/lib/inbox/brain-feedback/**`
- `app/api/brain/candidates/**`
- `app/api/inbox/events/**`
- `app/brain/page.tsx`
- `app/page.tsx`
- `app/inbox/[eventId]/page.tsx`

### Completion Criteria

- V1 is demo-ready as a human-approved Gmail-backed work queue.
- Safety rules are explicitly tested or fixture-verified.
- New operational knowledge flows back into Company Brain only through human review.

## Phase 1 Handoff Prompt

Use this prompt to start the first implementation worker:

```text
You are working in /Users/dan/clawd/business/company-brain. You are not alone in the codebase: do not revert changes you did not make, and adapt to existing work.

Task: Implement Phase 1 of the Popup Pearl Gmail-backed Inbox Agent V1.

Read these files first:
- docs/inbox-agent-gmail-v1.md
- docs/inbox-agent-implementation-phases.md
- docs/popuppearl-catering-agent-v1.md
- prisma/schema.prisma
- package.json

Implement only Phase 1 from docs/inbox-agent-implementation-phases.md:
- Add Prisma schema support for Gmail/Inbox models and enums:
  GmailConnection, GmailSyncRun, GmailThread, GmailMessage, GmailAttachment, InboxEvent, InboxDraft, InboxAction, InboxEvidence.
- Include user-facing Inbox statuses needs_reply, awaiting_customer, invoice_ready, manual_review, complete, mapped safely to Prisma enum values if needed.
- Add mocked/manual foundations only: deterministic helper/stub code for manual thread import, WordPress booking marker detection, New Booking Request from: detection, conservative direct catering intent stub, status validation, action/evidence creation.
- Keep the work small and boring.

Strict non-goals:
- Do not implement real Gmail OAuth.
- Do not call the Gmail API.
- Do not send email.
- Do not create Gmail drafts.
- Do not add env vars, secrets, deployment config, cron config, or runtime config changes.
- Do not implement AI drafting or OpenAI calls.
- Do not implement invoice workflow.

Verification:
- Run Prisma validation/generation as appropriate.
- Run npm run typecheck.
- Add or run any lightweight helper tests/checks that already fit the repo. Do not introduce a heavy new test framework unless the repo already uses one.

Report exactly what files changed, what verification passed/failed, and any blockers.
```
