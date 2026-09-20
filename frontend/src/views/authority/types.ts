// ============================================================================
// types.ts — Shared Types, Enums, and Helpers for Authority Console (SIH26188)
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// ============================================================================

import {
  SCREEN_DOC_LABELS,
  SCREEN_WATCHLIST_LABELS,
  type ScreenDocType,
  type ScreenWatchlistCategory,
  type ScreenReport,
  type ScreenQueue,
  type WatchlistEntry,
  type OfficerEntry,
  type LedgerAnchorStatus,
  type LedgerVerifyResult,
} from "../../api";

export type AuthorityTab =
  | "desk"
  | "queue"
  | "syndicate"
  | "watchlist"
  | "ledger"
  | "admin"
  | "notices";

export const VERDICT_META: Record<string, { pill: "seal" | "amber" | "danger" }> = {
  CLEAR: { pill: "seal" },
  REVIEW: { pill: "amber" },
  FLAGGED: { pill: "danger" },
};

export const MODULE_VERDICT_TONE: Record<string, "seal" | "amber" | "danger" | "slate"> = {
  PASS: "seal",
  CLEAR: "seal",
  REVIEW: "amber",
  FAIL: "danger",
  UNVERIFIED: "slate",
};

export const CHALLENGES: { id: string; prompt: string; icon: string; hint: string }[] = [
  { id: "blink", prompt: "Ask subject to BLINK BOTH EYES", icon: "👁️", hint: "Subject blinks naturally within 2 seconds" },
  { id: "nod", prompt: "Ask subject to NOD HEAD SLOWLY", icon: "↕️", hint: "Subject tilts head down, then returns up" },
  { id: "turn_left", prompt: "Ask subject to TURN HEAD SLIGHTLY LEFT", icon: "↩️", hint: "Subject rotates head 15–25° to their left" },
  { id: "turn_right", prompt: "Ask subject to TURN HEAD SLIGHTLY RIGHT", icon: "↪️", hint: "Subject rotates head 15–25° to their right" },
];

export interface LivenessStatusPayload {
  verified: boolean;
  verdict: string | null;
  confidence: number | null;
}

export const MASKED_FIELD_LABELS: Record<string, string> = {
  name: "FULL NAME",
  doc_number: "DOCUMENT NUMBER",
  dob: "DATE OF BIRTH",
  expiry_date: "DATE OF EXPIRY",
  nationality: "NATIONALITY",
  gender: "GENDER",
  pan_number: "PAN NUMBER",
  dl_number: "DRIVING LICENSE NO",
  voter_id: "EPIC / VOTER ID",
  aadhaar_number: "AADHAAR NUMBER",
  visa_number: "VISA NUMBER",
  entry_validation: "ENTRY VALIDATION",
};

export function formatMaskedFieldValue(value: string | boolean | null | undefined): string {
  if (typeof value === "boolean") return value ? "YES" : "NO";
  if (!value) return "NOT DETECTED";
  return String(value);
}

export function formatScreenDocType(docType: string): string {
  if (docType in SCREEN_DOC_LABELS) {
    return SCREEN_DOC_LABELS[docType as ScreenDocType];
  }
  return docType.replace(/_/g, " ").toUpperCase();
}

export function formatWatchlistCategory(category: string | null): string {
  if (!category) return "GENERIC";
  if (category in SCREEN_WATCHLIST_LABELS) {
    return SCREEN_WATCHLIST_LABELS[category as ScreenWatchlistCategory];
  }
  return category.replace(/_/g, " ").toUpperCase();
}

export interface ModuleCheckRow {
  label: string;
  ok: boolean | null;
  detail: string;
}

export {
  type ScreenReport,
  type ScreenQueue,
  type WatchlistEntry,
  type OfficerEntry,
  type LedgerAnchorStatus,
  type LedgerVerifyResult,
};
