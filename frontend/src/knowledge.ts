// ============================================================================
// Comprehensive Project Knowledge Base — SSB Border Screening (SIH26188)
// Zero-Storage AI-Based Fake Identity & Document Screening Engine
// Provides 100% authoritative answers offline & online about the entire project.
// ============================================================================

export type BotMessage = { role: "user" | "bot"; text: string };

type Entry = { id: string; tags: string[]; q: string; a: string; s?: string };

const ENTRIES: Entry[] = [
  {
    id: "what",
    tags: ["what", "is", "nocap", "project", "about", "sih", "genesis", "ssb", "border", "purpose", "overview", "introduction"],
    q: "What is this project and what problem does it solve?",
    a: "**SSB Border Screening (SIH26188)** is an enterprise AI-powered fake identity and document screening console built specifically for the Sashastra Seema Bal (SSB) and Ministry of Home Affairs (MHA) border checkpoint inspection desks (Indo-Nepal and Indo-Bhutan frontiers).\n\nIt enables screening officers to upload physical or digital identity documents (Passport, Aadhaar, PAN, Driving Licence, Voter ID / EPIC, Nepal Citizenship, Bhutan ID) along with an optional live face capture. The engine runs a **4-Module Forensic Pipeline** in under 800ms, computing an explainable Risk Score (0–100) and automated verdict (**CLEAR**, **REVIEW**, or **FLAGGED**). All operations adhere to **Zero-Raw-Storage** privacy (DPDP Act 2023) and generate court-admissible audit chains (BSA 2023 Section 65B).",
    s: "README.md · app/main.py · app/screening.py",
  },
  {
    id: "modules-all",
    tags: ["modules", "pipeline", "four", "m1", "m2", "m3", "m4", "forensic", "architecture", "screening", "flow"],
    q: "Explain the Four-Module Forensic Screening Pipeline.",
    a: "The screening desk evaluates every traveller document through four isolated, deterministic, and AI-assisted modules:\n\n1. **Module 1 — Multi-Pass Optical Extraction (M1)**: Extracts textual fields, MRZ zones, and UIDAI Secure QR codes using RapidOCR (ONNX), PyTesseract, and 4-way rotation scans with EXIF transpose.\n2. **Module 2 — Document Validation & Checksums (M2)**: Performs mathematical checksum verification (ICAO 9303 Doc 731 weights for passports/visas, Verhoeff algorithm for Aadhaar, state RTO series for Driving Licences, ITD category checks for PAN), expiry rules, and privacy-preserving hashed watchlist matches.\n3. **Module 3 — Document Forensics & Tamper Detection (M3)**: Executes image forensics including JPEG Error Level Analysis (ELA), 2D-FFT spectral Peak-to-Average Power Ratio (PAPR) for print-scan forgery, and Photo-Response Non-Uniformity (PRNU) sensor noise correlation for spliced portrait detection.\n4. **Module 4 — Biometric Facial Verification (M4)**: Detects face crops on the document and compares them against live webcam frames using 512-dimensional face embeddings with cosine similarity, age-aware thresholding, and interactive challenge-response liveness (blink, head nod).",
    s: "app/screening.py · app/forensics.py · app/face.py · app/identity.py",
  },
  {
    id: "module-1",
    tags: ["module 1", "m1", "ocr", "extraction", "rapidocr", "tesseract", "aadhaar", "pan", "passport", "mrz", "qr", "barcode"],
    q: "How does Module 1 (OCR Extraction) work?",
    a: "**Module 1 (OCR Extraction)** handles dual-sided image and PDF document uploads with robust pre-processing:\n- **Auto-Rotation & EXIF Normalization**: Corrects orientation across 0°, 90°, 180°, and 270° angles.\n- **Contrast Equalization & Unsharp Masking**: Uses CLAHE and Gaussian filtering to eliminate glare on laminated ID cards.\n- **UIDAI Secure QR & Barcode Parsing**: Extracts 100% cryptographic text directly from Aadhaar 2048-bit RSA QR codes or Code128 barcodes.\n- **YOLO ROI Zone Detection**: Uses a trained 5-class YOLO model to isolate Aadhaar/PAN fields (Name, DOB, Gender, ID Number, Photo).\n- **Dual-Sided Merging**: Non-destructively merges front and back images to capture full address, parentage, and QR payload.",
    s: "app/extraction.py · app/yolo_roi.py · app/qr_decoder.py",
  },
  {
    id: "module-2",
    tags: ["module 2", "m2", "validation", "checksum", "icao", "9303", "verhoeff", "pan", "dl", "voter", "epic", "expiry", "six month"],
    q: "How does Module 2 (Document Validation & Checksum Rules) work?",
    a: "**Module 2 (Validation)** performs deterministic, zero-trust verification:\n- **ICAO Doc 9303 TD1/TD2/TD3**: Computes repeating 7-3-1 weight check-digits over document number, date of birth, expiry date, and composite checksum.\n- **Aadhaar Verhoeff Checksum**: Validates the 12-digit UIDAI number using the D8 dihedral permutation matrix.\n- **PAN Category & Structure**: Validates 5-letter prefix, mandatory entity code (`P` for individual, `C` for company, etc. in 4th character), 4 digits, and check letter.\n- **Driving Licence (SARATHI / Parivahan)**: Confirms state code + 2-digit RTO + 4-digit issue year + 7-digit serial number.\n- **Travel Validity & 6-Month Rule**: Flags passports expiring within 180 days of border crossing.\n- **Privacy-Preserving Watchlist**: Compares SHA-256 digests against blacklisted syndicates without storing raw numbers.",
    s: "app/identity.py · app/validation.py · app/mrz.py",
  },
  {
    id: "module-3",
    tags: ["module 3", "m3", "forensics", "tampering", "ela", "error level analysis", "fft", "papr", "prnu", "noise", "heatmap"],
    q: "How does Module 3 (Forensic Tamper Detection) detect forged IDs?",
    a: "**Module 3 (Forensics)** catches digital tampering, photoshop splices, and print-scan clones:\n- **JPEG Error Level Analysis (ELA)**: Resaves the image at 90% quality and analyzes compression artifact variance across modified text/photo regions.\n- **2D-FFT Spectral PAPR**: Computes the 2D Fast Fourier Transform high-frequency spectral density to distinguish genuine continuous-tone sensor noise from halftone printer screening or digital screen recaptures.\n- **PRNU Sensor Noise Correlation**: Extracts photo-response non-uniformity sensor noise from the portrait zone to verify if the photo belongs to the same camera sensor as the rest of the document card.\n- **Laplacian Blur Variance**: Quantifies edge sharpness to detect motion blur or intentional defocusing.",
    s: "app/forensics.py · app/screening.py",
  },
  {
    id: "module-4",
    tags: ["module 4", "m4", "face", "biometrics", "facial", "recognition", "cosine", "liveness", "blink", "nod", "spoof"],
    q: "How does Module 4 (Biometrics & Live Face Matching) work?",
    a: "**Module 4 (Biometrics)** verifies that the traveller presenting the document is its rightful holder:\n- **Face Embedding Comparison**: Crops the document portrait and compares it against live webcam captures using a 512-dimensional deep neural network embedding.\n- **Cosine Similarity & Thresholds**: Baseline match threshold is 0.65; adjusts dynamically based on the age difference between document issue date and current crossing.\n- **Challenge-Response Liveness**: Prompts the officer/traveller to perform random physical gestures (e.g. blink twice, turn head left, nod) across a multi-frame burst to defeat static photo attacks, printed cutouts, and 3D silicone masks.\n- **Anti-Virtual-Camera Jitter**: Analyzes inter-frame micro-jitter and exposure timestamps to defeat OBS virtual camera injection.",
    s: "app/face.py · app/forensics.py · app/main.py",
  },
  {
    id: "zero-storage",
    tags: ["privacy", "zero storage", "dpdp", "act", "2023", "pii", "security", "encryption", "hash", "masking", "compliance"],
    q: "How does the system ensure Zero-Raw-Storage and DPDP Act 2023 compliance?",
    a: "Under the **Digital Personal Data Protection (DPDP) Act, 2023**, storing citizen identity scans and plaintext PII introduces massive security risks. Our system enforces **Zero-Raw-Storage by design**:\n- **Ephemeral In-Memory Processing**: Uploaded images and live camera frames exist only in volatile memory during pipeline execution and are zeroed immediately after.\n- **Masked Persistence**: The database stores only masked fields (e.g. `****1234`, `A****G`, `*** Nayak`) and deterministic SHA-256 cryptographic hashes.\n- **Zero Plaintext Logs**: Application logs and structured telemetry never print raw document numbers or holder names.\n- **Privacy-Preserving Watchlist**: Watchlist entries store only `SHA-256(normalized_id)` + search reason.",
    s: "app/screening.py · app/main.py · app/session.py",
  },
  {
    id: "blockchain-bsa",
    tags: ["blockchain", "ledger", "bsa", "2023", "section 65b", "evidence", "court", "admissibility", "merkle", "hash chain", "dossier"],
    q: "How does the Immutable Hash-Chain Ledger & BSA 2023 Section 65B certification work?",
    a: "Under **Section 65B of the Bharatiya Sakshya Adhiniyam, 2023 (BSA)**, electronic records are court-admissible only if their integrity and chain of custody are mathematically provable:\n- **SHA-256 Chained Blocks**: Every screening pass links cryptographically to the previous report hash (`previous_hash` + `payload_hash` -> `ledger_hash`).\n- **Session Merkle Trees**: Cross-document border sessions compute a Merkle root over all submitted documents.\n- **HMAC Desk Sealing**: Printable Court Dossiers are cryptographically sealed with the station's inspection key, timestamped in IST.\n- **Section 65B Export**: Officers can generate signed electronic record certificates stating the machine parameters, cryptographic digest, and officer attribution for trial submission.",
    s: "app/session.py · app/main.py · scripts/anchor_ledger.py",
  },
  {
    id: "checkpoints-treaty",
    tags: ["checkpoints", "border", "indo nepal", "indo bhutan", "treaty", "1950", "panitanki", "raxaul", "sonauli", "jaigaon", "ssb"],
    q: "What border checkpoint sectors and treaties are supported?",
    a: "The console is pre-configured with operational parameters for major SSB Integrated Check Posts (ICPs):\n- **Panitanki (West Bengal)**: Indo-Nepal corridor (Kakarbhitta crossing).\n- **Raxaul (Bihar)**: Major commercial and transit corridor to Birgunj, Nepal.\n- **Sonauli (Uttar Pradesh)**: High-volume passenger route near Lumbini, Nepal.\n- **Jaigaon (West Bengal)**: Primary gateway into Phuentsholing, Bhutan.\n\n**Treaty Compliance**:\n- **Indo-Nepal 1950 Treaty of Peace and Friendship**: Permits Indian and Nepalese citizens to cross without visas, validating Nepali Citizenship Cards, Election Cards, and Passports.\n- **Indo-Bhutan Travel Agreement**: Enforces Bhutanese Voter ID / Citizenship Identity Card protocols.\n- **Third-Country Nationals**: Mandates standard passport, valid Indian Visa / e-Visa, and biometrics.",
    s: "app/config.py · app/guide.py · app/screening.py",
  },
  {
    id: "syndicate-graph",
    tags: ["syndicate", "network", "graph", "cluster", "cross checkpoint", "recidivism", "fraud ring", "alerts"],
    q: "How does the Cross-Border Syndicate Monitor detect fraud rings?",
    a: "The **Syndicate Monitor (`app/syndicate.py`)** connects screening digests across all ICPs in near-real-time:\n- **Velocity & Clashing Alerts**: Detects when the same identifier or photo embedding appears at two different checkpoints (e.g. Panitanki and Sonauli) within an impossible transit window.\n- **Cluster Analysis**: Flags coordinated fraud rings where multiple individuals present documents with sequential serial numbers, identical templates, or shared forged stamps.\n- **Recidivism Tracking**: Alerts desk officers if an individual whose document was previously FLAGGED or ADJUDICATED as fraud attempts entry at a different crossing.",
    s: "app/syndicate.py · frontend/src/views/DeskView.tsx",
  },
  {
    id: "tech-stack",
    tags: ["tech", "stack", "fastapi", "react", "vite", "neon", "postgres", "sqlite", "onnx", "rapidocr", "python", "typescript"],
    q: "What is the complete technology stack?",
    a: "**Backend Architecture**:\n- **Language & Framework**: Python 3.12, FastAPI (async/await throughout), Starlette.\n- **Database**: PostgreSQL on Neon Serverless with automatic background keep-alive ping; local high-availability SQLite fallback with WAL mode.\n- **ML & Forensics**: RapidOCR (ONNX Runtime), OpenCV, NumPy, SciPy, PyPDF.\n- **Security & Rate Limiting**: SlowAPI, Google OAuth 2.0 OpenID Connect.\n\n**Frontend Architecture**:\n- **Core**: React 18, TypeScript, Vite.\n- **Styling**: Vanilla CSS Design System with curated Navy & Off-White tokens, glassmorphism, responsive data grids, and zero third-party bloated CSS frameworks.\n- **AI Assistant**: Dual-engine chatbot with instant offline RAG knowledge base + Gemini 1.5/2.0 API codebase RAG.",
    s: "pyproject.toml · package.json · app/main.py · frontend/src/styles.css",
  },
  {
    id: "neon-db",
    tags: ["neon", "database", "keepalive", "postgres", "serverless", "performance", "speed", "fast"],
    q: "How is Neon DB kept lightning-fast without sleeping?",
    a: "Neon serverless PostgreSQL automatically scales to zero after ~5 minutes of idle time. To eliminate cold-start latency, the backend runs a dedicated background keep-alive loop (`_neon_keepalive_loop`) inside FastAPI's `lifespan`. Every 210 seconds (~3.5 minutes), it sends a lightweight `SELECT 1` ping to keep connection pools warm, active, and instantly responsive.",
    s: "app/main.py:2070-2095",
  },
  {
    id: "dual-sided",
    tags: ["dual sided", "two side", "front", "back", "aadhaar back", "dl back", "intake"],
    q: "How does dual-sided document intake work?",
    a: "Identity documents like Aadhaar cards and Driving Licences carry crucial data on both sides (Front: Name, DOB, Photo, ID Number; Back: Permanent Address, Father/Husband Guardian details, UIDAI QR Code). The desk UI provides an optional 'Upload Back Side' dropzone. When supplied, Module 1 performs optical extraction on both surfaces and non-destructively merges the verified back address and QR payload into the primary report.",
    s: "frontend/src/views/DeskView.tsx · app/extraction.py · app/screening.py",
  },
  {
    id: "how-to-run",
    tags: ["run", "start", "install", "how to", "setup", "local", "commands", "port 8000"],
    q: "How do I run and test the application locally?",
    a: "1. **Windows Quick-Start**: Double-click `START.bat` in the repository root. It auto-installs Python dependencies (`uv` / `pip`), builds the frontend bundle, and launches Uvicorn on `http://localhost:8000`.\n2. **Manual Backend**: `python -m pip install -r requirements.txt` then `python -m uvicorn app.main:app --port 8000 --reload`.\n3. **Manual Frontend**: In `frontend/`, run `npm install && npm run build` (or `npm run dev` on port 5173).\n4. **Run Tests**: `pytest` in the project root to run comprehensive unit and integration suites.",
    s: "START.bat · pyproject.toml · tests/",
  },
];

export const SUGGESTED_QUESTIONS: string[] = [
  "What is this project and what problem does it solve?",
  "Explain the Four-Module Forensic Screening Pipeline.",
  "How does Module 3 (Forensic Tamper Detection) detect forged IDs?",
  "How does Module 4 (Biometrics & Live Face Matching) work?",
  "How does the system ensure Zero-Raw-Storage & DPDP Act compliance?",
  "How does the Immutable Hash-Chain Ledger & BSA 2023 evidence work?",
  "What border checkpoint sectors & treaties are supported?",
  "How is Neon DB kept lightning-fast without sleeping?",
];

const normify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function searchKnowledge(query: string, limit = 2): Entry[] {
  const q = normify(query);
  if (!q) return [];
  const tokens = q.split(" ").filter((t) => t.length > 1);
  const scored = ENTRIES.map((e) => {
    const tagText = normify(e.tags.join(" "));
    const qText = normify(e.q);
    const aText = normify(e.a);
    let score = 0;
    for (const t of tokens) {
      if (tagText.includes(t)) score += 5;
      if (qText.includes(t)) score += 3;
      if (aText.includes(t)) score += 1;
    }
    if (tokens.every((t) => tagText.includes(t) || qText.includes(t))) score += 8;
    return { e, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

export function answerFor(query: string): string {
  const hits = searchKnowledge(query, 2);
  if (!hits.length) return fallbackAnswer(query);
  return hits.map((h) => h.a + (h.s ? `\n\n📌 *Reference Source: ${h.s}*` : "")).join("\n\n---\n\n");
}

export function fallbackAnswer(query: string): string {
  const q = query.trim();
  return (
    `**I am your dedicated technical oracle for the SSB Border Screening Console (SIH26188).**\n\n` +
    `I can answer anything about:\n` +
    `• **The 4-Module Pipeline**: M1 OCR, M2 Checksums, M3 Tamper Forensics (ELA/FFT/PRNU), M4 Biometrics\n` +
    `• **Privacy & Compliance**: Zero-Raw-Storage DPDP Act 2023, BSA 2023 Section 65B court evidence\n` +
    `• **Checkpoint Operations**: Indo-Nepal 1950 Treaty, Panitanki, Raxaul, Sonauli, Jaigaon\n` +
    `• **Architecture & Code**: FastAPI, Neon PostgreSQL keep-alive, RapidOCR, React frontend\n\n` +
    `Try asking one of the suggested questions above, or ask specifically about any module or feature!` +
    (q ? `\n\n*(Your query: "${q.slice(0, 80)}")*` : "")
  );
}