// frontend/src/api.ts

export interface ApiResult<T> {
  data?: T;
  error?: string;
  status: number;
}

export interface SignerProfile {
  email: string;
  name: string;
  institution: string;
  designation: string;
  pending_approval: boolean;
  is_super_admin: boolean;
}

export type Me = { admin: SignerProfile };

export interface SessionDocument {
  id: string;
  doc_type: string;
  file_hash: string;
  verdict: 'CLEAR' | 'REVIEW' | 'FLAGGED';
  risk_score: number;
  extracted_fields: Record<string, string>;
  signals: string[];
  created_at: string;
}

export interface ZkpProofGate {
  gate_name: string;
  passed: boolean;
  status?: string;
  assertion: string;
  proof_hash: string;
  protocol: string;
}

export interface SessionComparison {
  status: 'MATCH' | 'DISCREPANCY' | 'INCOMPLETE';
  name_check?: { status: string; detail: string; soundex?: string };
  dob_check?: { status: string; detail: string; harmonized_ad?: string };
  cross_checks?: Array<{ field: string; status: string; note: string }>;
  checks?: Array<{ status: string; note?: string }>;
  zkp_gates?: ZkpProofGate[];
  discrepancies: string[];
}

export interface ActiveSession {
  session_id: string;
  checkpoint: string;
  status: 'OPEN' | 'APPROVED' | 'FLAGGED' | 'REJECTED';
  opened_by: string;
  opened_at: string;
  documents: SessionDocument[];
  comparison?: SessionComparison;
  notes?: string;
}

// Support for ReviewQueueView
export interface ScreeningSession {
  id: string;
  session_id: string;
  checkpoint: string;
  status: string;
  opened_by: string;
  opened_at: string;
  risk_score?: number;
  documents?: any[];
  comparison?: any;
}
export type ScreeningSessionDetail = ActiveSession;

// Support for LedgerView
export interface SessionLedgerPayload {
  id: string;
  checkpoint: string;
  verdict?: string;
  comparison?: { checks: Array<{ status: string }> };
  zkp_gates?: Array<{ assertion: string; status: string }>;
  [key: string]: any;
}
export interface SessionLedgerVerify {
  valid: boolean;
  issues: string[];
}
export interface StatsOverview {
  [key: string]: any;
}

// Support for StaffView
export interface OfficerEntry {
  email: string;
  name: string;
  designation: string;
  institution: string;
  pending_approval: boolean;
  is_super_admin: boolean;
}

export interface ThreatMatrixData {
  threat_density: string;
  overall_density?: string;
  active_alerts_count: number;
  checkpoints: Record<string, { threat_level: string; recent_flags: number }>;
}

export const SCREEN_DOC_TYPES = [
  'passport',
  'aadhaar',
  'pan',
  'driving_licence',
  'voter_id',
  'nepali_citizenship',
  'visa',
  'other',
] as const;

export type DocType = (typeof SCREEN_DOC_TYPES)[number];
export type ScreenDocType = DocType;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  passport: 'Passport',
  aadhaar: 'Aadhaar Card',
  pan: 'PAN Card',
  driving_licence: 'Driving Licence',
  voter_id: 'Voter ID (EPIC)',
  nepali_citizenship: 'Nepali Citizenship (Nagarikta)',
  visa: 'Visa / Permit',
  other: 'Other / Unidentified',
};

export const SCREEN_DOC_LABELS = DOC_TYPE_LABELS;

export const DOC_NUMBER_PLACEHOLDERS: Record<DocType, string> = {
  passport: 'Passport Number',
  aadhaar: '12-digit UID [Redacted]',
  pan: '10-character PAN',
  driving_licence: 'DL Number',
  voter_id: '10-character EPIC',
  nepali_citizenship: 'Certificate No',
  visa: 'Visa / Permit Identifier',
  other: 'Declared Document Number',
};

// Support for WatchlistView
export type ScreenWatchlistCategory = 'pan' | 'passport' | 'visa' | 'driving_licence' | 'voter_id' | 'phone';
export const SCREEN_WATCHLIST_CATEGORIES: ScreenWatchlistCategory[] = ['pan', 'passport', 'visa', 'driving_licence', 'voter_id', 'phone'];
export const SCREEN_WATCHLIST_LABELS: Record<ScreenWatchlistCategory, string> = {
  pan: 'PAN', passport: 'Passport', visa: 'Visa', driving_licence: 'DL', voter_id: 'Voter ID', phone: 'Phone'
};
export const SCREEN_WATCHLIST_PLACEHOLDERS: Record<ScreenWatchlistCategory, string> = {
  pan: 'Enter PAN', passport: 'Enter Passport', visa: 'Enter Visa', driving_licence: 'Enter DL', voter_id: 'Enter Voter ID', phone: 'Enter Phone'
};

export interface WatchlistEntry {
  id: string;
  category: string;
  mask: string;
  reason: string;
  added_by: string;
  created_at: string;
}

// ============================================================================
// BASE FETCHER (With Robust React-Safe Error Parsing)
// ============================================================================
async function req<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(endpoint, {
      ...options,
      credentials: 'include',
    });
    
    if (res.status === 429) {
      return { status: 429, error: 'Rate limit exceeded. Please wait a moment.' };
    }
    
    const data = await res.json().catch(() => null);
    
    if (!res.ok) {
      let errMsg = res.statusText || 'Request failed';
      
      if (typeof data?.detail === 'string') {
        errMsg = data.detail;
      } else if (Array.isArray(data?.detail) && data.detail.length > 0) {
        // Correctly strings together FastAPI / Pydantic validation objects
        // to prevent "Objects are not valid as a React child" errors.
        errMsg = data.detail.map((d: any) => d.msg || JSON.stringify(d)).join('; ');
      } else if (data?.message) {
        errMsg = String(data.message);
      }
      
      return { status: res.status, error: errMsg };
    }
    
    return { status: res.status, data };
  } catch (err: any) {
    return { status: 0, error: err.message || 'Network connection failed' };
  }
}

// ============================================================================
// ENDPOINTS
// ============================================================================

// --- Authentication Endpoints ---
export async function getMe(): Promise<ApiResult<Me>> { return req('/api/admin/me'); }
export const getAuthMe = getMe;

export async function loginWithToken(id_token: string): Promise<ApiResult<any>> {
  return req('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token }),
  });
}
export const googleLogin = loginWithToken;
export async function demoLogin(): Promise<ApiResult<any>> { return req('/api/admin/demo_login', { method: 'POST' }); }
export async function logout(): Promise<ApiResult<any>> { return req('/api/admin/logout', { method: 'POST' }); }

// --- Desk & Session Endpoints ---
export async function getSession(session_id: string): Promise<ApiResult<ActiveSession>> { return req(`/api/session/${encodeURIComponent(session_id)}`); }
export async function createSession(checkpoint: string): Promise<ApiResult<ActiveSession>> {
  return req('/api/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkpoint }),
  });
}

export async function screenDocument(
  file: File | Blob,
  docType: string,
  checkpoint: string,
  declared: Record<string, string> = {},
  liveFrame?: Blob | null,
  sessionId?: string
): Promise<ApiResult<any>> {
  const form = new FormData();
  form.append('file', file, (file as File).name || 'document_scan.jpg');
  form.append('doc_type', docType);
  form.append('checkpoint', checkpoint);
  form.append('declared', JSON.stringify(declared));
  if (sessionId) form.append('session_id', sessionId);
  if (liveFrame) form.append('live_frame', liveFrame, 'holder_live.jpg');
  return req('/api/screen', { method: 'POST', body: form });
}

export async function approveSession(sessionId: string, notes?: string): Promise<ApiResult<any>> {
  return req(`/api/session/${encodeURIComponent(sessionId)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
}

export async function flagSession(sessionId: string, reason: string): Promise<ApiResult<any>> {
  return req(`/api/session/${encodeURIComponent(sessionId)}/flag`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
}

export async function adjudicateSession(id: string, verdict: string, notes: string): Promise<ApiResult<any>> {
  return req(`/api/screen/${id}/adjudicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict, notes }) });
}

export async function getSessions(): Promise<ApiResult<ScreeningSession[]>> { return req('/api/screen/queue'); }
export async function getThreatMatrix(): Promise<ApiResult<ThreatMatrixData>> { return req('/api/border/threat_matrix'); }
export function getBsaCertificateUrl(sessionId: string): string { return `/api/screen/bsa65b/${encodeURIComponent(sessionId)}`; }
export async function getAirgapHandoverToken(sessionId: string): Promise<ApiResult<{ token: string; payload: any }>> { return req(`/api/screen/handover/${encodeURIComponent(sessionId)}`); }

// --- Ledger Endpoints ---
export async function getSessionLedger(): Promise<ApiResult<SessionLedgerPayload[]>> { return req('/api/screen/ledger'); }
export async function getStatsOverview(): Promise<ApiResult<StatsOverview>> { return req('/api/screen/stats'); }
export async function verifySessionLedger(): Promise<ApiResult<SessionLedgerVerify>> { return req('/api/screen/ledger/verify'); }

// --- Staff Endpoints ---
export async function getSigners(): Promise<ApiResult<OfficerEntry[]>> { return req('/api/admin/signers'); }
export async function assignRole(email: string, roleData: any): Promise<ApiResult<any>> {
  return req('/api/admin/assign_role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, ...roleData }) });
}

// --- Watchlist Endpoints ---
export async function getWatchlist(): Promise<ApiResult<WatchlistEntry[]>> { return req('/api/screen/watchlist'); }
export async function addWatchlistEntry(category: string, value: string, reason: string): Promise<ApiResult<any>> {
  return req('/api/screen/watchlist/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, value, reason }) });
}
export async function removeWatchlistEntry(id: string): Promise<ApiResult<any>> {
  return req('/api/screen/watchlist/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
}