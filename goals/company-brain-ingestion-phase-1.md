# Codex Goal - Company Brain Ingestion System Phase 1

Workspace: `/Users/dan/clawd/business/company-brain`

Primary brief: `/Users/dan/clawd/business/company-brain/docs/company-brain-ingestion-phase-1.md`

Build the first phase of a Company Brain ingestion system. The system should ingest raw business artifacts, preserve evidence, extract candidate company knowledge, route candidates through human review, and expose approved records as the trusted brain that later agents can use.

Key principle: raw source is evidence; approved brain record is truth.

Do not build autonomous actions yet. Do not redesign the dashboard. Build the smallest complete vertical slice that proves ingestion -> extraction -> review -> approved knowledge with provenance.

## Locked V1 Decisions

- First real user: Popup Pearl admin.
- Auth/roles: assume a single admin user for now; do not build a full roles system in this slice.
- Storage split:
  - Cloudflare R2 stores raw uploaded artifacts.
  - Postgres stores source metadata, extracted text, candidates, review events, approved records, and provenance.
- Environment:
  - `DATABASE_URL` points to the CloudNativePG Postgres database through the current local port-forward during local dev.
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_ENDPOINT` are present in `.env`.
  - Use the existing `OPENAI_API_KEY` env var for extraction/OCR/candidate generation.
- R2 object key shape:
  - `companies/popuppearl/sources/YYYY/MM/<hash>-<safe-filename>`
- Phase 1 source types:
  - receipt/photo
  - `.eml` email thread upload
  - pasted email thread text
  - PDF/menu/quote/invoice
  - pasted text/Markdown/CSV
- Email thread guidance:
  - support `.eml` upload and paste fallback now
  - do not build Gmail/Outlook OAuth yet
- OpenAI extraction:
  - use OpenAI for candidate suggestions, OCR-like image/document understanding where possible, and email/workflow/tone analysis
  - every AI-generated candidate must remain untrusted until an admin approves it
- Brain categories to prioritize:
  - menu items
  - package prices
  - customer preferences
  - vendor info
  - event workflow rules
  - reimbursement/receipt rules
  - tone of email
  - inquiry-to-invoice workflow
- Review behavior:
  - one source should create multiple candidate cards when possible
  - approved records should be editable directly in v1
  - approval must create/persist a `BrainRecord` in Postgres
- Evidence behavior:
  - uploaded files are stored as private evidence in R2
  - no signed download links are required for v1
  - store the R2 object key in `BrainSource.storageRef`
- Ingestion UI:
  - split the page into `Upload file` and `Paste text` paths
  - after ingest/extract, route the admin into a review experience
  - Source Library can come after the vertical slice

## Successful Implementation Criteria

The implementation is successful when an admin can:

1. Upload a receipt/photo/PDF/email/text artifact from `/ingestion`.
2. See the raw artifact saved to R2 and a `BrainSource` row saved to Postgres with `storageRef`, `contentHash`, source type, metadata, raw/extracted text where available, and import timestamp.
3. Trigger or automatically receive OpenAI-generated `BrainCandidate` records linked to the source evidence.
4. Review multiple candidate cards from one source.
5. Edit candidate title/body/section before approval.
6. Approve/reject/mark needs clarification.
7. See approved candidates become persisted `BrainRecord`s in Postgres.
8. See approved records in `/brain`, grouped by section, with provenance back to source evidence.
9. Confirm pending/rejected candidates do not appear as trusted approved brain records.
10. Refresh the browser and still see sources, candidates, and approved records from Postgres.
11. Avoid exposing raw private files publicly.
12. Run `npm run typecheck` and `npm run build` successfully.

Nice-to-have but not required for this slice:

- manual source library page
- signed evidence download links
- Gmail/Outlook connector
- multi-user auth
- vector search/RAG
