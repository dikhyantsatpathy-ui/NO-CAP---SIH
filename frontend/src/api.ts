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

export function demoLogin() {
  return request<{ status: string }>("/api/admin/demo_login", {
    method: "POST",
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
  screener?: string | null;
  created_at: string;
  adjudication?: string | null;
  adjudicator?: string | null;
  adjudication_note?: string | null;
  adjudicated_at?: string | null;
  masked_fields: Record<string, string | boolean | null>;
  field_hashes?: Record<string, { h: string; s: string }> | null;
  session_id?: string | null;
  signals?: string[];
  ai_detection?: AiDetection | null;
  file_hash?: string;
  block_hash?: string | null;
  prev_hash?: string | null;
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
  "aadhaar",
  "nepali_citizenship",
  "other",
] as const;

export type ScreenDocType = (typeof SCREEN_DOC_TYPES)[number];

/**
 * Backend-aligned document labels. These are the document families the
 * screening pipeline can extract and validate end to end.
 */
export const SCREEN_DOC_LABELS: Record<ScreenDocType, string> = {
  pan: "PAN",
  passport: "PASSPORT",
  visa: "VISA",
  driving_licence: "DRIVING LICENCE",
  voter_id: "VOTER ID",
  aadhaar: "AADHAAR",
  nepali_citizenship: "NEPALI NAGARIKTA",
  other: "OTHER",
};

export const SCREEN_DOC_NUMBER_PLACEHOLDERS: Record<ScreenDocType, string> = {
  pan: "e.g. ABCDP2234A",
  passport: "e.g. K1234567",
  visa: "e.g. V1234567",
  driving_licence: "e.g. KA0120201234567",
  voter_id: "e.g. ABC1234567",
  aadhaar: "12-digit UID (e.g. 5489 2104 9931)",
  nepali_citizenship: "Cert No (e.g. 12-01-75-03421)",
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

/** Run a screening pass on an uploaded identity document (officer only).
 *  When sessionId is given (SIH26188 session flow) the resulting audit row is
 *  attached to that border session and its per-field digests are persisted for
 *  cross-document comparison. */
export function screenDocument(
  file: File,
  docType: string,
  checkpoint: string,
  declared?: Record<string, string>,
  liveFrame?: Blob | null,
  sessionId?: string,
) {
  const fd = form({ doc_type: docType, checkpoint });
  fd.append("file", file, file.name);
  if (declared && Object.keys(declared).length > 0) {
    fd.append("declared", JSON.stringify(declared));
  }
  if (liveFrame) fd.append("live_frame", liveFrame, "holder_live.jpg");
  if (sessionId) fd.append("session_id", sessionId);
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

export function getBsaCertificateUrl(sessionId: string): string {
  return `/api/screen/bsa65b/${encodeURIComponent(sessionId)}`;
}

export function getShiftHandoverToken(sessionId: string) {
  return request<{
    handover_id: string;
    session_id: string;
    timestamp: string;
    screener: string;
    verdict: string;
    risk_score: number;
    seal: string;
    qr_packet_string: string;
    qr_packet: Record<string, unknown>;
  }>(`/api/screen/handover/${encodeURIComponent(sessionId)}`);
}

export function getBorderThreatMatrix() {
  return request<{
    timestamp: string;
    overall_threat_level: string;
    national_border_threat_index: number;
    active_syndicates_flagged: number;
    checkpoints: Array<{
      id: string;
      name: string;
      state: string;
      threat_level: string;
      threat_score: number;
      primary_threat: string;
      active_alerts: number;
      status: string;
    }>;
  }>("/api/border/threat_matrix");
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

// ----------------------------------------------------------------------------
// Screening lookup & analytics — verified-digest surface for the screening
// desk. The lookup re-verifies a file/text/digest against past screening
// records; analytics aggregates verdict mix + latency. No raw bytes, no PII.
// ----------------------------------------------------------------------------

export type VerdictKind = "AUTHENTIC" | "PROVEN_FAKE" | "REVOKED" | "UNSIGNED";

/** Latest matching screening record for a digest (adjudication-aware verdict). */
export interface ScreeningLookup {
  verdict: VerdictKind;
  message: string;
  hash: string;
  filename: string;
  checkpoint: string;
  headline: string;
  guidance: string;
  reasons: string[];
  screening: {
    verdict: ScreenVerdict;
    risk_score: number;
    confidence: number;
    adjudication?: string | null;
    adjudicator?: string | null;
    adjudication_note?: string | null;
    adjudicated_at?: string | null;
    screener?: string | null;
    created_at: string;
  } | null;
  ai_detection?: AiDetection | null;
  ai_score?: number;
  ai_model?: string | null;
  ai_provider?: string | null;
  ai_explanation?: string;
  ai_suspected?: boolean;
}

export interface Broadcast {
  title: string;
  urgency: string;
  content: string;
  signer: string;
  institution: string;
  designation: string;
  timestamp: string;
  file_hash: string;
  signature: string;
  ipfs_cid: string;
  media_type: string;
  media_name: string;
  has_media: boolean;
  is_mine: boolean;
  can_delete: boolean;
}

export interface AnalyticsPayload {
  stats: Record<VerdictKind, number>;
  latency: { avg_ms: number; min_ms: number; max_ms: number; samples: number } | null;
  providers: Record<string, number>;
}

export interface DetectionUsage {
  provider: string;
  model: string;
  period_day: string;
  period_month: string;
  ops_used_today: number;
  ops_used_month: number;
  limit_today: number;
  limit_month: number;
  remaining_today: number;
  remaining_month: number;
}

export interface AnalyticsSummary {
  analytics: AnalyticsPayload;
  usage: DetectionUsage | null;
  cached: boolean;
}

/** Screening lookup: re-check a file against the latest matching screening pass. */
export function verifyFile(file: Blob, filename: string, clientHash?: string) {
  const fd = new FormData();
  fd.append("file", file, filename);
  if (clientHash) fd.append("client_hash", clientHash);
  return request<ScreeningLookup>("/api/verify", { method: "POST", body: fd });
}

/** Screening lookup: paste raw text, hashed client-side the same way. */
export function verifyText(rawText: string) {
  const fd = form({ raw_text: rawText });
  return request<ScreeningLookup>("/api/verify", { method: "POST", body: fd });
}

/** Screening lookup: re-check a digest with no uploaded content. */
export function verifyHash(hash: string) {
  const fd = form({ client_hash: hash });
  return request<ScreeningLookup>("/api/verify", { method: "POST", body: fd });
}

export function getBroadcasts(limit = 200) {
  return request<{ broadcasts: Broadcast[]; authed: boolean }>(`/api/broadcasts?limit=${limit}`);
}

export function deleteBroadcast(fileHash: string) {
  return request<{ status: string }>("/api/broadcasts/delete", {
    method: "POST",
    body: form({ file_hash: fileHash }),
  });
}

export function createBroadcast(title: string, urgency: string, message: string) {
  return request<{ ok: boolean; status: string; file_hash: string }>(
    "/api/broadcasts/create",
    { method: "POST", body: form({ broadcast_title: title, urgency_level: urgency, message }) },
  );
}

export function getAnalytics() {
  return request<AnalyticsPayload>("/api/analytics");
}

/** One round trip for the whole dashboard (tallies + latency + quota). */
export function getAnalyticsSummary() {
  return request<AnalyticsSummary>("/api/analytics/summary");
}

export interface LedgerAnchorStatus {
  anchored: boolean;
  status: string;
  in_sync: boolean;
  anchor_head_hash: string | null;
  current_db_head_hash: string | null;
  total_blocks: number;
  anchor_blocks: number;
  anchored_at: string | null;
  anchor_type: string | null;
  public_url: string | null;
  signature: string | null;
  manifest?: Record<string, unknown>;
}

export function getLedgerAnchor() {
  return request<LedgerAnchorStatus>("/api/screen/ledger/anchor");
}

export function triggerLedgerAnchor() {
  return request<{
    ok: boolean;
    status: string;
    head_hash: string;
    total_blocks: number;
    anchored_at: string;
    anchor_type: string;
    public_url: string;
    signature: string;
    manifest: Record<string, unknown>;
  }>("/api/screen/ledger/anchor", { method: "POST" });
}

export interface LedgerVerifyResult {
  valid: boolean;
  total_blocks: number;
  verified_blocks?: number;
  head_hash: string | null;
  genesis_hash: string;
  broken_at: string | null;
  reason?: string;
  status: string;
  anchor: {
    anchored: boolean;
    in_sync: boolean;
    anchor_head_hash?: string;
    anchor_type?: string;
    public_url?: string;
    anchored_at?: string;
    signature?: string;
    hint?: string;
  };
}

export function verifyLedgerChain() {
  return request<LedgerVerifyResult>("/api/screen/ledger/verify");
}

// ----------------------------------------------------------------------------
// Border screening SESSIONS (SIH26188) — one traveller per session.
// Documents are screened into a session one at a time, cross-compared for
// discrepancies, then approved (chained SHA-256 block into the ledger) or
// flagged for the supervisory review queue.
// ----------------------------------------------------------------------------

export type SessionStatus = "open" | "approved" | "flagged" | "rejected";
export type SessionVerdict = "PENDING" | "CLEAR" | "REVIEW" | "FLAGGED";

export type ComparisonStatus = "agree" | "disagree" | "cross-script" | "single" | "none";
export type ComparisonVerdict = "CONSISTENT" | "DISCREPANCY" | "INCOMPLETE";

export interface ComparisonCheck {
  field: string;
  label: string;
  status: ComparisonStatus;
  detail: string;
  docs: string[];
  mask?: string | null;
  masks?: Record<string, string | null> | null;
}

export interface SessionComparison {
  checks: ComparisonCheck[];
  verdict: ComparisonVerdict;
  risk_bump: number;
  zkp_gates?: Record<string, any> | null;
}

export interface ScreeningSession {
  id: string;
  status: SessionStatus;
  verdict: SessionVerdict | null;
  risk_score: number | null;
  checkpoint: string;
  screener: string | null;
  comparison: SessionComparison | null;
  note: string;
  adjudicator: string | null;
  adjudicated_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  block_hash: string | null;
  prev_hash: string | null;
  document_count?: number;
}

export interface ScreeningSessionDetail extends ScreeningSession {
  documents: ScreenReport[];
  comparison: SessionComparison;
}

export interface SessionLedgerPayload {
  blocks: ScreeningSession[];
  head_hash: string | null;
  total_blocks: number;
}

export interface SessionLedgerVerify {
  valid: boolean;
  total_blocks: number;
  verified_blocks?: number;
  head_hash: string | null;
  broken_at: string | null;
  status: string;
  reason?: string;
}

/** Open a new border session for the person now at the desk. */
export function createSession(checkpoint: string) {
  return request<ScreeningSession>("/api/sessions", {
    method: "POST",
    body: form({ checkpoint }),
  });
}

/** List sessions (own lane; supervisors see the whole desk). */
export function getSessions(status?: string, checkpoint?: string) {
  const q: string[] = [];
  if (status) q.push(`status=${encodeURIComponent(status)}`);
  if (checkpoint) q.push(`checkpoint=${encodeURIComponent(checkpoint)}`);
  const url = q.length ? `/api/sessions?${q.join("&")}` : "/api/sessions";
  return request<{ sessions: ScreeningSession[] }>(url);
}

/** Full session detail: documents + live cross-document comparison. */
export function getSession(sessionId: string) {
  return request<ScreeningSessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/** Desk officer closes the session: 'approve' signs it into the ledger;
 *  'flag' routes it to the supervisory review queue. */
export function closeSession(sessionId: string, verdict: "approve" | "flag", note?: string) {
  return request<ScreeningSessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}/close`,
    { method: "POST", body: form({ verdict, note: note || "" }) },
  );
}

/** Supervisory officer settles a FLAGGED session (CLEARED / CONFIRMED_FRAUD / INCONCLUSIVE). */
export function adjudicateSession(
  sessionId: string,
  decision: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE",
  note?: string,
) {
  return request<ScreeningSessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}/adjudicate`,
    { method: "POST", body: form({ decision, note: note || "" }) },
  );
}

/** Signed session blocks (the border ledger), oldest first. */
export function getSessionLedger() {
  return request<SessionLedgerPayload>("/api/sessions/ledger/blocks");
}

/** Tamper-check the whole session ledger end to end. */
export function verifySessionLedger() {
  return request<SessionLedgerVerify>("/api/sessions/ledger/verify");
}
