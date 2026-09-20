// ============================================================================
// API layer — typed wrapper around the FastAPI backend.
//
// Every request carries the HttpOnly session cookie (credentials: "include").
// Non-2xx responses become { ok: false, error } so callers never repeat
// try/catch.
// ============================================================================

export interface AiDetection {
  ran: boolean;
  ai_suspected: boolean;
  ai_score: number;
  model: string | null;
  provider: string | null;
  explanation: string;
  latency_ms: number;
}

export interface Me {
  status: string;
  admin: string;
  name: string;
  designation: string | null;
  institution: string | null;
  pending_approval: boolean;
  is_super_admin: boolean;
}

// ----------------------------------------------------------------------------
// Fetch wrapper
// ----------------------------------------------------------------------------

export type ApiResult<T> = { ok: true; data: T; response: Response } | { ok: false; error: string };

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { ...init, credentials: "include" });
    if (response.status === 429) throw new Error("Rate limit exceeded. Please wait.");

    let data: unknown = null;
    if ((response.headers.get("content-type") || "").includes("application/json")) {
      data = await response.json();
    }
    if (!response.ok) {
      throw new Error((data as { detail?: string } | null)?.detail || `Error ${response.status}`);
    }
    return { ok: true, data: data as T, response };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

function form(fields: Record<string, string | Blob | File | undefined | null>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value != null) fd.append(key, value);
  }
  return fd;
}

// ----------------------------------------------------------------------------
// Auth endpoints
// ----------------------------------------------------------------------------

export function getMe() {
  return request<Me>("/api/admin/me");
}

export function googleLogin(credential: string) {
  return request<{ status: string }>("/api/admin/login", {
    method: "POST",
    body: form({ credential }),
  });
}

export function logout() {
  return request<{ status: string }>("/api/admin/logout", { method: "POST" });
}

export function assignRole(targetEmail: string, designation: string, institution: string) {
  return request<{ status: string }>("/api/admin/assign_role", {
    method: "POST",
    body: form({ target_email: targetEmail, designation, institution }),
  });
}

/** Officer directory row for super-admin role approvals (no keys/ledger data). */
export interface OfficerEntry {
  email: string;
  name: string;
  designation: string | null;
  institution: string | null;
  registered_at: string;
}

export function getSigners() {
  return request<{ signers: OfficerEntry[] }>("/api/admin/signers");
}

// ----------------------------------------------------------------------------
// MHA screening desk (SIH26188 — AI-Based Fake Identity & Document Screening)
//
// Module contract (1:1 with the problem statement):
//   M1 extraction  OCR/MRZ/declared field extraction
//   M2 validation  format/MRZ/expiry + watchlist
//   M3 tampering   ELA/spectral/noise/metadata + AI-generation cues
//   M4 face        document portrait vs live holder capture
// ----------------------------------------------------------------------------

export type ScreenVerdict = "CLEAR" | "REVIEW" | "FLAGGED";

export interface ScreenCheck {
  label: string;
  ok: boolean | null;
  detail: string;
}

export interface ScreenMrz {
  format?: string;
  valid?: boolean;
  document_ck?: boolean | null;
  dob_ck?: boolean | null;
  expiry_ck?: boolean | null;
  composite_ck?: boolean | null;
  passport?: string;
}

export interface ScreenModuleExtraction {
  medium: "pdf" | "image" | "unknown";
  mrz?: ScreenMrz | null;
  ocr?: { ran: boolean; reason?: string };
  document_aware?: boolean | null;
}

export interface ScreenModuleValidation {
  verdict: string;
  checks: ScreenCheck[];
}

export interface ScreenSpectralAnalysis {
  papr?: number;
  high_freq_ratio?: number;
  spectral_anomaly?: boolean;
  status?: string;
  detail?: string;
}

export interface ScreenNoiseConsistency {
  portrait_noise_var?: number;
  substrate_noise_var?: number;
  noise_ratio?: number;
  consistent?: boolean;
  status?: string;
  detail?: string;
}

export interface ScreenImageQA {
  width?: number;
  height?: number;
  megapixels?: number;
  blur_est?: number;
  blurry?: boolean;
  dark_frac?: number;
  bright_frac?: number;
  overexposed?: boolean;
  underexposed?: boolean;
}

export interface ScreenModuleTampering {
  verdict: string;
  checks: ScreenCheck[];
  ela?: {
    status?: string;
    damage_ratio?: number;
    mean_diff?: number;
    latency_ms?: number;
  } | null;
  spectral?: ScreenSpectralAnalysis | null;
  noise_consistency?: ScreenNoiseConsistency | null;
  qa?: ScreenImageQA | null;
  heatmap_b64?: string | null;
  overlay_grid?: number[][] | null;
  roi?: ForensicsROI[];
  liveness?: Array<{ signal?: string; level?: string; note?: string }>;
}

export interface ScreenModuleFace {
  verdict: string;
  match: boolean | null;
  score: number;
  method: string;
  detail: string;
  checks: ScreenCheck[];
}

export interface ForensicsROI {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export interface ScreenModules {
  extraction: ScreenModuleExtraction;
  validation: ScreenModuleValidation;
  tampering: ScreenModuleTampering;
  face: ScreenModuleFace;
}

export interface ScreenReport {
  id: string;
  filename: string;
  doc_type: string;
  checkpoint: string;
  verdict: ScreenVerdict;
  risk_score: number;
  confidence: number;
  ledger_status: string;
  previous_hash?: string | null;
  ledger_hash?: string | null;
  screener?: string | null;
  created_at: string;
  adjudication?: string | null;
  adjudicator?: string | null;
  adjudication_note?: string | null;
  adjudicated_at?: string | null;
  masked_fields: Record<string, string | boolean | null>;
  signals?: string[];
  ai_detection?: AiDetection | null;
  file_hash?: string;
  watchlist_hits?: { field: string; mask: string }[];
  reasons?: string[];
  latency_ms?: number;
  declared_count?: number;
  modules?: ScreenModules;
  travel_validity?: ScreenTravelValidity | null;
  syndicate_alerts?: Array<{
    level: string;
    type: string;
    title: string;
    detail: string;
    checkpoint: string;
  }>;
}

export interface ScreenQueue {
  pending: ScreenReport[];
  recent: ScreenReport[];
}

export interface WatchlistEntry {
  id: number;
  category: string | null;
  mask: string | null;
  reason: string | null;
  added_by: string;
  created_at: string;
}

export const SCREEN_DOC_TYPES = [
  "pan",
  "passport",
  "visa",
  "driving_licence",
  "voter_id",
  "other",
] as const;

export type ScreenDocType = (typeof SCREEN_DOC_TYPES)[number];

/**
 * Backend-aligned document labels. These are the document families the
 * screening pipeline can extract and validate end to end. Aadhaar is
 * intentionally absent: the backend no longer accepts it.
 */
export const SCREEN_DOC_LABELS: Record<ScreenDocType, string> = {
  pan: "PAN",
  passport: "PASSPORT",
  visa: "VISA",
  driving_licence: "DRIVING LICENCE",
  voter_id: "VOTER ID",
  other: "OTHER",
};

export const SCREEN_DOC_NUMBER_PLACEHOLDERS: Record<ScreenDocType, string> = {
  pan: "e.g. ABCDP2234A",
  passport: "e.g. K1234567",
  visa: "e.g. V1234567",
  driving_licence: "e.g. KA0120201234567",
  voter_id: "e.g. ABC1234567",
  other: "Number printed on the document",
};

/**
 * Watchlist categories are the identifier families the backend actually
 * hashes and compares during screening. The category is metadata; matching
 * is always by SHA-256 digest.
 */
export const SCREEN_WATCHLIST_CATEGORIES = [
  "pan",
  "passport",
  "visa",
  "driving_licence",
  "voter_id",
  "phone",
] as const;

export type ScreenWatchlistCategory =
  (typeof SCREEN_WATCHLIST_CATEGORIES)[number];

export const SCREEN_WATCHLIST_LABELS: Record<ScreenWatchlistCategory, string> = {
  pan: "PAN",
  passport: "PASSPORT",
  visa: "VISA",
  driving_licence: "DRIVING LICENCE",
  voter_id: "VOTER ID",
  phone: "PHONE",
};

export const SCREEN_WATCHLIST_PLACEHOLDERS: Record<
  ScreenWatchlistCategory,
  string
> = {
  pan: "e.g. ABCDP2234A",
  passport: "e.g. K1234567",
  visa: "e.g. V1234567",
  driving_licence: "e.g. KA0120201234567",
  voter_id: "e.g. ABC1234567",
  phone: "e.g. 9876543210",
};

export interface ScreenTravelValidity {
  days_to_expiry: number | null;
  six_month_rule: boolean | null;
  age_at_crossing: number | null;
  status: "VALID" | "EXPIRING_SOON" | "EXPIRED" | "UNKNOWN";
  detail: string;
}

/** Run a screening pass on an uploaded identity document (officer only). */
export function screenDocument(
  file: File,
  docType: string,
  checkpoint: string,
  declared?: Record<string, string>,
  liveFrame?: Blob | null,
) {
  const fd = form({ doc_type: docType, checkpoint });
  fd.append("file", file, file.name);
  if (declared && Object.keys(declared).length > 0) {
    fd.append("declared", JSON.stringify(declared));
  }
  if (liveFrame) fd.append("live_frame", liveFrame, "holder_live.jpg");
  return request<ScreenReport>("/api/screen", { method: "POST", body: fd });
}

export function getScreenQueue() {
  return request<ScreenQueue>("/api/screen/queue");
}

export function getScreenReport(reportId: string) {
  return request<ScreenReport>(
    `/api/screen/reports/${encodeURIComponent(reportId)}`,
  );
}

export function adjudicateScreen(reportId: string, decision: string, note?: string) {
  return request<{ ok: boolean }>(
    `/api/screen/reports/${encodeURIComponent(reportId)}/adjudicate`,
    { method: "POST", body: form({ decision, note: note || "" }) },
  );
}

export function getWatchlist() {
  return request<{ entries: WatchlistEntry[] }>("/api/screen/watchlist");
}

export function addWatchlistEntry(category: string, value: string, reason?: string) {
  return request<{ ok: boolean; id?: number; mask?: string; already?: boolean }>(
    "/api/screen/watchlist/add",
    { method: "POST", body: form({ category, value, reason: reason || "" }) },
  );
}

export function removeWatchlistEntry(entryId: number) {
  return request<{ ok: boolean }>("/api/screen/watchlist/remove", {
    method: "POST",
    body: form({ entry_id: String(entryId) }),
  });
}

export function getSyndicateAlerts(checkpoint?: string) {
  const url = checkpoint ? `/api/screen/syndicate-alerts?checkpoint=${encodeURIComponent(checkpoint)}` : "/api/screen/syndicate-alerts";
  return request<{
    checkpoint_filter: string;
    total_screened_sample: number;
    alerts: Array<{
      level: string;
      type: string;
      title: string;
      detail: string;
      checkpoint: string;
    }>;
    active_alerts_count: number;
  }>(url);
}

export function getDossierUrl(reportId: string, autoPrint: boolean = false): string {
  return `/api/screen/dossier/${encodeURIComponent(reportId)}${autoPrint ? "?print=true" : ""}`;
}

export interface LedgerVerificationResult {
  valid: boolean;
  total_blocks: number;
  head_hash: string | null;
  genesis_hash: string;
  broken_at?: string | null;
  reason?: string | null;
  status: string;
}

export function verifyLedgerChain() {
  return request<LedgerVerificationResult>("/api/screen/ledger/verify");
}

export interface AadhaarFieldBox {
  label: string;
  class_id?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export function getAadhaarFields(file: File) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return request<{
    ok: boolean;
    count: number;
    fields: AadhaarFieldBox[];
    model: string;
  }>("/api/screen/aadhaar-fields", {
    method: "POST",
    body: fd,
  });
}

export interface LivenessResult {
  verdict: "LIVE" | "SUSPECT" | "SPOOF";
  liveness_passed: boolean;
  confidence: number;
  challenge: string;
  checks: ScreenCheck[];
  signals: string[];
  motion_score?: number;
  latency_ms?: number;
}

export function verifyLiveness(frames: Blob[], challenge: string = "blink", meta: Record<string, unknown> = {}) {
  const fd = new FormData();
  frames.forEach((f, idx) => {
    fd.append("frames", f, `frame_${idx}.jpg`);
  });
  fd.append("challenge", challenge);
  fd.append("client_meta", JSON.stringify(meta));
  return request<LivenessResult>("/api/screen/liveness", {
    method: "POST",
    body: fd,
  });
}