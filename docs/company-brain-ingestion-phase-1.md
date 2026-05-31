# Company Brain Ingestion System - Phase 1 Goal

Date: 2026-05-22

## Goal

Build the first phase of a Company Brain: an ingestion system that can accept messy business artifacts, preserve the raw source as evidence, extract structured facts, and queue proposed brain records for human review before agents are allowed to act on them.

This phase is for foundation, not automation. The output should be a trusted knowledge layer that later receipt, finance, inventory, email, and workflow agents can reference.

## YC Framing

YC's "Request for Startups: Full-stack AI companies" argues that full-stack AI companies need systems where humans and agents work together inside the same operating layer. Their point is not "add chat to documents"; it is that AI-native companies need a shared context substrate so agents understand the business, use its tools, and act with appropriate supervision.

Useful interpretation for this project:

- A company brain is the operational memory of a business.
- It should combine raw artifacts, extracted facts, relationships, permissions, and current operating procedures.
- It is valuable because most small businesses run on scattered spreadsheets, emails, receipts, messages, docs, calendars, and tacit owner knowledge.
- Agents are only useful when they can reliably answer: "What is true?", "Where did this come from?", "Who approved it?", and "What action am I allowed to take?"

Sources:

- YC RFS, "Full-stack AI companies": https://www.ycombinator.com/rfs
- YC AI Startup School discussion context: https://www.ycombinator.com/blog

## Product Thesis

Small businesses do not need a new CRM first. They need an ingestion and review layer that turns their existing company exhaust into a trustworthy brain.

This project should be separate from PopupPearl. PopupPearl can become a future customer/use case, but Company Brain is the base product.

Raw source library -> extraction -> entity/fact graph -> human review -> approved company brain -> agent action context.

## Phase 1 Scope

### Ingest Sources

Support local/manual upload first:

- PDFs
- Images / receipt photos
- CSV / Excel exports
- Markdown / text notes
- Email exports or copied email text
- Google Sheets inspection results already available in the dashboard

Do not build Gmail/Drive/Slack OAuth in phase 1. Keep connectors as future adapters.

### Preserve Evidence

Each ingested artifact must create a source record:

- source id
- original filename/title
- source type
- upload/import timestamp
- content hash
- raw text extraction where available
- original storage path or blob reference
- metadata such as sheet name, row number, email subject, sender, or receipt vendor when known

Nothing extracted should replace the raw source.

### Extract Candidate Knowledge

Create candidate records from sources:

- Company profile facts
- People and roles
- Customers
- Vendors
- Products/menu/items
- Pricing rules
- Expense categories
- Receipt rules
- Reimbursement rules
- Sheet mappings
- Workflow rules
- Open questions

Each candidate must link back to one or more source records and include confidence/status.

### Human Review

Add an approval queue for candidate brain records:

- pending
- approved
- rejected
- needs clarification
- superseded

Approved records become the "truth" agents can use. Pending records are searchable but clearly marked as untrusted.

### Search And Retrieval

Phase 1 retrieval can be simple:

- keyword search across raw extracted text
- filters by source type/status/entity type
- approved brain record lookup

Vector embeddings/RAG can come later, after the evidence model and review flow are stable.

## Data Model Direction

Suggested core tables/entities:

- `BrainSource`
- `BrainExtract`
- `BrainEntity`
- `BrainFact`
- `BrainRelationship`
- `BrainReviewItem`
- `BrainQuestion`
- `BrainVersion`

Minimum viable schema:

- `BrainSource`: raw artifact and metadata
- `BrainCandidate`: proposed extracted fact/entity/rule linked to source ids
- `BrainRecord`: approved fact/entity/rule available for agents
- `BrainReviewEvent`: audit trail for approval/rejection/edits

## Acceptance Criteria

Phase 1 is done when:

- A user can upload or import at least one artifact type.
- The system stores the raw source and extracted text separately.
- The system creates candidate brain records linked to their source evidence.
- A user can approve/reject/edit candidates.
- Approved records appear in a Company Brain view grouped by section.
- Every approved record shows provenance: source, timestamp, reviewer, and version.
- No agent-facing record exists without review status.

## Non-Goals

- No autonomous actions.
- No direct writes back to Google Sheets.
- No OAuth connector build-out.
- No complex graph visualization.
- No pretending unreviewed extraction is truth.
- No full RAG layer until the source/provenance/review model works.

## Codex Implementation Prompt

Build Phase 1 of the Company Brain ingestion system in `business/company-brain`.

Read this file first, then create the smallest complete vertical slice:

1. Add a Company Brain section/view to the dashboard.
2. Add local source ingestion for text/Markdown/CSV initially, with an interface that can later accept PDFs/images.
3. Store ingested sources, candidate records, approved records, and review events in local app state or a lightweight local persistence layer consistent with the existing app.
4. Extract simple candidate records using deterministic parsing first: title, source type, likely entities, candidate facts/rules, open questions.
5. Add a review queue where candidates can be approved, rejected, edited, or marked needs clarification.
6. Add an approved Brain view grouped into sections: Company Profile, People & Roles, Customers, Vendors, Products/Menu, Pricing Rules, Expense Categories, Receipt Rules, Reimbursement Rules, Sheet Mappings, Workflows, Approval Rules, Open Questions, Source Library.
7. Every candidate and approved record must show source provenance.
8. Keep UI practical and restrained. This is an operator tool, not a landing page.
9. Run typecheck/build and report changed files.

Prefer conservative, inspectable code over clever AI abstractions. This is a trust/provenance system first.
