# Popup Pearl Catering Agent - Implementation Plan

Date: 2026-05-26

## Recommendation

Build this as a new Next.js app in `business/company-brain`, using the existing Popup Pearl receipt dashboard as the integration reference, not as the codebase to keep expanding.

Use a boring, inspectable stack:

- Next.js + React + TypeScript for the web app.
- Postgres with pgvector for workflow data, approved brain records, keyword search, and vector search.
- Prisma or Drizzle for schema/migrations.
- OpenAI for structured extraction, email drafting, invoice preview drafting, and embeddings.
- Gmail API for reading shared mailbox threads and sending approved replies.
- Stripe API for invoice preview/create/finalize/send.
- Google Sheets API for menu/pricing/backend source reads.
- Inngest or Upstash QStash for background sync/jobs.
- Clerk or Auth.js for web app login, depending on whether speed or ownership matters more.

## Why This Stack

The existing `business/popuppearl-ops-dashboard` already uses:

- Next.js
- React
- TypeScript
- `googleapis`
- `openai`
- `zod`
- Vercel deployment

That means a new app can reuse known integration patterns while avoiding receipt-app coupling.

Postgres + pgvector is the right first database because it can hold normal relational workflow state and vector embeddings in the same place. Supabase is the fastest managed path for this because it supports Postgres, auth if needed, storage, full-text search, and pgvector.

## Frameworks / Tools

### Web App

Use Next.js App Router.

Why:

- Already used in the Popup Pearl receipt app.
- Good fit for Vercel.
- Server route handlers work well for Gmail/Stripe webhooks and API endpoints.
- React Server Components are fine for admin/dashboard views.

Use route handlers for integrations and mutating API calls. Use server actions only for simple internal form mutations.

### UI

Use plain React + CSS modules or Tailwind.

Recommendation: Tailwind only if starting fresh and moving fast. Keep the UI restrained: inbox, detail panes, review queues, source panels.

Use lucide-react for icons if a component library is needed.

Avoid a heavy dashboard template.

### Database

Use Supabase Postgres with pgvector, or local Postgres for development and Supabase for deployment.

Core reasons:

- relational workflow state matters more than vector search
- approved brain records need audit/version history
- pgvector supports embeddings directly in Postgres
- Postgres full-text search can combine with vector search for hybrid retrieval

ORM options:

- Prisma: easier migrations and common Next.js path.
- Drizzle: lighter, more SQL-like, better if we want close control.

Recommendation: Prisma unless we expect very custom SQL early. Use raw SQL migrations for pgvector indexes/search functions if Prisma is awkward.

### Background Jobs

Use Inngest if we want durable multi-step workflows with retries and observability.

Use Upstash QStash if we want simpler HTTP queue/scheduled jobs.

Recommendation: Inngest for this project because the workflows are stateful:

- sync Gmail
- ingest thread
- extract inquiry
- generate draft
- wait for approval
- monitor replies
- prepare invoice preview
- create/send invoice after approval

If minimizing accounts/tools matters, start with Vercel cron + route handlers and graduate to Inngest once workflows become annoying.

### AI / Agent Layer

Use OpenAI Responses API or Chat Completions with structured outputs, plus Zod validation on our side.

Agent jobs should be narrow, not one giant agent:

- inquiry classifier
- thread detail extractor
- similar-thread retriever
- reply drafter
- invoice preview drafter
- brain insight proposer
- brain lint/checker

Every model output that affects state should be validated against a schema.

Embeddings:

- use `text-embedding-3-small` initially
- embed email chunks, approved brain records, Stripe invoice summaries, and sheet-derived product/pricing records

### Gmail

Use Gmail API through the existing Google OAuth pattern.

V1 can poll on a schedule every few minutes. Gmail push notifications via Pub/Sub are cleaner later, but add Google Cloud setup complexity.

Actions:

- list/search messages by query
- fetch full threads
- store immutable source copies
- send approved replies from shared Popup Pearl account
- preserve Gmail thread IDs and message IDs

Initial trigger query should target WordPress form notification emails, using sender/subject/body markers once known.

### Stripe

Use Stripe Node SDK.

V1 invoice flow:

1. Agent creates invoice preview data in our DB.
2. Human approves "Approve & Send Invoice."
3. Server creates Stripe customer if needed.
4. Server creates invoice items.
5. Server creates invoice.
6. Server finalizes/sends invoice.
7. Store Stripe invoice ID and status.

Use Stripe test mode until the first end-to-end demo is verified.

### Google Sheets

Use Google Sheets API read-only in V1.

Pull:

- menu items
- product/pricing rules
- catering package data if present
- operational backend sheet ranges

Do not write to Sheets from this app in V1 unless explicitly needed.

## Data Model

### Sources

- `SourceRecord`
  - id
  - type: gmail_message, gmail_thread, stripe_invoice, stripe_customer, sheet_range, uploaded_file
  - external_id
  - title
  - raw_text
  - metadata_json
  - content_hash
  - imported_at

- `SourceChunk`
  - id
  - source_record_id
  - text
  - chunk_index
  - embedding
  - metadata_json

### Brain

- `BrainClaim`
  - id
  - claim_type: tone_rule, workflow_rule, pricing_rule, invoice_rule, customer_fact, product_fact
  - title
  - body
  - status: draft, approved, rejected, needs_clarification, superseded
  - confidence
  - reviewer_id
  - approved_at
  - supersedes_id

- `BrainClaimSource`
  - brain_claim_id
  - source_record_id
  - source_chunk_id
  - evidence_quote_or_span

- `BrainReviewEvent`
  - id
  - brain_claim_id
  - actor_id
  - action
  - before_json
  - after_json
  - created_at

### Workflow

- `Customer`
  - id
  - name
  - email
  - phone
  - stripe_customer_id

- `EventInquiry`
  - id
  - customer_id
  - gmail_thread_id
  - state
  - event_date
  - guest_count
  - pickup_or_delivery
  - location
  - missing_fields_json
  - confidence
  - created_at
  - updated_at

- `DraftEmail`
  - id
  - inquiry_id
  - body
  - subject
  - status: draft, approved, sent, rejected
  - evidence_json
  - gmail_message_id
  - approved_by
  - sent_at

- `InvoicePreview`
  - id
  - inquiry_id
  - status: draft, approved_sent, rejected
  - customer_json
  - line_items_json
  - totals_json
  - evidence_json
  - stripe_invoice_id
  - approved_by
  - sent_at

- `AutomationRun`
  - id
  - type
  - status
  - input_json
  - output_json
  - error
  - created_at
  - completed_at

## Implementation Phases

### Phase 0 - Project Setup

- Create new Next.js app under `business/company-brain/app` or `business/company-brain/popuppearl-catering-agent`.
- Add TypeScript, lint/typecheck/build scripts.
- Add auth placeholder or real auth.
- Add Postgres/Supabase connection.
- Add schema/migrations.
- Add base layout with Inbox, Brain, Sources, Settings.

Exit criteria:

- app runs locally
- database migration applies
- empty inbox and brain screens render

### Phase 1 - Source Import

- Connect shared Gmail OAuth.
- Implement scheduled Gmail polling.
- Store Gmail threads/messages as immutable `SourceRecord`s.
- Add WordPress form detection rule.
- Add Sources screen showing imported threads.
- Add manual "sync now" button.

Exit criteria:

- a WordPress form email becomes a source record
- duplicate imports are avoided by external ID/content hash
- source text is viewable with metadata

### Phase 2 - Inquiry Inbox

- Extract `EventInquiry` from WordPress form email.
- Create inquiry lifecycle states.
- Show inquiry cards in Inbox.
- Build Inquiry Detail page.
- Extract missing fields and confidence.

Exit criteria:

- one real/past form email becomes an inquiry task
- detail page shows extracted event/customer fields and missing info

### Phase 3 - Brain Seed

- Import seed catering threads, Stripe invoices, and Sheets ranges.
- Chunk/embed sources.
- Generate candidate brain claims.
- Build Brain review queue.
- Allow approve/edit/reject.
- Build approved Brain view.

Exit criteria:

- approved tone/workflow/pricing/invoice rules exist
- every approved record has citations and review history

### Phase 4 - Email Draft Approval

- Retrieve approved brain records + similar past threads.
- Generate draft reply.
- Show "why" panel with citations.
- Human can edit/approve/send.
- Send via Gmail API.
- Store sent Gmail message ID.

Exit criteria:

- app drafts and sends one approved reply in an existing Gmail thread

### Phase 5 - Follow-Up Monitoring

- Continue polling watched inquiry threads.
- Detect customer replies.
- Update inquiry state.
- Draft follow-ups.
- Require approval before sending.

Exit criteria:

- customer reply creates a follow-up task
- approved follow-up sends into the same thread

### Phase 6 - Stripe Invoice Approval

- Import matching Stripe invoice history.
- Generate invoice preview from approved brain + thread evidence.
- Human clicks "Approve & Send Invoice."
- Server creates/finalizes/sends Stripe invoice.
- Store Stripe invoice ID/status.

Exit criteria:

- test-mode Stripe invoice is created and sent after explicit approval

### Phase 7 - End-to-End Demo Hardening

- Use one real historical thread as replay/demo input.
- Add error handling and audit logs.
- Add manual override paths.
- Add safety checks for live mode.
- Verify mobile and desktop UI.

Exit criteria:

- one catering inquiry can be handled from intake through approved Stripe invoice send

## Required Accounts / Secrets

- Google OAuth client for shared Popup Pearl Gmail and Sheets.
- Gmail refresh token for the shared account.
- Stripe secret key, ideally test mode first.
- OpenAI API key.
- Supabase database URL/service key, or local Postgres URL.
- Background job provider key if using Inngest/Upstash.
- Auth provider secrets if using Clerk/Auth.js.

## Safety Rules

- Default Stripe to test mode until explicitly switched.
- Show a live-mode warning before sending real Stripe invoices.
- Never send Gmail replies without an approval event.
- Never let draft brain claims affect automations.
- Store every external action in an audit log.
- Keep raw source copies immutable.
- Add idempotency keys for Stripe invoice creation and Gmail send operations.

## Open Decisions

- Supabase vs self-hosted/local Postgres for first build.
- Prisma vs Drizzle.
- Inngest vs QStash vs Vercel cron first.
- Clerk vs Auth.js vs simple password gate for early internal prototype.
- Whether to start from a fresh Next.js app or share utilities with `popuppearl-ops-dashboard`.

## Suggested Defaults

For speed and reliability:

- Fresh Next.js app.
- Supabase Postgres + pgvector.
- Prisma.
- Vercel deployment.
- Vercel cron for Gmail polling at first.
- Upgrade to Inngest when workflow retries/observability become necessary.
- Simple password-protected internal app first, then Clerk/Auth.js once more users need accounts.
- Stripe test mode for initial demo.

