# Company Brain

Company Brain is a Next.js operations app for Popup Pearl catering work. It combines three surfaces:

- `/` — Inbox for Gmail-synced catering threads, extracted event facts, draft replies, approvals, and invoice workflow.
- `/brain` — Approved operational knowledge base with provenance.
- `/ingestion` — Human review pipeline for turning raw sources into approved Brain records.

## What the app does

### Inbox
- Syncs recent Gmail threads into structured `InboxEvent` records.
- Classifies threads and extracts event details with deterministic parsing plus OpenAI enrichment.
- Generates operator-facing thread titles and reply drafts.
- Tracks workflow states like `needs_reply`, `awaiting_customer`, `invoice_ready`, and `invoiced`.
- Creates Zoho invoices and can send them through Zoho when external writes are enabled.

### Company Brain
- Stores approved records for pricing, workflow, approvals, products, roles, and other operating knowledge.
- Preserves provenance from source documents and review history.
- Feeds approved records back into inbox drafting and extraction.

### Ingestion Hub
- Accepts raw text, markdown, csv, email exports, PDFs, and images.
- Extracts candidate facts/rules/entities.
- Lets a human approve, reject, clarify, or edit candidates before they become trusted records.

## Architecture

- **Framework:** Next.js 15 App Router, React 19, Tailwind CSS, Radix UI
- **Persistence:** PostgreSQL via Prisma
- **Storage:** Cloudflare R2 / S3-compatible object storage for attachments and sources
- **Integrations:** Gmail API, Zoho Invoice/Books API, OpenAI Responses API
- **Auth:**
  - browser front door password + signed session cookie
  - bearer API token for automation / probes / internal calls
- **Deployment target:** standalone Next.js container (`output: "standalone"`)

## Core workflow: booking form to invoice

1. Customer submits booking form or emails Popup Pearl.
2. Gmail sync imports the thread into the Inbox.
3. Agent extracts event facts and generates a draft reply.
4. Operator reviews/sends replies.
5. Later customer replies trigger re-analysis and status transitions.
6. Once all required fields exist and the customer accepts invoicing, the event becomes `invoice_ready`.
7. Operator reviews invoice preview and creates a Zoho invoice.
8. Operator sends the final invoice through Zoho.
9. Event status moves to `invoiced`.

## Gmail sync behavior

The app exposes sync endpoints; scheduling is external.

- `POST /api/inbox/sync/gmail`
- `POST /api/inbox/sync/gmail/background`
- `GET /api/inbox/sync/gmail/background`

Background sync uses a Postgres advisory lock so overlapping runs do not process the same company at the same time. Unchanged threads are skipped when no new Gmail message IDs are found.

## Local development

```bash
npm install
cp .env.example .env.local
npm run prisma:generate
npm run dev -- --hostname 127.0.0.1 --port 3005
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Environment

### Required for a working app

```env
DATABASE_URL=
COMPANY_BRAIN_APP_PASSWORD=
COMPANY_BRAIN_SESSION_SECRET=
COMPANY_BRAIN_API_TOKEN=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GMAIL_TOKEN_ENCRYPTION_KEY=
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
```

### Optional / conditional

```env
OPENAI_API_KEY=
OPENAI_INBOX_MODEL=gpt-5.4-mini
ZOHO_ORGANIZATION_ID=
ZOHO_OAUTH_REDIRECT_URI=
ZOHO_TOKEN_ENCRYPTION_KEY=
R2_ENDPOINT=
COMPANY_BRAIN_MAX_INBOX_ATTACHMENT_BYTES=
FOLLOW_UP_THRESHOLD_DAYS=
GMAIL_SYNC_MAX_THREADS=5
GMAIL_FOOTER=
OPENAI_EXTRACTION_MODEL=
OPENAI_MODEL=
```

### Safety controls

```env
LOCAL_INGESTION_ONLY=true
ALLOW_AUTONOMOUS_ACTIONS=false
ALLOW_EXTERNAL_WRITES=false
```

Notes:
- `ALLOW_EXTERNAL_WRITES=true` is required before live Gmail sends or Zoho invoice sends will execute.
- External writes are also blocked when Safety Mode is active in app state.

## Authentication model

### Browser users
- Login at `/login` with the shared front-door password.
- Successful login sets a signed httpOnly cookie.

### API clients
- Send `Authorization: Bearer $COMPANY_BRAIN_API_TOKEN`.

### Public probe endpoints
- `GET /api/healthz`
- `GET /api/readyz`

These are intended for Kubernetes / container platform liveness and readiness probes.

## Production deployment

### Docker
The included `Dockerfile` builds a standalone Next.js container and runs `server.js`.

### Kubernetes / container platform
Recommended probes:

- **Liveness:** `GET /api/healthz`
- **Readiness:** `GET /api/readyz`

`/api/readyz` checks required env and database connectivity.

### OAuth / domain setup
For the production domain, configure:

- `GOOGLE_OAUTH_REDIRECT_URI=https://<domain>/api/auth/google/callback`
- `ZOHO_OAUTH_REDIRECT_URI=https://<domain>/api/auth/zoho/callback`

The OAuth provider dashboards must use the exact same callback URLs.

## Key API surfaces

### Inbox
- `GET /api/inbox/events?summary=1`
- `GET /api/inbox/events?eventId=<id>`
- `POST /api/inbox/events/[eventId]/analysis`
- `POST /api/inbox/events/[eventId]/draft`
- `POST /api/inbox/events/[eventId]/send`
- `POST /api/inbox/events/[eventId]/status`
- `PATCH /api/inbox/events/[eventId]/title`
- `POST /api/inbox/events/[eventId]/zoho-invoice`
- `POST /api/inbox/events/[eventId]/zoho-invoice/send`

### Brain / Ingestion
- `GET /api/brain/sources?summary=1`
- `POST /api/brain/sources`
- `POST /api/brain/sources/[sourceId]/extract`
- `GET /api/brain/candidates?status=open`
- `POST /api/brain/candidates/[candidateId]/review`
- `GET /api/brain/records`
- `PATCH /api/brain/records/[recordId]`

### Integrations / status
- `GET /api/integrations/zoho/status`
- `GET /api/integrations/zoho/invoice-template`
- `POST /api/integrations/zoho/invoice-template/sync`
- `GET /api/inbox/safety-mode`
- `POST /api/inbox/safety-mode`

## Repository hygiene

This repository is production-oriented:
- no checked-in secrets
- no mock import endpoints
- no local scratch scripts or test HTML artifacts
- build, lint, and typecheck must pass before release

## Current status

Ready for production hardening and deployment, with live external writes gated behind both env flags and Safety Mode. Remaining operator work is mostly infrastructure and OAuth/domain setup.
