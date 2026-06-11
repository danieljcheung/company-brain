export type ApiSource = {
  id: string;
  title: string;
  sourceType: string;
  sourceTypeLabel: string;
  importedAt: string;
  contentHash: string;
  storageRef: string | null;
  metadata: Record<string, unknown>;
  rawText: string;
  extractedText: string | null;
  candidateCount: number;
  approvedRecordCount: number;
};

export type ApiCandidate = {
  id: string;
  kind: string;
  kindLabel: string;
  section: string;
  sectionLabel: string;
  title: string;
  body: string;
  confidence: number;
  status: string;
  statusLabel: string;
  extractedBy: string;
  createdAt: string;
  reviewedAt: string | null;
  provenance: Array<{
    sourceId: string;
    sourceTitle: string;
    sourceType: string;
    sourceTypeLabel: string;
    importedAt: string;
    contentHash: string;
    locator: string | null;
    evidence: string;
  }>;
};

export type ApiRecord = {
  id: string;
  section: string;
  sectionLabel: string;
  title: string;
  body: string;
  structuredData: Record<string, unknown>;
  reviewer: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  supersedesId: string | null;
  questions: Array<{
    id: string;
    title: string;
    body: string;
    status: string;
    answer: string | null;
    answeredAt: string | null;
    updatedAt: string;
  }>;
  timeline: Array<{
    id: string;
    action: string;
    actor: string;
    note: string | null;
    createdAt: string;
  }>;
  provenance: ApiCandidate["provenance"];
};
