// ============================================================================
// Project guide knowledge base (offline, curated).
// The chatbot answers purely from this file — no network, no LLM — so it works
// in a judge's offline demo and every answer is a line the team can vouch for.
// ============================================================================

export type BotMessage = { role: "user" | "bot"; text: string };

type Entry = { id: string; tags: string[]; q: string; a: string; s?: string };

const ENTRIES: Entry[] = [
  {
    id: "what",
    tags: ["what", "is", "nocap", "project", "veri_source", "about", "sih", "genesis", "ssb", "border"],
    q: "What is this project?",
    a: "*SSB Border Screening (SIH26188)* is an **AI-based fake identity & document screening console** for the border inspection desk. Officers upload an identity document (plus an optional live face capture) and the system runs a four-module forensic pipeline — extract, validate, tamper-detect, face-match — returning a risk score and a CLEAR / REVIEW / FLAGGED verdict with one explainable reason per risk point. Every run is attributed to the screening officer and recorded in a hash-only audit trail.",
    s: "README.md + frontend/views/AuthorityView.tsx",
  },
  {
    id: "screen",
    tags: ["screen", "screening", "mha", "document", "id", "voter", "visa", "passport", "pan", "driving", "licence"],
    q: "What does the document screening desk do?",
    a: "Officers upload an identity photo/PDF (passport, visa, driving licence, PAN, voter ID) plus declared fields. The pipeline **extracts fields, validates format rules and checksums (ICAO 9303 MRZ for passports/visas), checks expiry and travel validity, cross-checks the watchlist, detects tampering, verifies the holder's face, and watches for cross-checkpoint syndicate patterns** — returning CLEAR / REVIEW / FLAGGED with one explainable reason per risk point. Only masked identifiers are stored.",
    s: "MHA_SCREENING.md + app/screening.py",
  },
  {
    id: "modules",
    tags: ["module", "m1", "m2", "m3", "m4", "extract", "validate", "tamper", "face", "mrz", "ocr", "ela", "prnu", "fft"],
    q: "What are the four screening modules?",
    a: "**M1 — Extract**: OCR reads the printed fields, MRZ, and declared numbers (PDF or photo, in-memory only). **M2 — Validate**: checks MRZ check digits, document-number format rules, expiry and the six-month travel rule, and the hash-only watchlist. **M3 — Tamper**: three forensics — ELA (re-saved JPEG regions), 2D-FFT spectral (unnatural pixel patterns), and PRNU noise (spliced portrait). **M4 — Face**: compares the document portrait with a live camera capture to catch impostors using someone else's genuine document.",
    s: "app/screening.py + AuthorityView module panels",
  },
  {
    id: "screen-reports",
    tags: ["screening", "dossier", "syndicate", "shift", "export", "report", "evidence", "travel", "validity", "adjudicate"],
    q: "What screening reports and alerts are available?",
    a: "Each report carries a four-module scorecard, travel-validity status, and syndicate alerts when the same identifier reappears, clashes, or surges at a checkpoint. Supervisors can open a printable HMAC-sealed court dossier or export a signed shift log. Adjudications (CLEARED / CONFIRMED_FRAUD / INCONCLUSIVE) are reserved for supervisors — human-in-the-loop over the AI verdict.",
    s: "MHA_SCREENING.md + app/main.py screening routes",
  },
  {
    id: "syndicate",
    tags: ["syndicate", "cross", "border", "clash", "cluster", "checkpoint", "alert", "recidivism", "pattern"],
    q: "How does the syndicate monitor work?",
    a: "The monitor analyses all recent screenings across checkpoints for organised-fraud patterns: the same identity used at multiple border posts, a cluster of suspicious documents from one origin, or an individual flagged repeatedly. Alerts are tagged CRITICAL / HIGH with the checkpoint, so a supervisor can spot a cross-border ring the moment a pattern forms.",
    s: "app/syndicate.py + ScreeningDesk monitor panel",
  },
  {
    id: "watchlist",
    tags: ["watchlist", "blacklist", "flagged", "administrator", "privacy", "hash", "pan", "passport", "visa", "licence", "voter", "phone"],
    q: "How does the watchlist work without storing raw numbers?",
    a: "Administrators choose a supported identifier category — PAN, passport, visa, driving licence, voter ID, or phone — then add a *hashed* identifier plus a reason phrase. Screening compares identifiers **before hashing**, so the raw value never touches the database — zero plaintext storage. If a watchlisted fingerprint shows up again, it glows red as a risk.",
    s: "MHA_SCREENING.md watchlist section",
  },
  {
    id: "roles",
    tags: ["roles", "access", "officer", "administrator", "approve", "authorisation", "authz", "google", "sso"],
    q: "Who can do what?",
    a: "The console is locked behind **Google single sign-in**. **Approved officers** (admin-assigned post & institution) can screen documents at checkpoints. **Administrators** adjudicate verdicts, manage the watchlist, and assign roles. A sign-in without an assigned role is blocked from screening until an administrator approves it. Titles are granted, never self-claimed.",
    s: "app/main.py access model + frontend OfficerDirectory",
  },
  {
    id: "ai",
    tags: ["ai", "detector", "heuristic", "onnx", "deepfake", "genai", "face", "embedding"],
    q: "What AI does the screening engine use?",
    a: "The engine fuses **four on-device/cloud paths**: checksum-based validation rules, an OCR pipeline, tamper forensics (ELA / spectral / PRNU, with a YOLO ROI pre-check), and face-embedding cosine comparison when a live capture is attached. No photo is ever sent to image-AI analysis — the module matrix and the tamper heatmap give a supervisor proof, not just a probability.",
    s: "app/screening.py + app/codebase.py blueprint",
  },
  {
    id: "privacy",
    tags: ["privacy", "zero", "storage", "pii", "hash", "mask", "sensitive", "data", "audit"],
    q: "Is this privacy-safe / zero-storage?",
    a: "Yes by design: **document bytes and live captures are processed in memory and never stored**; the audit trail keeps hashes and *masked* identifiers, never raw content or naked numbers; the watchlist stores only hashes. The footer reads `ZERO-STORAGE AUDIT TRAIL`.",
    s: "app/screening.py zero-storage discipline",
  },
  {
    id: "dossier",
    tags: ["dossier", "court", "evidence", "hmac", "print", "seal", "statutory"],
    q: "What is the court dossier?",
    a: "Every screening report has a **tamper-evident dossier** (printable) sealed by the inspection desk key. It carries the verdict, per-risk reasons, module scorecard, watchlist hits, syndicate alerts, and the adjudication record. The seal proves the record wasn't edited after screening; it does not by itself establish legal admissibility.",
    s: "app/main.py dossier route",
  },
  {
    id: "tech",
    tags: ["tech", "stack", "fastapi", "react", "vite", "vercel", "postgres", "provider"],
    q: "What is the tech stack?",
    a: "**Backend**: FastAPI + SQLAlchemy over PostgreSQL, Google OAuth for the officer console. The screening engine lives in `app/main.py`, `app/screening.py`, `app/syndicate.py`, `app/forensics.py`, `app/face.py`, `app/mrz.py`, `app/validation.py`, `app/extraction.py`, `app/identity.py`, `app/transliterate.py`. **Frontend**: React + TypeScript + Vite, built into a single self-contained `app/static/index.html`. Deployable on Vercel via `api/index.py`.",
    s: "requirements.txt + package.json",
  },
  {
    id: "run",
    tags: ["run", "start", "install", "setup", "local", "port", "8000"],
    q: "How do I run it locally?",
    a: "Double-click **START.bat** (Windows): it installs Python + npm deps on first run, rebuilds the frontend, starts `uvicorn` on port 8000 and opens the browser. Manual: `python -m pip install -r requirements.txt`, `npm install && npm run build` in `frontend/`, then `uvicorn main:app --port 8000` from `app/`.",
    s: "START.bat + HOW_TO_HOST.md",
  },
  {
    id: "explain",
    tags: ["explain", "mode", "breakdown", "layman", "details", "why", "reason", "tooltip", "help", "guide"],
    q: "What is Explain Mode?",
    a: "**Explain mode** is an interactive educational switch in the top bar (`frontend/src/app/explain.tsx`). When toggled **ON**, the cursor changes to a help pointer and tapping a control opens a plain-English 'what & why' card about that action instead of performing it — built for non-technical officers and judges to explore the desk safely.",
    s: "frontend/src/app/explain.tsx",
  },
];

export const SUGGESTED_QUESTIONS: string[] = [
  "What does this project do?",
  "What are the four screening modules?",
  "How does the watchlist work without storing raw numbers?",
  "What AI does the screening engine use?",
  "Who can do what?",
  "What is Explain Mode?",
  "How do I run it locally?",
];

const normify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function searchKnowledge(query: string, limit = 2): Entry[] {
  const q = normify(query);
  if (!q) return [];
  const tokens = q.split(" ").filter(Boolean);
  const scored = ENTRIES.map((e) => {
    const tagText = normify(e.tags.join(" "));
    const qText = normify(e.q);
    let score = 0;
    for (const t of tokens) {
      if (tagText.includes(t)) score += 3;
      else if (qText.includes(t)) score += 1;
      if (tagText.startsWith(t) || qText.includes(t)) score += 1;
    }
    if (tokens.every((t) => tagText.includes(t) || qText.includes(t))) score += 4;
    return { e, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

export function answerFor(query: string): string {
  const hits = searchKnowledge(query, 2);
  if (!hits.length) return fallbackAnswer(query);
  return hits.map((h) => h.a + (h.s ? `\n— *${h.s}*` : "")).join("\n\n---\n\n");
}

export function fallbackAnswer(query: string): string {
  const q = query.trim();
  return (
    `I couldn't match that to a curated note. Try one of the suggested questions, ` +
    `or ask about *screening*, *modules*, *watchlist*, *syndicate*, *roles*, ` +
    `or the *tech stack*.\n` +
    (q ? `Snippet of your question: "${q.slice(0, 80)}"` : "")
  );
}