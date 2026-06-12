"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  UploadCloud,
  Clipboard,
  CheckCircle2,
  AlertCircle,
  FileText,
  Cloud,
  Loader2,
  Sparkles,
  Info,
  FolderOpen,
  Database
} from "lucide-react";
import { SafetyStatus } from "../components/SafetyStatus";
import type { ApiCandidate, ApiSource } from "../lib/brainApi";

const SOURCE_TYPES = [
  ["TEXT", "Text"],
  ["MARKDOWN", "Markdown"],
  ["CSV", "CSV"],
  ["PDF", "PDF"],
  ["IMAGE", "Receipt/photo"],
  ["EMAIL_EXPORT", "Email thread"],
  ["OTHER", "Other"],
] as const;

const SECTIONS = [
  ["COMPANY_PROFILE", "Company Profile"],
  ["PEOPLE_ROLES", "People & Roles"],
  ["CUSTOMERS", "Customers"],
  ["VENDORS", "Vendors"],
  ["PRODUCTS_MENU", "Products/Menu"],
  ["PRICING_RULES", "Pricing Rules"],
  ["EXPENSE_CATEGORIES", "Expense Categories"],
  ["RECEIPT_RULES", "Receipt Rules"],
  ["REIMBURSEMENT_RULES", "Reimbursement Rules"],
  ["SHEET_MAPPINGS", "Sheet Mappings"],
  ["WORKFLOWS", "Workflows"],
  ["APPROVAL_RULES", "Approval Rules"],
  ["OPEN_QUESTIONS", "Open Questions"],
  ["SOURCE_LIBRARY", "Source Library"],
] as const;

type Draft = { title: string; body: string; section: string };
type ReviewAction = "approve" | "reject" | "clarify";

export default function IngestionPage() {
  const [sources, setSources] = useState<ApiSource[]>([]);
  const [candidates, setCandidates] = useState<ApiCandidate[]>([]);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewingCandidates, setReviewingCandidates] = useState<
    Record<string, ReviewAction | undefined>
  >({});

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadType, setUploadType] = useState("OTHER");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pasteTitle, setPasteTitle] = useState("email-thread.txt");
  const [pasteType, setPasteType] = useState("EMAIL_EXPORT");
  const [pasteText, setPasteText] = useState(
    "Customer asked for a quote for 75 bubble tea drinks. Tone should be warm, concise, and polished. Ask for delivery address and final flavor mix before invoice. Quotes over $500 require owner approval.",
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sourceRes, candidateRes] = await Promise.all([
        fetch("/api/brain/sources?summary=1", { cache: "no-store" }),
        fetch("/api/brain/candidates?status=open", { cache: "no-store" }),
      ]);
      if (!sourceRes.ok || !candidateRes.ok) {
        const payload = await (sourceRes.ok ? candidateRes : sourceRes).json();
        throw new Error(payload.error || "Failed to load ingestion data.");
      }
      const sourceBody = (await sourceRes.json()) as { sources: ApiSource[] };
      const candidateBody = (await candidateRes.json()) as {
        candidates: ApiCandidate[];
        counts?: Record<string, number>;
      };
      setSources(sourceBody.sources);
      setCandidates(candidateBody.candidates);
      setCandidateCounts(candidateBody.counts ?? {});
      setDrafts((current) => {
        const next = { ...current };
        for (const candidate of candidateBody.candidates) {
          if (candidate.status !== "PENDING" && candidate.status !== "NEEDS_CLARIFICATION") continue;
          next[candidate.id] ??= {
            title: candidate.title,
            body: candidate.body,
            section: candidate.section,
          };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ingestion data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const pendingCandidates = candidates;

  const stats = useMemo(
    () => [
      { label: "Sources", value: sources.length },
      { label: "Pending", value: (candidateCounts.PENDING ?? 0) + (candidateCounts.NEEDS_CLARIFICATION ?? 0) },
      { label: "Approved", value: candidateCounts.APPROVED ?? 0 },
      { label: "R2 files", value: sources.filter((item) => item.storageRef).length },
    ],
    [candidateCounts, sources],
  );

  const submitForm = async (formData: FormData) => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/brain/sources", { method: "POST", body: formData });
      const payload = (await res.json()) as { error?: string; extractedCount?: number };
      if (!res.ok) throw new Error(payload.error || "Failed to ingest source.");
      setNotice(`Source saved. ${payload.extractedCount ?? 0} candidate(s) created.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ingest source.");
    } finally {
      setSubmitting(false);
    }
  };

  const uploadSource = async () => {
    if (!uploadFile) {
      setError("Choose a file first.");
      return;
    }
    const formData = new FormData();
    formData.set("title", uploadTitle || uploadFile.name);
    formData.set("sourceType", uploadType);
    formData.set("file", uploadFile);
    formData.set("autoExtract", "true");
    await submitForm(formData);
  };

  const pasteSource = async () => {
    const formData = new FormData();
    formData.set("title", pasteTitle);
    formData.set("sourceType", pasteType);
    formData.set("text", pasteText);
    formData.set("autoExtract", "true");
    await submitForm(formData);
  };

  const updateDraft = (candidate: ApiCandidate, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [candidate.id]: {
        title: current[candidate.id]?.title ?? candidate.title,
        body: current[candidate.id]?.body ?? candidate.body,
        section: current[candidate.id]?.section ?? candidate.section,
        ...patch,
      },
    }));
  };

  const reviewCandidate = async (
    candidate: ApiCandidate,
    action: ReviewAction,
  ) => {
    if (reviewingCandidates[candidate.id]) return;

    setReviewingCandidates((current) => ({ ...current, [candidate.id]: action }));
    setError(null);
    setNotice(null);
    try {
      const draft = drafts[candidate.id] ?? {
        title: candidate.title,
        body: candidate.body,
        section: candidate.section,
      };
      const res = await fetch(`/api/brain/candidates/${candidate.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...draft }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Failed to review candidate.");
      setNotice(action === "approve" ? "Candidate approved into the brain." : "Candidate reviewed.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review candidate.");
    } finally {
      setReviewingCandidates((current) => {
        const next = { ...current };
        delete next[candidate.id];
        return next;
      });
    }
  };

  return (
    <main className="flex min-w-0 flex-col gap-6 overflow-x-hidden p-4 md:p-6 bg-muted/10">
      <div className="flex items-center gap-3 border-b border-accent/25 pb-4">
        <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500">
          <UploadCloud className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ingestion Hub</h1>
          <p className="text-sm text-muted-foreground">
            Ingest sources, extract operational knowledge candidates, and approve them into the brain.
          </p>
        </div>
      </div>

      <SafetyStatus />
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => {
          const Icon = [FileText, AlertCircle, CheckCircle2, Cloud][i];
          const colorClass = [
            "text-blue-500 bg-blue-500/10",
            "text-amber-500 bg-amber-500/10",
            "text-emerald-500 bg-emerald-500/10",
            "text-indigo-500 bg-indigo-500/10"
          ][i];
          return (
            <Card className="min-w-0 overflow-hidden border-accent/30 bg-card/60 transition-all hover:shadow-md" key={stat.label}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</span>
                  <strong className="block text-2xl font-bold tracking-tight">{stat.value}</strong>
                </div>
                <div className={`rounded-lg p-2.5 ${colorClass}`}>
                  <Icon className="size-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid items-start gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        <Card className="min-w-0 border-accent/30 bg-card/45 shadow-sm transition-all hover:shadow-md" data-tutorial="ingestion-upload">
          <CardHeader className="flex flex-row items-center gap-3 border-b border-accent/25 pb-4">
            <div className="rounded-md bg-blue-500/10 p-2.5 text-blue-500">
              <FolderOpen className="size-4" />
            </div>
            <div className="space-y-0.5">
              <CardTitle className="text-base">Upload file</CardTitle>
              <CardDescription className="text-xs">Photos, receipts, PDFs, CSVs, and eml files.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4">
            <Input aria-label="Upload source title" placeholder="Title" value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} />
            <select aria-label="Upload source type" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={uploadType} onChange={(event) => setUploadType(event.target.value)}>
              {SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Input aria-label="Upload source file" type="file" accept=".txt,.md,.markdown,.csv,.eml,.pdf,image/*" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} className="w-full text-xs sm:text-sm cursor-pointer file:cursor-pointer" />
            <Button className="w-full sm:w-auto font-medium" disabled={submitting} onClick={uploadSource}>
              {submitting ? (
                <span className="flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" />Uploading...</span>
              ) : (
                "Upload and Scan"
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-accent/30 bg-card/45 shadow-sm transition-all hover:shadow-md" data-tutorial="ingestion-source-upload">
          <CardHeader className="flex flex-row items-center gap-3 border-b border-accent/25 pb-4">
            <div className="rounded-md bg-indigo-500/10 p-2.5 text-indigo-500">
              <Clipboard className="size-4" />
            </div>
            <div className="space-y-0.5">
              <CardTitle className="text-base">Paste text</CardTitle>
              <CardDescription className="text-xs">Email threads, notes, and rules snippets.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4">
            <Input aria-label="Pasted source title" value={pasteTitle} onChange={(event) => setPasteTitle(event.target.value)} />
            <select aria-label="Pasted source type" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={pasteType} onChange={(event) => setPasteType(event.target.value)}>
              {SOURCE_TYPES.filter(([value]) => ["TEXT", "MARKDOWN", "CSV", "EMAIL_EXPORT", "OTHER"].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Textarea aria-label="Pasted source text" className="min-h-56 w-full leading-6" value={pasteText} onChange={(event) => setPasteText(event.target.value)} />
            <Button className="w-full sm:w-auto font-medium" disabled={submitting} onClick={pasteSource}>
              {submitting ? (
                <span className="flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" />Saving...</span>
              ) : (
                "Save and Scan"
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-accent/30 bg-card/45 shadow-sm md:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center gap-3 border-b border-accent/25 pb-4">
            <div className="rounded-md bg-amber-500/10 p-2.5 text-amber-500">
              <Sparkles className="size-4" />
            </div>
            <div className="space-y-0.5">
              <CardTitle className="text-base">Candidate Review</CardTitle>
              <CardDescription className="text-xs">{pendingCandidates.length} pending brain entries.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid max-h-[65vh] gap-4 overflow-y-auto overscroll-contain pr-1 pt-4 md:max-h-[72vh] md:pr-2" data-tutorial="ingestion-candidates">
            {pendingCandidates.map((candidate) => {
              const draft = drafts[candidate.id] ?? {
                title: candidate.title,
                body: candidate.body,
                section: candidate.section,
              };
              const reviewAction = reviewingCandidates[candidate.id];
              const isClarification = candidate.status === "NEEDS_CLARIFICATION";
              const borderClass = isClarification 
                ? "border-l-4 border-l-amber-500 bg-amber-500/5" 
                : "border-l-4 border-l-blue-500 bg-blue-500/5";
              const badgeClass = isClarification 
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20" 
                : "bg-blue-500/10 text-blue-600 border-blue-500/20 hover:bg-blue-500/20";
              return (
                <article className={`min-w-0 rounded-lg border p-4 shadow-sm transition-all ${borderClass}`} key={candidate.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/15 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className={badgeClass}>{candidate.kindLabel}</Badge>
                      <span className="text-xs font-semibold text-muted-foreground">{Math.round(candidate.confidence * 100)}% confidence</span>
                    </div>
                    <Badge variant="outline" className="text-xs bg-background/50">{candidate.statusLabel}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2.5">
                    <Input aria-label={`Candidate title for ${candidate.kindLabel}`} value={draft.title} onChange={(event) => updateDraft(candidate, { title: event.target.value })} />
                    <select aria-label={`Candidate section for ${candidate.kindLabel}`} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={draft.section} onChange={(event) => updateDraft(candidate, { section: event.target.value })}>
                      {SECTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <Textarea aria-label={`Candidate body for ${candidate.kindLabel}`} className="min-h-24 leading-6" value={draft.body} onChange={(event) => updateDraft(candidate, { body: event.target.value })} />
                    <div className="min-w-0 rounded-md border border-accent/20 bg-muted/65 p-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5 font-medium text-foreground mb-1.5">
                        <Info className="size-3.5" />
                        <span>Evidence</span>
                      </div>
                      {candidate.provenance.map((item) => (
                        <p className="mt-1 break-words bg-background/30 rounded p-1.5 border border-accent/10 leading-4" key={`${candidate.id}-${item.sourceId}-${item.evidence}`}>{item.sourceTitle}{item.locator ? `, ${item.locator}` : ""}: {item.evidence}</p>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3.5 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                    <Button className="w-full sm:w-auto font-medium" disabled={Boolean(reviewAction)} size="sm" onClick={() => reviewCandidate(candidate, "approve")}>
                      {reviewAction === "approve" ? "Approving..." : "Approve"}
                    </Button>
                    <Button className="w-full sm:w-auto font-medium" disabled={Boolean(reviewAction)} size="sm" variant="secondary" onClick={() => reviewCandidate(candidate, "reject")}>
                      {reviewAction === "reject" ? "Rejecting..." : "Reject"}
                    </Button>
                    <Button className="w-full sm:w-auto font-medium" disabled={Boolean(reviewAction)} size="sm" variant="ghost" onClick={() => reviewCandidate(candidate, "clarify")}>
                      {reviewAction === "clarify" ? "Saving..." : "Needs Clarification"}
                    </Button>
                  </div>
                </article>
              );
            })}
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {!loading && pendingCandidates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
                <Database className="size-8 opacity-30 mb-2" />
                <span>No pending candidates.</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
