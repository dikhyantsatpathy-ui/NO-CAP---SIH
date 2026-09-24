// ---------------------------------------------------------------------------
// english.ts — plain-language vocabulary for the whole console.
//
// The desk is operated under time pressure; every label here exists so an
// officer (or any reader) understands what a thing IS before they have to
// know what it is CALLED. Technical jargon is replaced with self-explanatory,
// crystal-clear layman terms.
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
    short: "1. Text & Codes",
    name: "Read Document Text & Codes",
    what: "Reads printed details, document number, and machine-readable lines (MRZ).",
  },
  validation: {
    short: "2. Validity & Watchlist",
    name: "Check Rules & Watchlist",
    what: "Verifies official mathematical checksums, valid expiration dates, and checks fraud lists.",
  },
  tampering: {
    short: "3. Photo Tamper Scan",
    name: "Scan for Edits & Forgery",
    what: "Checks if the photo was replaced, digitally edited, or re-printed from a photocopy.",
  },
  face: {
    short: "4. Portrait Photo ID",
    name: "Holder Portrait & Photo Quality",
    what: "Detects the holder's face photo on the document, checking image clarity, biometric quality, and facial landmarks.",
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
  agree: "Matches perfectly",
  disagree: "Does not match",
  "phonetic-match": "Same name (spelling variation)",
  "cross-script": "Same name in another script",
  unverified: "Couldn't compare",
  CONSISTENT: "Consistent — All details match",
  DISCREPANCY: "Discrepancy — Details clash",
};

export function plainCompare(status?: string | null): string {
  if (!status) return "—";
  return COMPARE_PLAIN[status.toLowerCase()] || status;
}

export function compareTone(status?: string | null): string {
  const s = (status || "").toLowerCase();
  if (s === "agree" || s === "bs-ad-harmonized" || s === "consistent") return "ok";
  if (s === "disagree" || s === "discrepancy") return "bad";
  if (s === "phonetic-match" || s === "cross-script") return "info";
  return "mute";
}

/** The desk's silent step-guide. Shown as a clean progress rail. */
export const DESK_STEPS = [
  { id: "open", label: "1. Open Session", note: "Traveller arrival" },
  { id: "scan", label: "2. Scan Document", note: "Passport, ID or Visa" },
  { id: "compare", label: "3. Auto-Checks", note: "Tamper & face scan" },
  { id: "decide", label: "4. Decision", note: "Approve or flag" },
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
  open: "In Progress",
  approved: "Approved & Signed",
  flagged: "Sent to Review Queue",
  rejected: "Rejected (Evidence)",
  settled: "Settled by Supervisor",
};

export function plainStatus(s?: string | null): string {
  if (!s) return "—";
  return SESSION_STATUS_PLAIN[s.toLowerCase()] || s;
}

/** Contextual guidance cue for the officer at the current step. */
export function stepGuidance(
  active: boolean,
  docCount: number,
  status?: string,
): { title: string; hint: string } {
  if (!active) {
    return {
      title: "Ready for traveller",
      hint: "Click 'Open new session' to begin screening the next traveller.",
    };
  }
  if (status === "approved") {
    return {
      title: "Session Approved & Signed",
      hint: "All identity checks passed. Signed into the tamper-proof ledger. Click 'Start Next Traveller' below.",
    };
  }
  if (status === "flagged") {
    return {
      title: "Session Sent to Review Queue",
      hint: "Discrepancy recorded and forwarded to supervisor queue for adjudication. Click 'Start Next Traveller' below.",
    };
  }
  if (status === "rejected") {
    return {
      title: "Session Rejected",
      hint: "Fraud confirmed and permanently recorded as evidence. Click 'Start Next Traveller' below.",
    };
  }
  if (docCount === 0) {
    return {
      title: "Step 1: Scan the traveller's primary document",
      hint: "Upload a document image or capture with webcam. The system will automatically read details, check for tampering, and verify validity.",
    };
  }
  if (docCount === 1) {
    return {
      title: "Step 2: Document 1 checked",
      hint: "You can scan an additional document (e.g. Visa, Citizenship, or Aadhaar) to cross-check details, or proceed to approve.",
    };
  }
  return {
    title: "Step 3: Review cross-document check",
    hint: "Verify that names, dates of birth, and identity numbers match across all presented documents before signing.",
  };
}