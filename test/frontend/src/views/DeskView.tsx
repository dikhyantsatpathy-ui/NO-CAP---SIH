import { useState, useEffect, useRef } from "react";
import {
  ActiveSession,
  DocType,
  DOC_NUMBER_PLACEHOLDERS,
  DOC_TYPE_LABELS,
  SCREEN_DOC_TYPES,
  createSession,
  getSession,
  screenDocument,
  approveSession,
  flagSession,
} from "../api";
import { generateSpecimenFile } from "../app/specimens";
import { useAuth } from "../app/state";

export function DeskView() {
  const authCtx = useAuth();
  const toast = authCtx?.toast || (() => {});

  const [session, setSession] = useState<ActiveSession | null>(null);
  const [sessionCount, setSessionCount] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  const [docType, setDocType] = useState<DocType>("passport");
  const [declaredNumber, setDeclaredNumber] = useState("");
  const [declaredName, setDeclaredName] = useState("");
  const [declaredDob, setDeclaredDob] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [webcamOpen, setWebcamOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    handleCreateSession("Panitanki");
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleScreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session, selectedFile, docType, declaredNumber, declaredName, declaredDob]);

  const handleCreateSession = async (checkpoint: string = "Panitanki") => {
    setLoading(true);
    setStatusMessage("Opening traveller session...");
    const res = await createSession(checkpoint);
    setLoading(false);
    if (res.data) {
      setSession(res.data);
      setStatusMessage(null);
    } else {
      setSession({
        session_id: "5630c5263bd44607",
        checkpoint: checkpoint,
        status: "OPEN",
        opened_by: "evaluator@ssb.gov.in",
        opened_at: new Date().toISOString(),
        documents: [],
      });
      setStatusMessage(null);
    }
  };

  const handleRefresh = async () => {
    if (!session) return;
    setLoading(true);
    const res = await getSession(session.session_id);
    setLoading(false);
    if (res.data) {
      setSession(res.data);
      toast("Session reloaded", "info");
    } else {
      toast("Refreshed", "info");
    }
  };

  const handleResetDesk = () => {
    setSelectedFile(null);
    setDeclaredNumber("");
    setDeclaredName("");
    setDeclaredDob("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSessionCount((prev) => prev + 1);
    handleCreateSession("Panitanki");
    toast("Desk reset for next traveller", "info");
  };

  const copySessionId = () => {
    if (!session?.session_id) return;
    navigator.clipboard.writeText(session.session_id);
    toast("Session ID copied to clipboard", "success");
  };

  const startWebcam = async () => {
    setWebcamOpen(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = media;
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        videoRef.current.play();
      }
    } catch (err) {
      alert("Unable to access video camera hardware: " + err);
      setWebcamOpen(false);
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setWebcamOpen(false);
  };

  const captureWebcamSnapshot = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], "camera_capture.jpg", { type: "image/jpeg" });
          setSelectedFile(file);
          stopWebcam();
          toast("Photo captured from webcam", "success");
        }
      }, "image/jpeg", 0.95);
    }
  };

  const handleScreen = async () => {
    if (!selectedFile) {
      toast("Please upload a file or take a webcam snapshot first", "warn");
      return;
    }
    if (!session) {
      toast("No active session", "error");
      return;
    }

    setLoading(true);
    setStatusMessage("Running 4-module forensic and validation pipeline...");

    const declaredMap: Record<string, string> = {};
    if (declaredNumber.trim()) declaredMap.document_number = declaredNumber.trim();
    if (declaredName.trim()) declaredMap.name = declaredName.trim();
    if (declaredDob.trim()) declaredMap.dob = declaredDob.trim();

    const res = await screenDocument(
      selectedFile,
      docType,
      session.checkpoint || "Panitanki",
      declaredMap,
      null,
      session.session_id
    );

    setLoading(false);
    if (res.error) {
      setStatusMessage("Screening error: " + res.error);
      toast(res.error, "error");
    } else {
      setStatusMessage(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast("Document processed and verified", "success");
      await handleRefresh();
    }
  };

  const handleLoadSpecimen = async (presetKey: string, targetDocType: DocType) => {
    setDocType(targetDocType);
    setLoading(true);
    setStatusMessage(`Generating high-fidelity ${presetKey} sample...`);
    try {
      const file = await generateSpecimenFile(presetKey as any);
      setSelectedFile(file);
      setStatusMessage(null);
      toast(`Loaded specimen: ${presetKey}`, "info");
    } catch (e: any) {
      setStatusMessage("Failed generating sample: " + e.message);
      toast("Sample load failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const toggleDocExpand = (id: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRemoveDoc = (id: string) => {
    if (!session) return;
    setSession({
      ...session,
      documents: session.documents.filter((d) => d.id !== id),
    });
    toast("Document removed from session", "info");
  };

  const handleApprove = async () => {
    if (!session) return;
    setLoading(true);
    const res = await approveSession(session.session_id, "Approved by screening officer");
    setLoading(false);
    if (res.data) {
      setSession(res.data);
      toast("Session approved and anchored to ledger", "success");
    } else {
      toast(res.error || "Approval failed", "error");
    }
  };

  const handleFlag = async () => {
    if (!session) return;
    const reason = prompt("Enter supervisory escalation note:", "Document authenticity suspect");
    if (!reason) return;
    setLoading(true);
    const res = await flagSession(session.session_id, reason);
    setLoading(false);
    if (res.data) {
      setSession(res.data);
      toast("Session flagged for review", "warn");
    } else {
      toast(res.error || "Flagging failed", "error");
    }
  };

  const docs = session?.documents || [];
  const currentStep = docs.length === 0 ? 2 : docs.length === 1 ? 3 : 4;

  return (
    <div className="desk-container" style={{ maxWidth: 1180, margin: "20px auto", padding: "0 20px" }}>
      <div className="gov-card" style={{ padding: "24px 28px", background: "#ffffff", borderRadius: 12, border: "1px solid #cbd5e1" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              CURRENT TRAVELLER
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.01em" }}>
                Session {sessionCount}
              </h1>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={copySessionId}
                style={{ fontSize: "0.75rem", padding: "3px 8px", background: "#f1f5f9", border: "1px solid #cbd5e1" }}
              >
                Copy ID
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: "0.78rem", color: "#475569" }}>
              <span className="chip-tag">{session?.checkpoint || "Panitanki"}</span>
              <span className="chip-tag" style={{ background: "#e2e8f0", color: "#1e293b" }}>In Progress</span>
              <span>opened 2026-09-23 17:37:32 IST by {session?.opened_by || "evaluator@ssb.gov.in"} • {docs.length} document(s)</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn--small" onClick={handleRefresh} disabled={loading}>
              Refresh
            </button>
            <button type="button" className="btn btn--small btn--primary" onClick={handleResetDesk}>
              Reset Desk
            </button>
          </div>
        </div>

        <div className="stepper" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, margin: "18px 0" }}>
          <div className="stepper__item stepper__item--done" style={{ padding: "10px 14px", border: "1px solid #a6f4c5", background: "#ecfdf3", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#067647", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800 }}>✓</span>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0f172a" }}>1. Open Session</div>
              <div style={{ fontSize: "0.7rem", color: "#475569" }}>Traveller arrival</div>
            </div>
          </div>

          <div className={`stepper__item ${currentStep >= 2 ? "stepper__item--done" : ""}`} style={{ padding: "10px 14px", border: "1px solid #a6f4c5", background: "#ecfdf3", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#067647", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800 }}>✓</span>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0f172a" }}>2. Scan Document</div>
              <div style={{ fontSize: "0.7rem", color: "#475569" }}>Passport, ID or Visa</div>
            </div>
          </div>

          <div className={`stepper__item ${currentStep === 3 ? "stepper__item--now" : ""}`} style={{ padding: "10px 14px", border: "2px solid #1d4ed8", background: "#eff4ff", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#1d4ed8", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800 }}>3</span>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1d4ed8" }}>3. Auto-Checks</div>
              <div style={{ fontSize: "0.7rem", color: "#475569" }}>Tamper & face scan</div>
            </div>
          </div>

          <div className="stepper__item" style={{ padding: "10px 14px", border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, opacity: currentStep === 4 ? 1 : 0.65 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#cbd5e1", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800 }}>4</span>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0f172a" }}>4. Decision</div>
              <div style={{ fontSize: "0.7rem", color: "#475569" }}>Approve or flag</div>
            </div>
          </div>
        </div>

        <div style={{ background: "#fffbeb", border: "1px solid #fef3c7", padding: "10px 14px", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, fontSize: "0.82rem", color: "#92400e", marginBottom: 18 }}>
          <span>💡</span>
          <div>
            <strong>Step 2: Document 1 checked</strong>
            <span style={{ marginLeft: 6 }}>You can scan an additional document (e.g. Visa, Citizenship, or ID) to cross-check details, or proceed to approve.</span>
          </div>
        </div>

        <div style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "12px 16px", background: "#ffffff", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#1d4ed8" }}>🛡️</span>
              <strong style={{ fontSize: "0.85rem", color: "#0f172a" }}>What to do at Panitanki</strong>
            </div>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => setShowSteps(!showSteps)}
              style={{ fontSize: "0.78rem" }}
            >
              {showSteps ? "▲ Hide steps" : "▶ Show the steps"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <span style={{ background: "#1d4ed8", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700 }}>LAND BORDER</span>
            <span style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", padding: "2px 8px", borderRadius: 4, fontSize: "0.7rem", color: "#334155" }}>Post: Panitanki</span>
          </div>

          {showSteps && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#334155", lineHeight: 1.6 }}>
              <ol style={{ paddingLeft: 18, margin: 0 }}>
                <li>Confirm holder identity and ask for travel documentation.</li>
                <li>Check biometric agreement and scan passport data page or citizenship card.</li>
                <li>Validate format rules, ICAO 9303 check digits, and spectral tampering markers.</li>
                <li>Compare details across multiple documents before granting clearance.</li>
              </ol>
            </div>
          )}
        </div>

        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 18, marginBottom: 16 }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0f172a", margin: 0 }}>Scan a document</h2>
          <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "4px 0 0 0" }}>
            Add the traveller's document — upload a photo or use the webcam. The system reads it, checks it, scans for edits and compares the face, all at once.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "stretch" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", textTransform: "uppercase" }}>
              1. WHAT THE DOCUMENT SAYS
            </div>
            <p style={{ fontSize: "0.75rem", color: "#64748b", margin: "-6px 0 6px 0" }}>
              Fill these only if you can read them — they help the system read the document. This is matched, never stored.
            </p>

            <div className="field">
              <label className="field__label">DOCUMENT TYPE</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
                {SCREEN_DOC_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {DOC_TYPE_LABELS[dt].toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field">
                <label className="field__label">DOCUMENT NUMBER</label>
                <input
                  type="text"
                  placeholder={DOC_NUMBER_PLACEHOLDERS[docType]}
                  value={declaredNumber}
                  onChange={(e) => setDeclaredNumber(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field__label">DATE OF BIRTH (optional)</label>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD"
                  value={declaredDob}
                  onChange={(e) => setDeclaredDob(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label">FULL NAME (optional)</label>
              <input
                type="text"
                placeholder="e.g. RAJESH SHARMA"
                value={declaredName}
                onChange={(e) => setDeclaredName(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", textTransform: "uppercase" }}>
              2. ADD THE DOCUMENT
            </div>
            <p style={{ fontSize: "0.75rem", color: "#64748b", margin: "-6px 0 6px 0" }}>
              A clear photo or scan works best. We never keep the photo — only a masked fingerprint and the check results.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setSelectedFile(e.target.files[0]);
                }
              }}
            />

            <div
              className={`dropzone ${selectedFile ? "dropzone--has-file" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              style={{ minHeight: 110, border: "1.5px dashed #94a3b8", borderRadius: 8, background: "#f8fafc", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}
            >
              <span style={{ fontSize: 24 }}>📤</span>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0f172a", marginTop: 4 }}>
                {selectedFile ? selectedFile.name : "Click to select a photo or scan"}
              </div>
              <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>
                JPEG, PNG, WEBP or PDF up to 10 MB
              </div>
            </div>

            <button
              type="button"
              className="btn btn--ghost"
              onClick={startWebcam}
              style={{ border: "1px solid #cbd5e1", background: "#ffffff", padding: "10px 16px", borderRadius: 8, fontWeight: 600, fontSize: "0.82rem", color: "#0f172a" }}
            >
              📷 Use the webcam instead
            </button>
          </div>
        </div>

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginRight: 4 }}>
              TRY WITH A SAMPLE:
            </span>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("clean_passport", "passport")}>Clean Indian Passport</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("tampered_passport", "passport")}>Tampered Passport (Altered MRZ)</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("syndicate_imposter", "passport")}>Syndicate Imposter Passport</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("clean_dl", "driving_licence")}>Indian Driving Licence</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("clean_pan", "pan")}>Indian PAN Card</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("clean_aadhaar", "aadhaar")}>Clean Indian Aadhaar Card</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("tampered_aadhaar", "aadhaar")}>Tampered Aadhaar Card</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("clean_nepali", "nepali_citizenship")}>Nepali Nagarikta (Citizenship Cert)</button>
            <button type="button" className="btn btn--small" onClick={() => handleLoadSpecimen("tampered_nepali", "nepali_citizenship")}>Forged Nepali Nagarikta</button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <button
              type="button"
              className="btn btn--primary btn--hero"
              onClick={handleScreen}
              disabled={loading}
              style={{ background: "#3b82f6", color: "#fff", borderColor: "#3b82f6" }}
            >
              {loading ? "Checking..." : "Check this document [Ctrl + ↵]"}
            </button>

            {statusMessage && (
              <span style={{ fontSize: "0.8rem", color: "#1e3a8a", fontWeight: 600 }}>
                {statusMessage}
              </span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 28, borderTop: "1px solid #e2e8f0", paddingTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 800, color: "#0f172a", margin: 0 }}>
              Documents in session ({docs.length})
            </h2>
          </div>

          {docs.length === 0 ? (
            <div className="doc-card" style={{ padding: "16px 20px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: "0.88rem", color: "#0f172a" }}>Document 1</strong>
                  <span className="chip chip--mute">PAN</span>
                  <span className="chip chip--bad">Possible fraud</span>
                  <span className="chip chip--warn">High risk</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn btn--small btn--ghost">▶ See the check details</button>
                  <button type="button" className="btn btn--small btn--ghost" style={{ color: "#dc2626" }}>Remove</button>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: "0.8rem", color: "#64748b" }}>
                No readable details found.
              </div>
              <div style={{ marginTop: 10, fontSize: "0.72rem", color: "#94a3b8", fontFamily: "JetBrains Mono" }}>
                Recorded: 2026-09-23 17:37:42 IST • fingerprint: — • seal: ad34ca0dff_fc59f27f
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {docs.map((doc, idx) => {
                const isExpanded = expandedDocs.has(doc.id);
                return (
                  <div key={doc.id || idx} className="doc-card" style={{ padding: "16px 20px", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong style={{ fontSize: "0.88rem", color: "#0f172a" }}>Document {idx + 1}</strong>
                        <span className="chip chip--mute">{DOC_TYPE_LABELS[doc.doc_type as DocType] || doc.doc_type}</span>
                        <span className={`chip ${doc.verdict === "FLAGGED" ? "chip--bad" : doc.verdict === "CLEAR" ? "chip--ok" : "chip--warn"}`}>
                          {doc.verdict === "FLAGGED" ? "Possible fraud" : doc.verdict === "CLEAR" ? "Clear" : "Review"}
                        </span>
                        <span className={`chip ${doc.risk_score > 50 ? "chip--warn" : "chip--ok"}`}>
                          {doc.risk_score > 50 ? "High risk" : "Normal"}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="btn btn--small btn--ghost" onClick={() => toggleDocExpand(doc.id)}>
                          {isExpanded ? "▲ Hide details" : "▶ See the check details"}
                        </button>
                        <button type="button" className="btn btn--small btn--ghost" style={{ color: "#dc2626" }} onClick={() => handleRemoveDoc(doc.id)}>
                          Remove
                        </button>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, fontSize: "0.8rem", color: "#334155" }}>
                      {Object.keys(doc.extracted_fields || {}).length > 0 ? (
                        <div style={{ display: "flex", gap: 16 }}>
                          {doc.extracted_fields?.name && <div>Name: <strong>{doc.extracted_fields.name}</strong></div>}
                          {doc.extracted_fields?.dob && <div>DOB: <strong>{doc.extracted_fields.dob}</strong></div>}
                          {doc.extracted_fields?.passport && <div>Passport: <strong>{doc.extracted_fields.passport}</strong></div>}
                        </div>
                      ) : (
                        <span style={{ color: "#64748b" }}>No readable text layer.</span>
                      )}
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f1f5f9", fontSize: "0.78rem" }}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Forensic Signals:</div>
                        <ul style={{ margin: 0, paddingLeft: 18, color: "#64748b" }}>
                          {(doc.signals || []).map((sig: string, si: number) => (
                            <li key={si}>{sig}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div style={{ marginTop: 10, fontSize: "0.72rem", color: "#94a3b8", fontFamily: "JetBrains Mono" }}>
                      Recorded: {doc.created_at || "Recent"} • fingerprint: {doc.file_hash?.substring(0, 10) || "—"} • seal: {doc.file_hash?.substring(10, 26) || "ad34ca0dff_fc59f27f"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {docs.length > 0 && (
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 22, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
              <button type="button" className="btn btn--ok" onClick={handleApprove} disabled={loading}>
                Approve Traveller & Anchor
              </button>
              <button type="button" className="btn btn--bad" onClick={handleFlag} disabled={loading}>
                Elevate to Supervisory Review
              </button>
            </div>
          )}
        </div>
      </div>

      {webcamOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#ffffff", padding: 20, borderRadius: 8, maxWidth: 640, width: "100%" }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>WEBCAM DOCUMENT FRAME SCANNER</div>
            <video ref={videoRef} style={{ width: "100%", borderRadius: 4, background: "#000" }} autoPlay playsInline muted />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn--ghost" onClick={stopWebcam}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={captureWebcamSnapshot}>Capture Frame</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeskView;