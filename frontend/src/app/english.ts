// ---------------------------------------------------------------------------
// english.ts — plain-language vocabulary for the whole console.
//
// The desk is operated under time pressure; every label here exists so an
// officer (or any reader) understands what a thing IS before they have to
// know what it is CALLED. Technical wording is kept as a small secondary
// note where it matters for audit — never as the primary label.
// ---------------------------------------------------------------------------

export type ModuleKey = "extraction" | "validation" | "tampering" | "face";

export interface ModulePlain {
  /** Short chip-level name. */
  short: string;
  /** Heading-level name. */
  name: string;
  /** One-sentence "what does this check actually do". */
  what: string;
}

export const MODULE_PLAIN: Record<ModuleKey, ModulePlain> = {
  extraction: {
    short: "Document read",
    name: "Read the document",
    what: "The system reads the printed details: text, document number and the machine-readable line.",
  },
  validation: {
    short: "Genuine check",
    name: "Check the document is genuine",
    what: "Checks the format, checksums and the known-fraud list (watchlist).",
  },
  tampering: {
    short: "Tamper scan",
    name: "Scan for edits or copies",
    what: "Looks for signs the image was edited, cropped or copied from another source.",
  },
  face: {
    short: "Face check",
    name: "Compare the face",
    what: "Compares the photo on the document with the person's live camera frame.",
  },
};

export const MODULE_ORDER: ModuleKey[] = ["extraction", "validation", "tampering", "face"];

/** Plain, human outcome for raw verdict strings across reports, docs, sessions. */
export const VERDICT_PLAIN: Record<string, string> = {
  CLEAR: "Looks genuine",
  REVIEW: "Needs a closer look",
  FLAGGED: "Possible fraud",
  PASS: "Passed",
  WARN: "Needs attention",
  UNVERIFIED: "Couldn't be checked",
  PENDING: "Awaiting decision",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  OPEN: "Open",
  CLEARED: "Approved after review",
  CONFIRMED_FRAUD: "Fraud confirmed",
  INCONCLUSIVE: "Couldn't be settled",
};

export function plainVerdict(v?: string | null): string {
  if (!v) return "—";
  return VERDICT_PLAIN[v.toUpperCase()] || v;
}

export function verdictTone(v?: string | null): "ok" | "bad" | "warn" | "mute" {
  const up = (v || "").toUpperCase();
  if (up === "CLEAR" || up === "PASS" || up === "APPROVED" || up === "CLEARED") return "ok";
  if (up === "FLAGGED" || up === "CONFIRMED_FRAUD" || up === "REJECTED") return "bad";
  if (up === "REVIEW" || up === "WARN" || up === "INCONCLUSIVE") return "warn";
  return "mute";
}

/** One-word human risk band (plain) for a 0-100 risk score. */
export function riskWord(score?: number | null): string {
  if (score == null) return "No risk score";
  if (score <= 25) return "Low risk";
  if (score <= 55) return "Medium risk";
  return "High risk";
}

/** Plain labels for cross-document comparison statuses. */
export const COMPARE_PLAIN: Record<string, string> = {
  agree: "Matches",
  disagree: "Does not match",
  "phonetic-match": "Sounds the same",
  "cross-script": "Reads the same in another script",
  unverified: "Couldn't compare",
  CONSISTENT: "Yes — consistent",
  DISCREPANCY: "No — details clash",
};

export function plainCompare(status?: string | null): string {
  if (!status) return "—";
  return COMPARE_PLAIN[status.toLowerCase()] || status;
}

export function compareTone(status?: string | null): string {
  const s = (status || "").toLowerCase();
  if (s === "agree" || s === "bs-ad-harmonized") return "ok";
  if (s === "disagree") return "bad";
  if (s === "phonetic-match" || s === "cross-script") return "info";
  return "mute";
}

/** The desk's silent step-guide. Shown as a thin progress rail. */
export const DESK_STEPS = [
  { id: "open", label: "Open a session", note: "one traveller at a time" },
  { id: "scan", label: "Scan documents", note: "one document at a time" },
  { id: "compare", label: "Compare", note: "do all details agree?" },
  { id: "decide", label: "Decide", note: "approve or send for review" },
] as const;

export type DeskStepId = (typeof DESK_STEPS)[number]["id"];

/** Where the officer currently is, for the step-guide. */
export function deskStep(
  active: boolean,
  docCount: number,
  closed: boolean,
): { id: DeskStepId; index: number } {
  if (!active) return { id: "open", index: 0 };
  if (closed) return { id: "decide", index: 3 };
  if (docCount === 0) return { id: "scan", index: 1 };
  if (docCount === 1) return { id: "compare", index: 2 };
  return { id: "decide", index: 3 };
}

/** Short plain name for session statuses. */
export const SESSION_STATUS_PLAIN: Record<string, string> = {
  open: "Open",
  approved: "Approved",
  flagged: "Sent for review",
  rejected: "Rejected",
  settled: "Settled",
};

export function plainStatus(s?: string | null): string {
  if (!s) return "—";
  return SESSION_STATUS_PLAIN[s.toLowerCase()] || s;
}