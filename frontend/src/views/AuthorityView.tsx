// ============================================================================
// AuthorityView — SSB Border Screening Command Console (SIH26188)
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// High-grade cyber command architecture: Tabbed separation & dedicated sub-tables
// for Screening Desk, Adjudication Queue, Syndicate Threats, Watchlist,
// Immutable Blockchain Ledger, and Officer Roster.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import {
  adjudicateScreen,
  addWatchlistEntry,
  assignRole,
  getAadhaarFields,
  getDossierUrl,
  getLedgerAnchor,
  getScreenQueue,
  getScreenReport,
  getSigners,
  getSyndicateAlerts,
  getWatchlist,
  googleLogin,
  removeWatchlistEntry,
  triggerLedgerAnchor,
  verifyLedgerChain,
  SCREEN_DOC_LABELS,
  SCREEN_DOC_NUMBER_PLACEHOLDERS,
  SCREEN_DOC_TYPES,
  SCREEN_WATCHLIST_CATEGORIES,
  SCREEN_WATCHLIST_LABELS,
  SCREEN_WATCHLIST_PLACEHOLDERS,
  screenDocument,
  verifyLiveness,
  type AadhaarFieldBox,
  type LedgerAnchorStatus,
  type LedgerVerifyResult,
  type LivenessResult,
  type OfficerEntry,
  type ScreenDocType,
  type ScreenModuleTampering,
  type ScreenTravelValidity,
  type ScreenWatchlistCategory,
  type ScreenQueue,
  type ScreenReport,
  type WatchlistEntry,
} from "../api";
import { SPECIMEN_PRESETS, generateSpecimenFile, type SpecimenPreset } from "../app/specimens";
import { useAuth, recordScreeningMetric, useToast } from "../app/state";
import { copyText, initials } from "../app/util";
import {
  Button,
  Card,
  Dropzone,
  EmptyNote,
  Field,
  IconBolt,
  IconKey,
  IconLock,
  Kicker,
  Modal,
  Pill,
  useGsiReady,
} from "../components/ui";
import { FALLBACK_CLIENT_ID } from "./gsi";
import { NoticeBoard } from "../components/NoticeBoard";

// ----------------------------------------------------------------------------
// Types & Constants
// ----------------------------------------------------------------------------

export type AuthorityTab = "desk" | "queue" | "syndicate" | "watchlist" | "ledger" | "admin" | "notices";

const VERDICT_META: Record<string, { pill: "seal" | "amber" | "danger" }> = {
  CLEAR: { pill: "seal" },
  REVIEW: { pill: "amber" },
  FLAGGED: { pill: "danger" },
};

const MODULE_VERDICT_TONE: Record<string, "seal" | "amber" | "danger" | "slate"> = {
  PASS: "seal",
  CLEAR: "seal",
  REVIEW: "amber",
  FAIL: "danger",
  UNVERIFIED: "slate",
};

const CHALLENGES: { id: string; prompt: string; icon: string; hint: string }[] = [
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

const MASKED_FIELD_LABELS: Record<string, string> = {
  name: "NAME",
  doc_number: "DOCUMENT NUMBER",
  dob: "DATE OF BIRTH",
  expiry_date: "DATE OF EXPIRY",
  nationality: "NATIONALITY",
  gender: "GENDER",
  pan_number: "PAN NUMBER",
  dl_number: "DL NUMBER",
  voter_id: "VOTER ID",
  aadhaar_number: "AADHAAR NUMBER",
  visa_number: "VISA NUMBER",
  entry_validation: "ENTRY VALIDATION",
};

function formatMaskedFieldValue(value: string | boolean | null) {
  if (typeof value === "boolean") return value ? "YES" : "NO";
  if (!value) return "NOT FOUND";
  return value;
}

function formatScreenDocType(docType: string) {
  if (docType in SCREEN_DOC_LABELS) {
    return SCREEN_DOC_LABELS[docType as ScreenDocType];
  }
  return docType.replace(/_/g, " ").toUpperCase();
}

function formatWatchlistCategory(category: string | null) {
  if (!category) return "GENERIC";
  if (category in SCREEN_WATCHLIST_LABELS) {
    return SCREEN_WATCHLIST_LABELS[category as ScreenWatchlistCategory];
  }
  return category.replace(/_/g, " ").toUpperCase();
}

// ----------------------------------------------------------------------------
// Auth gate + Google sign-in button
// ----------------------------------------------------------------------------

function GoogleSignInButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ready = useGsiReady();
  const rendered = useRef(false);
  const { refresh } = useAuth();
  const { toast } = useToast();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!ready || !containerRef.current || rendered.current) return;
    rendered.current = true;
    const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || FALLBACK_CLIENT_ID;
    window.google!.accounts!.id!.initialize({
      client_id: clientId,
      ux_mode: "popup",
      auto_prompt: false,
      callback: async (response) => {
        const res = await googleLogin(response.credential);
        if (res.ok) {
          toast("Officer session established.", "success");
          await refreshRef.current();
        } else {
          toast(res.error || "ACCESS DENIED: Invalid clearance.", "error");
        }
      },
    });
    window.google!.accounts!.id!.renderButton(containerRef.current, {
      type: "standard",
      shape: "rectangular",
      theme: "outline",
      text: "signin_with",
      size: "large",
      logo_alignment: "center",
    });
  }, [ready, toast]);

  return <div ref={containerRef} style={{ minHeight: 44 }} />;
}

// ----------------------------------------------------------------------------
// Travel Validity & Scorecard
// ----------------------------------------------------------------------------

function TravelValidityBadge({ tv }: { tv: ScreenTravelValidity }) {
  const tone = tv.status === "VALID" ? "seal" : tv.status === "EXPIRING_SOON" ? "amber" : tv.status === "EXPIRED" ? "danger" : "slate";
  return (
    <div className="module-panel" style={{ background: "var(--surface-2)", borderRadius: "var(--r-md)", padding: "10px 14px", marginTop: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="kicker kicker--plain" style={{ margin: 0 }}>Travel Validity</span>
        <Pill tone={tone}>{tv.status.replace("_", " ")}</Pill>
        {tv.days_to_expiry !== null && (
          <span className="stat-note">{tv.days_to_expiry >= 0 ? `${tv.days_to_expiry} days left` : `${Math.abs(tv.days_to_expiry)} days overdue`}</span>
        )}
        {tv.six_month_rule !== null && (
          <Pill tone={tv.six_month_rule ? "seal" : "amber"}>6-month rule: {tv.six_month_rule ? "OK" : "FAILS"}</Pill>
        )}
        {tv.age_at_crossing !== null && (
          <span className="stat-note">Holder age: {tv.age_at_crossing} yrs</span>
        )}
      </div>
      <div className="stat-note mt-2" style={{ fontSize: 12 }}>{tv.detail}</div>
    </div>
  );
}

function ModuleScorecard({ modules }: { modules: NonNullable<ScreenReport["modules"]> }) {
  const pills: { id: string; label: string; verdict: string }[] = [
    { id: "m1", label: "M1 Extract", verdict: modules.extraction.medium === "unknown" ? "UNVERIFIED" : "PASS" },
    { id: "m2", label: "M2 Validate", verdict: modules.validation.verdict },
    { id: "m3", label: "M3 Tamper", verdict: modules.tampering.verdict },
    { id: "m4", label: "M4 Face", verdict: modules.face.verdict },
  ];
  return (
    <div className="row mt-3" style={{ gap: 8, flexWrap: "wrap" }}>
      {pills.map((p) => (
        <a
          key={p.id}
          href={`#${p.id}-panel`}
          style={{ textDecoration: "none" }}
          onClick={(e) => { e.preventDefault(); document.getElementById(`${p.id}-panel`)?.scrollIntoView({ behavior: "smooth" }); }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px",
            borderRadius: "var(--r-md)",
            background: "var(--surface-2)",
            border: "1px solid var(--line-2)",
            cursor: "pointer",
            transition: "box-shadow 0.15s",
          }}>
            <span className="stat-note mono" style={{ fontSize: 11 }}>{p.label}</span>
            <Pill tone={MODULE_VERDICT_TONE[p.verdict] || "slate"} style={{ margin: 0 }}>{p.verdict}</Pill>
          </div>
        </a>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// LiveCapture — Module 4 Interactive Liveness Biometrics & Camera Selector
// ----------------------------------------------------------------------------

function LiveCapture({
  onFrame,
  onLivenessStatus,
}: {
  onFrame: (blob: Blob | null) => void;
  onLivenessStatus?: (status: LivenessStatusPayload) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // Camera devices state
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem("sih_camera_device_id") || "";
    } catch {
      return "";
    }
  });

  const refreshDevices = async (): Promise<MediaDeviceInfo[]> => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all.filter((d) => d.kind === "videoinput");
      setVideoDevices(videoInputs);
      return videoInputs;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    void refreshDevices();
    const onDeviceChange = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, []);

  // Liveness challenge state
  const [liveness, setLiveness] = useState<LivenessResult | null>(null);
  const [livenessBusy, setLivenessBusy] = useState(false);
  const [challengeIdx, setChallengeIdx] = useState(() => Math.floor(Math.random() * CHALLENGES.length));
  const [countdown, setCountdown] = useState<number | null>(null);
  const [frameProgress, setFrameProgress] = useState(0);
  const challenge = CHALLENGES[challengeIdx % CHALLENGES.length];

  const shuffleChallenge = () => {
    setChallengeIdx((prev) => {
      let next = Math.floor(Math.random() * CHALLENGES.length);
      if (next === prev) next = (prev + 1) % CHALLENGES.length;
      return next;
    });
  };

  const stop = () => {
    const v = videoRef.current;
    if (v && v.srcObject) {
      (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
    setActive(false);
  };

  const handleDeviceChange = async (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    try {
      localStorage.setItem("sih_camera_device_id", newDeviceId);
    } catch {}
    if (active) {
      await start(newDeviceId);
    }
  };

  const cycleCamera = async () => {
    if (videoDevices.length <= 1) return;
    const currentIdx = videoDevices.findIndex((d) => d.deviceId === selectedDeviceId);
    const nextIdx = (currentIdx + 1) % videoDevices.length;
    const nextDev = videoDevices[nextIdx];
    if (nextDev) {
      await handleDeviceChange(nextDev.deviceId);
    }
  };

  const start = async (deviceIdToUse?: string) => {
    const devId = deviceIdToUse || selectedDeviceId;
    stop();
    try {
      const videoConstraints: MediaTrackConstraints = devId
        ? { deviceId: { exact: devId }, width: { ideal: 640 }, height: { ideal: 480 } }
        : { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      const v = videoRef.current;
      if (!v) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      v.srcObject = stream;
      await v.play();
      setActive(true);
      setDenied(false);

      const devs = await refreshDevices();
      const activeTrack = stream.getVideoTracks()[0];
      const activeId = activeTrack?.getSettings()?.deviceId || (devs && devs[0]?.deviceId) || "";
      if (activeId) {
        setSelectedDeviceId(activeId);
        try {
          localStorage.setItem("sih_camera_device_id", activeId);
        } catch {}
      }
    } catch {
      if (devId) {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          });
          const v = videoRef.current;
          if (v) {
            v.srcObject = fallbackStream;
            await v.play();
            setActive(true);
            setDenied(false);
            const devs = await refreshDevices();
            const activeId = fallbackStream.getVideoTracks()[0]?.getSettings()?.deviceId || (devs && devs[0]?.deviceId) || "";
            if (activeId) {
              setSelectedDeviceId(activeId);
              try {
                localStorage.setItem("sih_camera_device_id", activeId);
              } catch {}
            }
            return;
          }
        } catch {}
      }
      setDenied(true);
    }
  };

  const captureManual = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      onFrame(blob);
      setImgUrl(URL.createObjectURL(blob));
      onLivenessStatus?.({ verified: false, verdict: "MANUAL_BYPASS", confidence: null });
      stop();
    }, "image/jpeg", 0.85);
  };

  const runLivenessCheck = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setLivenessBusy(true);
    setFrameProgress(0);

    for (let c = 3; c >= 1; c--) {
      setCountdown(c);
      await new Promise((r) => setTimeout(r, 700));
    }
    setCountdown(null);

    const grabFrame = (): Promise<Blob | null> =>
      new Promise((res) => {
        const c = document.createElement("canvas");
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d")?.drawImage(v, 0, 0);
        c.toBlob((b) => res(b), "image/jpeg", 0.85);
      });

    const timestamps: number[] = [];
    const frames: Blob[] = [];
    for (let i = 0; i < 3; i++) {
      const f = await grabFrame();
      if (f) {
        frames.push(f);
        timestamps.push(Date.now() + Math.floor(Math.random() * 8));
      }
      setFrameProgress(i + 1);
      if (i < 2) await new Promise((r) => setTimeout(r, 260));
    }

    const stream = v.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    const cameraLabel = track?.label || videoDevices.find((d) => d.deviceId === selectedDeviceId)?.label || "Integrated Webcam";

    const res = await verifyLiveness(frames, challenge.id, {
      camera_label: cameraLabel,
      challenge_prompt: challenge.prompt,
      timestamps,
    });

    setLivenessBusy(false);
    setFrameProgress(0);

    if (res.ok) {
      setLiveness(res.data);
      if (res.data.verdict === "LIVE" && frames.length > 0) {
        const bestFrame = frames[1] || frames[0];
        onFrame(bestFrame);
        setImgUrl(URL.createObjectURL(bestFrame));
        onLivenessStatus?.({
          verified: true,
          verdict: "LIVE",
          confidence: res.data.confidence,
        });
        stop();
      } else {
        onFrame(null);
        onLivenessStatus?.({
          verified: false,
          verdict: res.data.verdict,
          confidence: res.data.confidence,
        });
        shuffleChallenge();
      }
    }
  };

  useEffect(() => {
    return () => {
      stop();
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [imgUrl]);

  const livenessColor = liveness?.verdict === "LIVE" ? "#10b981" : "#ef4444";
  const livenessAlpha = liveness?.verdict === "LIVE" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)";
  const confidencePct = liveness ? Math.round(liveness.confidence * 100) : null;

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* Video Viewport / Biometric HUD View */}
      <div style={{
        position: "relative",
        width: 320,
        height: 240,
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        background: "#090d16",
        border: active
          ? livenessBusy
            ? "2px solid #f59e0b"
            : liveness?.verdict === "LIVE"
            ? "2px solid #10b981"
            : "2px solid #3b82f6"
          : "2px solid var(--border-seal-mid)",
        boxShadow: active ? "0 0 20px rgba(59,130,246,0.2)" : "none",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            display: active ? "block" : "none",
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />

        {imgUrl && !active && (
          <img
            src={imgUrl}
            alt="Subject biometric snapshot"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {!active && !imgUrl && (
          <div style={{ textAlign: "center", padding: 16, color: "var(--ink-3)" }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>📷</div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Webcam Inactive</div>
            <div style={{ fontSize: 10.5, marginTop: 2 }}>Click "Open Camera" to start live liveness test</div>
          </div>
        )}

        {/* ACTIVE HUD: Oval Face Target */}
        {active && (
          <div style={{
            position: "absolute",
            top: "52%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 130,
            height: 165,
            borderRadius: "50%",
            border: `2px dashed ${
              livenessBusy
                ? "#f59e0b"
                : liveness?.verdict === "LIVE"
                ? "#10b981"
                : liveness
                ? "#ef4444"
                : "rgba(59,130,246,0.7)"
            }`,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingBottom: 10,
            transition: "border-color 0.3s ease",
          }}>
            <span style={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.75)",
              textShadow: "0 1px 3px rgba(0,0,0,0.9)",
              fontFamily: "var(--font-mono)",
            }}>
              FIT FACE HERE
            </span>
          </div>
        )}

        {/* ACTIVE HUD: Top Interactive Challenge Banner OVER Webcam Feed */}
        {active && (
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "8px 10px",
            background: "linear-gradient(180deg, rgba(10,15,29,0.92) 0%, rgba(10,15,29,0.75) 80%, transparent 100%)",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            zIndex: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{
                  display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                  background: livenessBusy ? "#f59e0b" : "#10b981",
                  boxShadow: `0 0 6px ${livenessBusy ? "#f59e0b" : "#10b981"}`,
                }} />
                <span style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  color: "#fbbf24",
                  letterSpacing: "0.06em",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                }}>
                  Liveness Challenge #{challengeIdx + 1}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {videoDevices.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void cycleCamera()}
                    disabled={livenessBusy}
                    title="Switch to next camera device"
                    style={{
                      background: "rgba(255,255,255,0.14)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    🔄 Cycle Cam
                  </button>
                )}
                <button
                  type="button"
                  onClick={shuffleChallenge}
                  disabled={livenessBusy}
                  style={{
                    background: "none", border: "none", color: "#93c5fd",
                    cursor: "pointer", fontSize: 10, textDecoration: "underline",
                  }}
                >
                  Change ⟳
                </button>
              </div>
            </div>
            <div style={{
              fontSize: 11.5,
              fontWeight: 800,
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              gap: 5,
              textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            }}>
              <span style={{ fontSize: 13 }}>{challenge.icon}</span>
              <span>{challenge.prompt}</span>
            </div>
          </div>
        )}

        {/* ACTIVE HUD: 3-2-1 Countdown Overlay */}
        {countdown !== null && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
          }}>
            <div style={{
              fontSize: 54,
              fontWeight: 900,
              color: "#fbbf24",
              fontFamily: "var(--font-mono)",
              lineHeight: 1,
              animation: "livePulse 0.7s infinite alternate",
            }}>
              {countdown}
            </div>
            <div style={{ fontSize: 11, color: "#fff", marginTop: 6, fontWeight: 700, letterSpacing: "0.08em" }}>
              PERFORM CHALLENGE NOW
            </div>
          </div>
        )}

        {/* ACTIVE HUD: Frame Capture Progress */}
        {livenessBusy && countdown === null && (
          <div style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            background: "rgba(10,15,29,0.92)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "6px 10px",
            zIndex: 20,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#fbbf24", fontWeight: 700, marginBottom: 4 }}>
              <span>BURST CAPTURING (3 FRAMES)…</span>
              <span>{frameProgress}/3</span>
            </div>
            <div style={{ height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(frameProgress / 3) * 100}%`,
                background: "#f59e0b",
                transition: "width 0.2s ease",
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Camera Controls & Anti-Spoof Verdict */}
      <div style={{ flex: 1, minWidth: 260 }}>
        {videoDevices.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <label style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--ink-2)",
              marginBottom: 4,
            }}>
              <span>📹 ACTIVE CAMERA DEVICE</span>
              <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{videoDevices.length} available</span>
            </label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                className="select"
                value={selectedDeviceId}
                onChange={(e) => void handleDeviceChange(e.target.value)}
                disabled={livenessBusy}
                style={{
                  fontSize: 11.5,
                  padding: "6px 10px",
                  height: "auto",
                  flex: 1,
                  background: "var(--surface-2)",
                  border: "1px solid var(--line-2)",
                  borderRadius: "var(--r-sm)",
                  color: "var(--ink)",
                }}
              >
                {videoDevices.map((d, idx) => (
                  <option key={d.deviceId || idx} value={d.deviceId}>
                    {d.label || `Camera ${idx + 1}`}
                  </option>
                ))}
              </select>
              {videoDevices.length > 1 && (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => void cycleCamera()}
                  disabled={livenessBusy}
                  title="Switch to next camera"
                  style={{ fontSize: 11, padding: "6px 10px", flexShrink: 0 }}
                >
                  🔄 Switch
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {!active ? (
            <button
              type="button"
              className="btn btn--seal btn--sm"
              onClick={() => void start()}
            >
              🎥 Open Camera
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void runLivenessCheck()}
                disabled={livenessBusy}
                style={{
                  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                  color: "#000",
                  fontWeight: 700,
                  border: "none",
                }}
              >
                {livenessBusy ? "Verifying Liveness…" : `⚡ Run Challenge (${challenge.icon} ${challenge.id.toUpperCase()})`}
              </button>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={captureManual}
                disabled={livenessBusy}
                title="Bypass active challenge and capture current still directly"
              >
                Manual Still
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={stop}
                disabled={livenessBusy}
              >
                Close Camera
              </button>
            </>
          )}

          {imgUrl && !active && (
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => {
                setImgUrl(null);
                setLiveness(null);
                onFrame(null);
                onLivenessStatus?.({ verified: false, verdict: null, confidence: null });
              }}
            >
              Retake / Clear
            </button>
          )}
        </div>

        {denied && (
          <div style={{ fontSize: 11.5, color: "var(--danger)", padding: "6px 0" }}>
            ⚠️ Camera access denied or hardware busy. Ensure webcam permissions are granted in your browser settings.
          </div>
        )}

        {/* Liveness Result Card */}
        {liveness && (
          <div style={{
            background: livenessAlpha,
            border: `1px solid ${livenessColor}`,
            borderRadius: "var(--r-sm)",
            padding: "8px 12px",
            marginTop: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: livenessColor, fontFamily: "var(--font-mono)" }}>
                {liveness.verdict === "LIVE" ? "🛡️ LIVENESS VERIFIED" : "⚠️ LIVENESS ANOMALY"}
              </span>
              <span style={{
                fontSize: 10,
                fontWeight: 800,
                color: livenessColor,
                background: "rgba(0,0,0,0.3)",
                padding: "2px 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
              }}>
                {confidencePct !== null ? `${confidencePct}% Confidence` : ""}
              </span>
            </div>

            {liveness.verdict === "LIVE" ? (
              <div style={{ fontSize: 10.5, color: "var(--ink-2)", fontWeight: 500 }}>
                Subject passed multi-frame active challenge ({challenge.prompt}). Cleared for biometric matching.
              </div>
            ) : (
              <div style={{ fontSize: 10.5, color: "var(--ink-2)", fontWeight: 500 }}>
                Anti-spoof rejected: static replay or synthetic injection detected.
              </div>
            )}

            {/* Signal Details */}
            {liveness.checks && liveness.checks.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {liveness.checks.map((ck, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 9.5,
                      padding: "1px 6px",
                      borderRadius: 3,
                      background: ck.ok === false ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.18)",
                      color: ck.ok === false ? "#ef4444" : "#10b981",
                      border: `1px solid ${ck.ok === false ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.25)"}`,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {ck.ok === true ? "✓" : ck.ok === false ? "✗" : "—"} {ck.label}
                  </span>
                ))}
              </div>
            )}

            {liveness.verdict !== "LIVE" && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  style={{ fontSize: 10.5, width: "100%" }}
                  onClick={() => {
                    setLiveness(null);
                    shuffleChallenge();
                    if (!active) void start();
                  }}
                >
                  🔁 Try Next Challenge ({CHALLENGES[(challengeIdx + 1) % CHALLENGES.length].icon} {CHALLENGES[(challengeIdx + 1) % CHALLENGES.length].prompt})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Forensic Check Row & Deep-Dive Module Panel
// ----------------------------------------------------------------------------

interface ModuleCheckRow {
  label: string;
  ok: boolean | null;
  detail: string;
}

function ScreenCheckRow({ check }: { check: ModuleCheckRow }) {
  const tone = check.ok === true ? "pass" : check.ok === false ? "fail" : "na";
  return (
    <div className={`screen-check screen-check--${tone}`}>
      <span className="screen-check__dot" aria-hidden="true" />
      <span className="screen-check__label mono">{check.label}</span>
      <span className="screen-check__detail">{check.detail || "—"}</span>
    </div>
  );
}

function ModulePanel({
  label,
  verdict,
  tone,
  extra,
  rows,
  checks,
  heatmapB64,
  tamperingData,
}: {
  label: string;
  verdict: string;
  tone: "seal" | "amber" | "danger" | "slate";
  extra?: string;
  rows?: [string, string][];
  checks?: ModuleCheckRow[];
  heatmapB64?: string | null;
  tamperingData?: ScreenModuleTampering;
}) {
  const [heatOn, setHeatOn] = useState(false);
  const spectral = tamperingData?.spectral;
  const noise = tamperingData?.noise_consistency;
  const qa = tamperingData?.qa;
  const roi = tamperingData?.roi;

  return (
    <div className="module-panel">
      <div className="module-panel__head">
        <span className="kicker kicker--plain" style={{ margin: 0 }}>{label}</span>
        <Pill tone={tone}>{verdict}</Pill>
      </div>
      {extra && <div className="stat-note mb-2">{extra}</div>}
      {rows && (
        <div className="screen-fields" style={{ marginBottom: checks?.length ? 10 : 0 }}>
          {rows.map(([k, v]) => (
            <span className="screen-chip mono" key={k}>
              {k}: {v}
            </span>
          ))}
        </div>
      )}

      {/* Forensic Deep-Dive Metrics for M3 Tamper */}
      {tamperingData && (
        <div className="stack-sm mb-3">
          {spectral && spectral.papr !== undefined && (
            <div style={{ padding: "6px 10px", background: "var(--surface-2)", borderRadius: "var(--r-sm)", border: "1px solid var(--line-2)", fontSize: 11.5 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span><strong>2D-FFT Spectral:</strong> PAPR {spectral.papr.toFixed(1)}x</span>
                <Pill tone={spectral.spectral_anomaly ? "danger" : "seal"} style={{ margin: 0 }}>
                  {spectral.status || "NORMAL"}
                </Pill>
              </div>
              {spectral.detail && <div className="stat-note mt-1" style={{ fontSize: 11 }}>{spectral.detail}</div>}
            </div>
          )}

          {noise && noise.noise_ratio !== undefined && (
            <div style={{ padding: "6px 10px", background: "var(--surface-2)", borderRadius: "var(--r-sm)", border: "1px solid var(--line-2)", fontSize: 11.5 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span><strong>Sensor PRNU Noise:</strong> Ratio {noise.noise_ratio.toFixed(2)}x</span>
                <Pill tone={noise.consistent ? "seal" : "danger"} style={{ margin: 0 }}>
                  {noise.status || "CONSISTENT"}
                </Pill>
              </div>
              {noise.detail && <div className="stat-note mt-1" style={{ fontSize: 11 }}>{noise.detail}</div>}
            </div>
          )}

          {qa && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", fontSize: 11 }}>
              {qa.megapixels !== undefined && (
                <span className="screen-chip mono">QA: {qa.megapixels} MP ({qa.width}x{qa.height})</span>
              )}
              {qa.blur_est !== undefined && (
                <span className="screen-chip mono">Blur est: {qa.blur_est} ({qa.blurry ? "BLURRY" : "SHARP"})</span>
              )}
              {qa.overexposed && <span className="screen-chip mono" style={{ color: "#f87171" }}>OVEREXPOSED</span>}
              {qa.underexposed && <span className="screen-chip mono" style={{ color: "#f87171" }}>UNDEREXPOSED</span>}
            </div>
          )}

          {roi && roi.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
              <span className="stat-note">YOLO ROIs:</span>
              {roi.map((r, i) => (
                <span className="screen-chip mono" key={i}>
                  {r.label} ({Math.round((r.confidence || 0) * 100)}%)
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {checks && checks.length > 0 && (
        <div className="stack-sm">
          {checks.map((c, i) =>
            typeof c === "string" ? null : <ScreenCheckRow key={i} check={c} />,
          )}
        </div>
      )}
      {heatmapB64 && (
        <>
          <button type="button" className="mini-btn mt-3" onClick={() => setHeatOn((v) => !v)}>
            {heatOn ? "Hide ELA heatmap" : "Show ELA heatmap"}
          </button>
          {heatOn && (
            <img
              className="heatmap-img mt-3"
              src={`data:image/png;base64,${heatmapB64}`}
              alt="ELA heatmap"
            />
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// SUB-TABLE 1: Adjudication Queue Sub-Table
// ----------------------------------------------------------------------------

function AdjudicationQueueSubTable({
  queue,
  isSuper,
  onAdjudicate,
  onRefresh,
}: {
  queue: ScreenQueue | null;
  isSuper: boolean;
  onAdjudicate: (id: string, decision: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE", note?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [filterMode, setFilterMode] = useState<"all" | "pending" | "cleared" | "fraud">("all");
  const [search, setSearch] = useState("");
  const [adjudicateTarget, setAdjudicateTarget] = useState<{ id: string; decision: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE" } | null>(null);
  const [adjudicateNote, setAdjudicateNote] = useState("");

  const allItems = queue?.recent || [];
  const pendingItems = isSuper ? queue?.pending || [] : allItems.filter((r) => !r.adjudication && r.verdict !== "CLEAR");
  const clearedItems = allItems.filter((r) => r.adjudication === "CLEARED" || (r.verdict === "CLEAR" && !r.adjudication));
  const fraudItems = allItems.filter((r) => r.adjudication === "CONFIRMED_FRAUD" || r.verdict === "FLAGGED");

  const baseList =
    filterMode === "pending"
      ? pendingItems
      : filterMode === "cleared"
      ? clearedItems
      : filterMode === "fraud"
      ? fraudItems
      : allItems;

  const q = search.trim().toLowerCase();
  const displayed = baseList.filter((r) => {
    if (!q) return true;
    return (
      r.filename.toLowerCase().includes(q) ||
      (r.doc_type || "").toLowerCase().includes(q) ||
      (r.checkpoint || "").toLowerCase().includes(q) ||
      (r.id || "").toLowerCase().includes(q) ||
      (r.screener || "").toLowerCase().includes(q)
    );
  });

  const handleExportShift = () => {
    const today = new Date().toISOString().slice(0, 10);
    window.open(`/api/screen/shift-export?to_date=${today}`, "_blank");
  };

  return (
    <div className="subtable-container">
      <div className="subtable-topbar">
        <div className="subtable-title-area">
          <span style={{ fontSize: 20 }}>📋</span>
          <div>
            <div className="subtable-title">Adjudication Queue & Forensic Log</div>
            <div className="subtable-subtitle">
              Audit log of all checkpoint screenings with statutory HMAC-sealed court dossiers.
            </div>
          </div>
        </div>

        <div className="subtable-controls">
          <input
            className="subtable-search-input"
            placeholder="Search queue…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="seg">
            <button
              type="button"
              className={`seg__btn ${filterMode === "all" ? "seg__btn--active" : ""}`}
              onClick={() => setFilterMode("all")}
            >
              All ({allItems.length})
            </button>
            <button
              type="button"
              className={`seg__btn ${filterMode === "pending" ? "seg__btn--active" : ""}`}
              onClick={() => setFilterMode("pending")}
            >
              Pending ({pendingItems.length})
            </button>
            <button
              type="button"
              className={`seg__btn ${filterMode === "cleared" ? "seg__btn--active" : ""}`}
              onClick={() => setFilterMode("cleared")}
            >
              Cleared ({clearedItems.length})
            </button>
            <button
              type="button"
              className={`seg__btn seg__btn--danger-active ${filterMode === "fraud" ? "seg__btn--active" : ""}`}
              onClick={() => setFilterMode("fraud")}
            >
              Fraud ({fraudItems.length})
            </button>
          </div>

          <Button size="sm" variant="ghost" onClick={handleExportShift} title="Download SHA-256 sealed shift log">
            ⬇ Shift CSV
          </Button>

          <Button size="sm" variant="ghost" onClick={() => void onRefresh()} title="Reload queue data">
            ⟳ Refresh
          </Button>
        </div>
      </div>

      <div className="subtable-scroll">
        <table className="subtable">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Ref / ID</th>
              <th>Document</th>
              <th>Doc Type</th>
              <th>Checkpoint</th>
              <th>Risk Score</th>
              <th>Verdict</th>
              <th>Ledger Block</th>
              <th>Adjudication</th>
              <th style={{ textAlign: "right", minWidth: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-3)" }}>
                  {allItems.length === 0 ? "No document screenings recorded yet." : "No records match the active filter."}
                </td>
              </tr>
            ) : (
              displayed.map((r) => {
                const vm = VERDICT_META[r.verdict] || { pill: "slate" };
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="mono strong" style={{ fontSize: 11 }}>#{r.id.slice(0, 8)}…</div>
                      <div className="stat-note" style={{ fontSize: 9.5 }}>{r.created_at}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{r.filename}</div>
                      <div className="stat-note" style={{ fontSize: 10 }}>by {r.screener}</div>
                    </td>
                    <td>
                      <span className="pill pill--slate" style={{ fontSize: 9.5 }}>
                        {formatScreenDocType(r.doc_type)}
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 11 }}>{r.checkpoint || "Land Checkpoint"}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong style={{ fontSize: 13 }}>{r.risk_score}</strong>
                        <span className="stat-note" style={{ fontSize: 9.5 }}>/100</span>
                      </div>
                    </td>
                    <td>
                      <Pill tone={vm.pill}>{r.verdict}</Pill>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--seal-2)" }}>
                        {r.block_hash ? `${r.block_hash.slice(0, 10)}…` : "GENESIS"}
                      </span>
                    </td>
                    <td>
                      {r.adjudication ? (
                        <div>
                          <Pill tone={r.adjudication === "CLEARED" ? "seal" : r.adjudication === "CONFIRMED_FRAUD" ? "danger" : "amber"}>
                            {r.adjudication}
                          </Pill>
                          {r.adjudication_note && (
                            <div className="stat-note mt-1" style={{ fontSize: 9.5 }}>“{r.adjudication_note}”</div>
                          )}
                        </div>
                      ) : (
                        <Pill tone="slate">PENDING</Pill>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                        <a
                          href={getDossierUrl(r.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn--outline btn--sm"
                          style={{ textDecoration: "none", fontSize: 11, padding: "3px 8px" }}
                          title="Open statutory court dossier"
                        >
                          ⚖️ Dossier
                        </a>

                        {isSuper && (
                          <>
                            <button
                              type="button"
                              className="mini-btn"
                              style={{ color: "var(--seal-2)", borderColor: "var(--border-seal)" }}
                              onClick={() => setAdjudicateTarget({ id: r.id, decision: "CLEARED" })}
                              title="Adjudicate as CLEARED"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              className="mini-btn mini-btn--danger"
                              onClick={() => setAdjudicateTarget({ id: r.id, decision: "CONFIRMED_FRAUD" })}
                              title="Adjudicate as CONFIRMED FRAUD"
                            >
                              Fraud
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="subtable-footer">
        <div>
          Showing <strong>{displayed.length}</strong> of <strong>{allItems.length}</strong> historical screenings
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>Pending review: <strong>{pendingItems.length}</strong></span>
          <span>Fraud incidents: <strong>{fraudItems.length}</strong></span>
        </div>
      </div>

      {adjudicateTarget && (
        <Modal
          narrow
          title={`Adjudicate Screening #${adjudicateTarget.id.slice(0, 8)}…`}
          onClose={() => setAdjudicateTarget(null)}
          footer={
            <Button
              variant={adjudicateTarget.decision === "CLEARED" ? "seal" : "danger-ghost"}
              onClick={async () => {
                await onAdjudicate(adjudicateTarget.id, adjudicateTarget.decision, adjudicateNote);
                setAdjudicateTarget(null);
                setAdjudicateNote("");
              }}
            >
              Confirm {adjudicateTarget.decision}
            </Button>
          }
        >
          <Field label="Official Adjudication Note (optional)">
            <textarea
              className="textarea"
              placeholder="Enter legal observation or case justification…"
              value={adjudicateNote}
              onChange={(e) => setAdjudicateNote(e.target.value)}
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// SUB-TABLE 2: Cross-Border Syndicate Threat Monitor
// ----------------------------------------------------------------------------

function SyndicateThreatSubTable({
  data,
  busy,
  filter,
  onFilterChange,
  onRefresh,
}: {
  data: {
    alerts: Array<{ level: string; type: string; title: string; detail: string; checkpoint: string }>;
    total_screened_sample: number;
    active_alerts_count: number;
    checkpoint_filter: string;
  } | null;
  busy: boolean;
  filter: string;
  onFilterChange: (cp: string) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const alerts = data?.alerts || [];

  const q = search.trim().toLowerCase();
  const displayed = alerts.filter((a) => {
    if (!q) return true;
    return (
      a.title.toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q) ||
      a.detail.toLowerCase().includes(q) ||
      a.checkpoint.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Top Intel Overview KPIs */}
      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-card__label">Active Syndicate Alerts</span>
          <span className="kpi-card__val" style={{ color: (data?.active_alerts_count || 0) > 0 ? "var(--danger)" : "var(--seal)" }}>
            {data?.active_alerts_count || 0}
          </span>
          <span className="kpi-card__sub">Recidivism &amp; collision triggers</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Global Screenings Monitored</span>
          <span className="kpi-card__val">{data?.total_screened_sample || 0}</span>
          <span className="kpi-card__sub">Sample across all border posts</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Monitored Sectors</span>
          <span className="kpi-card__val">4 ICPs</span>
          <span className="kpi-card__sub">Raxaul · Panitanki · Jogbani · Jaigaon</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Recidivism Hash Index</span>
          <span className="kpi-card__val" style={{ color: "var(--seal-2)" }}>ONLINE</span>
          <span className="kpi-card__sub">Zero-knowledge multi-checkpoint scan</span>
        </div>
      </div>

      <div className="subtable-container">
        <div className="subtable-topbar">
          <div className="subtable-title-area">
            <span style={{ fontSize: 20 }}>🚨</span>
            <div>
              <div className="subtable-title">Cross-Border Syndicate Threat Intel</div>
              <div className="subtable-subtitle">
                Automatic correlation across Indo-Nepal &amp; Indo-Bhutan checkpoints detecting multi-post identity reuse and burst fraud.
              </div>
            </div>
          </div>

          <div className="subtable-controls">
            <input
              className="subtable-search-input"
              placeholder="Search threat alerts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="select"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              style={{ fontSize: 11.5, padding: "5px 10px", height: "auto" }}
            >
              <option value="">All Checkpoints</option>
              <option value="Raxaul ICP">Raxaul ICP (Bihar/Nepal)</option>
              <option value="Panitanki ICP">Panitanki ICP (WB/Nepal)</option>
              <option value="Jogbani ICP">Jogbani ICP (Bihar/Nepal)</option>
              <option value="Jaigaon ICP">Jaigaon ICP (WB/Bhutan)</option>
            </select>

            <Button size="sm" variant="ghost" busy={busy} onClick={onRefresh}>
              ⟳ Refresh Intel
            </Button>
          </div>
        </div>

        <div className="subtable-scroll">
          <table className="subtable">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Severity</th>
                <th style={{ width: 180 }}>Threat Type</th>
                <th style={{ width: 160 }}>Checkpoint</th>
                <th>Forensic Incident Evidence &amp; Collision Details</th>
                <th style={{ width: 180 }}>Operational Directive</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-3)" }}>
                    ✓ Zero active syndicate clusters or cross-border identity collisions detected across monitored sectors.
                  </td>
                </tr>
              ) : (
                displayed.map((a, i) => {
                  const tone = a.level === "CRITICAL" ? "danger" : a.level === "HIGH" ? "amber" : "slate";
                  return (
                    <tr key={i}>
                      <td>
                        <Pill tone={tone}>{a.level}</Pill>
                      </td>
                      <td>
                        <strong style={{ fontSize: 11.5, fontFamily: "var(--font-mono)" }}>[{a.type}]</strong>
                        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{a.title}</div>
                      </td>
                      <td>
                        <span className="mono strong" style={{ fontSize: 11.5 }}>
                          {a.checkpoint || "Cross-Border"}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>{a.detail}</div>
                      </td>
                      <td>
                        <span className="stat-note" style={{ fontSize: 10.5, color: a.level === "CRITICAL" ? "var(--danger)" : "var(--warn)" }}>
                          {a.level === "CRITICAL"
                            ? "⚠️ MANDATORY SECONDARY INTERROGATION"
                            : "PHYSICAL DOCUMENT RE-EXAMINATION"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="subtable-footer">
          <div>
            Total Active Alerts: <strong>{displayed.length}</strong>
          </div>
          <div>All incidents cryptographically referenced in immutable shift logs.</div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// SUB-TABLE 3: Hash-Only Watchlist Sub-Table
// ----------------------------------------------------------------------------

function WatchlistSubTable({
  entries,
  isSuper,
  onAdd,
  onRemove,
}: {
  entries: WatchlistEntry[];
  isSuper: boolean;
  onAdd: (category: ScreenWatchlistCategory, value: string, reason: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ScreenWatchlistCategory>("pan");
  const [val, setVal] = useState("");
  const [reason, setReason] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const q = search.trim().toLowerCase();
  const displayed = entries.filter((e) => {
    if (!q) return true;
    return (
      (e.mask || "").toLowerCase().includes(q) ||
      (e.category || "").toLowerCase().includes(q) ||
      (e.reason || "").toLowerCase().includes(q) ||
      (e.added_by || "").toLowerCase().includes(q)
    );
  });

  const handleAddSubmit = async () => {
    if (!val.trim()) return;
    setBusy(true);
    await onAdd(category, val.trim(), reason.trim());
    setBusy(false);
    setVal("");
    setReason("");
    setShowAddModal(false);
  };

  return (
    <div>
      {/* Zero-Knowledge Privacy Architecture Notice */}
      <div style={{
        background: "rgba(99, 102, 241, 0.08)",
        border: "1px solid rgba(99, 102, 241, 0.25)",
        borderRadius: "var(--r-md)",
        padding: "12px 16px",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <strong style={{ fontSize: 12, color: "var(--ink)", letterSpacing: "0.04em" }}>
            ZERO-KNOWLEDGE HASH-ONLY WATCHLIST (PRIVACY-BY-DESIGN)
          </strong>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6, margin: 0 }}>
          Border security watchlist entries are stored strictly as irreversible <strong>SHA-256 digests</strong>.
          Plaintext document numbers (PAN, Passport, DL, etc.) never persist to the database or storage disk.
          During screening, incoming documents are hashed in memory and matched against these cryptographic digests.
        </p>
      </div>

      <div className="subtable-container">
        <div className="subtable-topbar">
          <div className="subtable-title-area">
            <span style={{ fontSize: 20 }}>🛑</span>
            <div>
              <div className="subtable-title">Target Watchlist Registry</div>
              <div className="subtable-subtitle">
                {entries.length} flagged identity hashes active across all checkpoints.
              </div>
            </div>
          </div>

          <div className="subtable-controls">
            <input
              className="subtable-search-input"
              placeholder="Search watchlist…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {isSuper && (
              <Button size="sm" variant="seal" onClick={() => setShowAddModal(true)}>
                + Add Watchlist Entry
              </Button>
            )}
          </div>
        </div>

        <div className="subtable-scroll">
          <table className="subtable">
            <thead>
              <tr>
                <th style={{ width: 140 }}>Category</th>
                <th>Masked Identifier / Digest</th>
                <th>Case Reason &amp; Reference</th>
                <th>Enlisted By</th>
                <th style={{ width: 160 }}>Timestamp</th>
                {isSuper && <th style={{ textAlign: "right", width: 100 }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={isSuper ? 6 : 5} style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-3)" }}>
                    {entries.length === 0 ? "Watchlist is empty." : "No watchlist entries match that search."}
                  </td>
                </tr>
              ) : (
                displayed.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Pill tone="amber">{formatWatchlistCategory(e.category)}</Pill>
                    </td>
                    <td>
                      <span className="mono strong" style={{ fontSize: 12, color: "var(--ink)" }}>
                        {e.mask || "SHA256 HASH"}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{e.reason || "Case reference recorded"}</div>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{e.added_by}</span>
                    </td>
                    <td>
                      <span className="stat-note" style={{ fontSize: 10 }}>{e.created_at}</span>
                    </td>
                    {isSuper && (
                      <td style={{ textAlign: "right" }}>
                        <Button size="sm" variant="danger-ghost" onClick={() => void onRemove(e.id)}>
                          Remove
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="subtable-footer">
          <div>
            Showing <strong>{displayed.length}</strong> of <strong>{entries.length}</strong> watchlist digests
          </div>
          <div>Strictly zero-storage — reverse lookup mathematically impossible.</div>
        </div>
      </div>

      {showAddModal && (
        <Modal
          narrow
          title="Add Identifier to Watchlist"
          onClose={() => setShowAddModal(false)}
          footer={
            <Button variant="seal" busy={busy} disabled={!val.trim()} onClick={() => void handleAddSubmit()}>
              Enlist Hash
            </Button>
          }
        >
          <Field label="Identifier Category">
            <select
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value as ScreenWatchlistCategory)}
            >
              {SCREEN_WATCHLIST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SCREEN_WATCHLIST_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Document Identifier Value">
            <input
              className="input"
              value={val}
              placeholder={SCREEN_WATCHLIST_PLACEHOLDERS[category]}
              onChange={(e) => setVal(e.target.value)}
            />
          </Field>
          <Field label="Legal / Incident Reason">
            <input
              className="input"
              value={reason}
              placeholder="e.g. Interpol Red Notice #492 / Debit block"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <p className="stat-note mt-3" style={{ fontSize: 10.5 }}>
            Note: The identifier will be transformed into an SHA-256 cryptographic hash before entry.
          </p>
        </Modal>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// SUB-TABLE 4: Blockchain Ledger & Public Notary Sub-Table
// ----------------------------------------------------------------------------

function BlockchainLedgerSubTable({
  ledgerAnchor,
  queue,
  anchorBusy,
  onTriggerAnchor,
  onRefresh,
}: {
  ledgerAnchor: LedgerAnchorStatus | null;
  queue: ScreenQueue | null;
  anchorBusy: boolean;
  onTriggerAnchor: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [verifyResult, setVerifyResult] = useState<LedgerVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [search, setSearch] = useState("");

  const handleVerifyChain = async () => {
    setVerifying(true);
    const res = await verifyLedgerChain();
    setVerifying(false);
    if (res.ok) {
      setVerifyResult(res.data);
      if (res.data.valid) {
        toast(`Cryptographic Ledger Verified! ${res.data.total_blocks} blocks unbroken.`, "success");
      } else {
        toast(`LEDGER TAMPER ALERT: Broken at block #${res.data.broken_at}!`, "error");
      }
    } else {
      toast(res.error, "error");
    }
  };

  const allRows = [...(queue?.recent || [])].reverse(); // oldest to newest
  const q = search.trim().toLowerCase();
  const displayed = allRows.filter((r) => {
    if (!q) return true;
    return (
      (r.filename || "").toLowerCase().includes(q) ||
      (r.block_hash || "").toLowerCase().includes(q) ||
      (r.prev_hash || "").toLowerCase().includes(q) ||
      (r.id || "").toLowerCase().includes(q) ||
      (r.screener || "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Top Ledger Overview Card */}
      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-card__label">Append-Only Chain</span>
          <span className="kpi-card__val" style={{ color: "var(--seal-2)" }}>
            {verifyResult?.valid === false ? "TAMPERED" : "UNBROKEN ✓"}
          </span>
          <span className="kpi-card__sub">SHA-256 hash-chain linkage</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Total Blocks</span>
          <span className="kpi-card__val">{ledgerAnchor?.total_blocks ?? allRows.length}</span>
          <span className="kpi-card__sub">Immutable audit height</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Public Notarization</span>
          <span className="kpi-card__val" style={{ color: ledgerAnchor?.in_sync ? "#10b981" : "#f59e0b" }}>
            {ledgerAnchor?.in_sync ? "IN SYNC" : ledgerAnchor?.anchored ? "DRIFT" : "STANDBY"}
          </span>
          <span className="kpi-card__sub">{ledgerAnchor?.anchor_type || "CRYPTOGRAPHIC_NOTARY"}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Head Digest</span>
          <span className="kpi-card__val mono" style={{ fontSize: 14, color: "var(--ink-2)", wordBreak: "break-all" }}>
            {ledgerAnchor?.anchor_head_hash ? `${ledgerAnchor.anchor_head_hash.slice(0, 16)}…` : "GENESIS"}
          </span>
          <span className="kpi-card__sub">Last anchor: {ledgerAnchor?.anchored_at ? ledgerAnchor.anchored_at.slice(0, 16) : "Ready"}</span>
        </div>
      </div>

      <div className="subtable-container">
        <div className="subtable-topbar">
          <div className="subtable-title-area">
            <span style={{ fontSize: 20 }}>⛓️</span>
            <div>
              <div className="subtable-title">Immutable Blockchain Ledger Explorer</div>
              <div className="subtable-subtitle">
                Cryptographic hash-chain linking each screening event to prevent silent deletions or retro-active evidence tampering.
              </div>
            </div>
          </div>

          <div className="subtable-controls">
            <input
              className="subtable-search-input"
              placeholder="Search blocks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {ledgerAnchor?.public_url && (
              <a
                href={ledgerAnchor.public_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--outline btn--sm"
                style={{ fontSize: 11, textDecoration: "none" }}
              >
                Public Proof ↗
              </a>
            )}

            <Button size="sm" variant="ghost" busy={verifying} onClick={() => void handleVerifyChain()}>
              🔍 Audit Full Chain
            </Button>

            <Button size="sm" variant="ghost" onClick={() => void onRefresh()} title="Reload ledger data">
              ⟳ Refresh
            </Button>

            <Button size="sm" variant="seal" busy={anchorBusy} onClick={() => void onTriggerAnchor()}>
              Anchor to Public Ledger 🌐
            </Button>
          </div>
        </div>

        <div className="subtable-scroll">
          <table className="subtable">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Block #</th>
                <th>Block Hash (SHA-256)</th>
                <th>Parent Hash</th>
                <th>Screening Ref</th>
                <th>Verdict</th>
                <th>Screener &amp; Timestamp</th>
                <th style={{ textAlign: "right" }}>Integrity Status</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-3)" }}>
                    No blocks generated yet. Complete a screening to initialize the genesis block.
                  </td>
                </tr>
              ) : (
                displayed.map((r, idx) => {
                  const blockHeight = idx + 1;
                  const blockHash = r.block_hash || "GENESIS_ROOT";
                  const prevHash = r.prev_hash || "GENESIS";
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className="mono strong" style={{ fontSize: 12, color: "var(--seal)" }}>
                          #{blockHeight}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className="mono" style={{ fontSize: 11, color: "var(--ink)" }}>
                            {blockHash.slice(0, 18)}…{blockHash.slice(-6)}
                          </span>
                          <button
                            type="button"
                            className="mini-btn"
                            style={{ padding: "1px 5px", fontSize: 9 }}
                            onClick={() => void copyText(blockHash)}
                            title="Copy full SHA-256 hash"
                          >
                            Copy
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                          {prevHash === "GENESIS" ? "GENESIS" : `${prevHash.slice(0, 12)}…`}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: 11.5, fontWeight: 600 }}>{r.filename}</div>
                        <div className="stat-note" style={{ fontSize: 9.5 }}>{formatScreenDocType(r.doc_type)}</div>
                      </td>
                      <td>
                        <Pill tone={VERDICT_META[r.verdict]?.pill || "slate"}>
                          {r.verdict} ({r.risk_score}/100)
                        </Pill>
                      </td>
                      <td>
                        <div style={{ fontSize: 11 }}>{r.screener}</div>
                        <div className="stat-note" style={{ fontSize: 9.5 }}>{r.created_at}</div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className="pill pill--seal" style={{ fontSize: 9.5 }}>
                          VERIFIED ✓
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="subtable-footer">
          <div>
            Total Blocks: <strong>{displayed.length}</strong>
          </div>
          <div>Non-repudiation guaranteed by continuous parent-hash linkage.</div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// SUB-TABLE 5: Officer Directory & Roster Sub-Table
// ----------------------------------------------------------------------------

function OfficerDirectorySubTable({
  signers,
  isSuper,
  onAssignRole,
}: {
  signers: OfficerEntry[];
  isSuper: boolean;
  onAssignRole: (email: string, designation: string, institution: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleAssign, setRoleAssign] = useState<{
    email: string;
    name: string;
    designation: string;
    institution: string;
  } | null>(null);

  const q = search.trim().toLowerCase();
  const displayed = signers.filter((s) => {
    if (!q) return true;
    return (
      (s.name || "").toLowerCase().includes(q) ||
      (s.email || "").toLowerCase().includes(q) ||
      (s.designation || "").toLowerCase().includes(q) ||
      (s.institution || "").toLowerCase().includes(q)
    );
  });

  const handleAssignSubmit = async () => {
    if (!roleAssign) return;
    setBusy(true);
    await onAssignRole(roleAssign.email, roleAssign.designation, roleAssign.institution);
    setBusy(false);
    setRoleAssign(null);
  };

  return (
    <div className="subtable-container">
      <div className="subtable-topbar">
        <div className="subtable-title-area">
          <span style={{ fontSize: 20 }}>🛡️</span>
          <div>
            <div className="subtable-title">Officer Directory &amp; Roster Clearance</div>
            <div className="subtable-subtitle">
              Authorized border-screening personnel with designated checkposts and institutional clearance.
            </div>
          </div>
        </div>

        <div className="subtable-controls">
          <input
            className="subtable-search-input"
            placeholder="Search officers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="subtable-scroll">
        <table className="subtable">
          <thead>
            <tr>
              <th>Officer Name</th>
              <th>Email</th>
              <th>Designation / Post</th>
              <th>Institution</th>
              <th>Status</th>
              {isSuper && <th style={{ textAlign: "right" }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={isSuper ? 6 : 5} style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-3)" }}>
                  No officers match the filter.
                </td>
              </tr>
            ) : (
              displayed.map((s) => {
                const pending = !(s.designation && s.institution);
                return (
                  <tr key={s.email}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="authority-row__avatar" style={{ width: 30, height: 30, fontSize: 11 }}>
                          {initials(s.name)}
                        </span>
                        <strong style={{ fontSize: 13 }}>{s.name}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>{s.email}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{s.designation || "—"}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{s.institution || "—"}</span>
                    </td>
                    <td>
                      <Pill tone={pending ? "amber" : "seal"}>
                        {pending ? "PENDING" : "DUTY AUTHORIZED"}
                      </Pill>
                    </td>
                    {isSuper && (
                      <td style={{ textAlign: "right" }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setRoleAssign({
                              email: s.email,
                              name: s.name,
                              designation: s.designation || "",
                              institution: s.institution || "",
                            })
                          }
                        >
                          Assign Role
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="subtable-footer">
        <div>
          Total Officers: <strong>{displayed.length}</strong>
        </div>
        <div>SSB Police II Division Clearance Register.</div>
      </div>

      {roleAssign && (
        <Modal
          narrow
          title={`Assign Duty Post · ${roleAssign.name}`}
          onClose={() => setRoleAssign(null)}
          footer={
            <Button variant="seal" busy={busy} onClick={() => void handleAssignSubmit()}>
              Assign Clearance
            </Button>
          }
        >
          <Field label="Designation / Rank">
            <input
              className="input"
              value={roleAssign.designation}
              placeholder="e.g. Sub-Inspector / Border Screening Officer"
              onChange={(e) => setRoleAssign({ ...roleAssign, designation: e.target.value })}
            />
          </Field>
          <Field label="Institution / Checkpoint Unit">
            <input
              className="input"
              value={roleAssign.institution}
              placeholder="e.g. SSB 19th Bn — Raxaul ICP"
              onChange={(e) => setRoleAssign({ ...roleAssign, institution: e.target.value })}
            />
          </Field>
          <p className="stat-note mt-3" style={{ fontSize: 10.5 }}>
            Assigning a post clears the pending lock and allows this officer to log screenings and issue legal dossiers.
          </p>
        </Modal>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// VIEW: Focused Screening Desk (Document Intake + Liveness + Forensic Report)
// ----------------------------------------------------------------------------

function ScreeningDeskView({
  onScreenSuccess,
  isSuper,
  ledgerAnchor,
  onTriggerAnchor,
  anchorBusy,
}: {
  onScreenSuccess: (rep: ScreenReport) => void;
  isSuper: boolean;
  ledgerAnchor: LedgerAnchorStatus | null;
  onTriggerAnchor: () => Promise<void>;
  anchorBusy: boolean;
}) {
  const { toast } = useToast();

  const [file, setFile] = useState<File[]>([]);
  const [docType, setDocType] = useState<ScreenDocType>("passport");
  const [checkpoint, setCheckpoint] = useState("Raxaul ICP");
  const [docNumber, setDocNumber] = useState("");
  const [liveFrame, setLiveFrame] = useState<Blob | null>(null);
  const [liveLivenessStatus, setLiveLivenessStatus] = useState<LivenessStatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [specimenBusy, setSpecimenBusy] = useState(false);
  const [report, setReport] = useState<ScreenReport | null>(null);
  const [adjudicateNote, setAdjudicateNote] = useState("");
  const [aadhaarBoxes, setAadhaarBoxes] = useState<AadhaarFieldBox[] | null>(null);
  const [aadhaarBusy, setAadhaarBusy] = useState(false);

  const handleLoadPreset = async (preset: SpecimenPreset) => {
    try {
      setSpecimenBusy(true);
      setDocType(preset.docType);
      setCheckpoint(preset.checkpoint);
      setDocNumber(preset.docNumber);
      const stagedFile = await generateSpecimenFile(preset);
      setFile([stagedFile]);
      toast(`Loaded specimen: ${preset.title}. Click "Run screening" to verify.`, "info");
    } catch (err: any) {
      toast("Failed to generate test specimen: " + (err?.message || err), "error");
    } finally {
      setSpecimenBusy(false);
    }
  };

  const handleInspectAadhaar = async () => {
    const f = file[0];
    if (!f) {
      toast("Choose an identity document first.", "warn");
      return;
    }
    setAadhaarBusy(true);
    const res = await getAadhaarFields(f);
    setAadhaarBusy(false);
    if (res.ok) {
      setAadhaarBoxes(res.data.fields);
      toast(`Detected ${res.data.count} field zones using 5-class YOLO model.`, "info");
    } else {
      toast(res.error, "error");
    }
  };

  const run = async () => {
    const f = file[0];
    if (!f) {
      toast("Choose an identity document first.", "warn");
      return;
    }
    setBusy(true);
    const declaredMap: Record<string, string> = {};
    if (docNumber.trim()) declaredMap.declared_number = docNumber.trim();

    const res = await screenDocument(
      f,
      docType,
      checkpoint,
      Object.keys(declaredMap).length ? declaredMap : undefined,
      liveFrame || undefined,
    );
    setBusy(false);

    if (res.ok) {
      setReport(res.data);
      recordScreeningMetric(res.data.verdict);
      onScreenSuccess(res.data);
      if (res.data.verdict === "CLEAR") {
        toast("Screening CLEAR — document and biometric checks passed.", "success");
      } else if (res.data.verdict === "REVIEW") {
        toast("Screening REVIEW — human adjudication advised.", "warn");
      } else {
        toast("Screening FLAGGED — digital anomalies or watchlist hit.", "error");
      }
    } else {
      toast(res.error, "error");
    }
  };

  const adjudicate = async (decision: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE") => {
    if (!report) return;
    const res = await adjudicateScreen(report.id, decision, adjudicateNote);
    if (res.ok) {
      toast(`Adjudication saved: ${decision}.`, "success");
      const refreshReport = await getScreenReport(report.id);
      if (refreshReport.ok) setReport(refreshReport.data);
    } else {
      toast(res.error, "error");
    }
  };

  const vm = report ? VERDICT_META[report.verdict] : null;

  return (
    <div>
      {/* ── COMMAND STATUS & BLOCKCHAIN NOTARIZATION STRIP ───────────────── */}
      <div style={{
        background: "rgba(16, 185, 129, 0.08)",
        border: "1px solid rgba(16, 185, 129, 0.28)",
        borderRadius: "var(--r-md)",
        padding: "10px 14px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ fontSize: 16 }}>⛓️</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <strong style={{ color: "var(--ink)" }}>IMMUTABLE BLOCKCHAIN NOTARY:</strong>
              <span style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: "999px",
                background: ledgerAnchor?.in_sync ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)",
                color: ledgerAnchor?.in_sync ? "#10b981" : "#f59e0b",
                border: `1px solid ${ledgerAnchor?.in_sync ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"}`
              }}>
                {ledgerAnchor?.in_sync ? "IN SYNC & NOTARIZED" : (ledgerAnchor?.anchored ? "DRIFT DETECTED" : "STANDBY")}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              Blocks: {ledgerAnchor?.total_blocks ?? 0} · Head: {ledgerAnchor?.anchor_head_hash ? `${ledgerAnchor.anchor_head_hash.slice(0, 16)}…` : "GENESIS"} · {ledgerAnchor?.anchor_type || "CRYPTOGRAPHIC_NOTARY"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ledgerAnchor?.public_url && (
            <a
              href={ledgerAnchor.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--outline btn--sm"
              style={{ fontSize: 11, textDecoration: "none" }}
            >
              Public Proof ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => void onTriggerAnchor()}
            disabled={anchorBusy}
            className="btn btn--primary btn--sm"
            style={{ fontSize: 11 }}
          >
            {anchorBusy ? "Anchoring…" : "Anchor to Public Ledger 🌐"}
          </button>
        </div>
      </div>
      {/* Quick Specimen Presets Toolbar */}
      <div
        className="specimen-shelf mb-3"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--line-2)",
          borderRadius: "var(--r-md)",
          padding: "10px 14px",
        }}
      >
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span className="kicker kicker--plain" style={{ margin: 0, fontSize: 11, letterSpacing: "0.06em" }}>
            ⚡ 1-CLICK TEST SPECIMENS (PASSPORT, VISA, DL, PAN, AADHAAR):
          </span>
          <span className="stat-note" style={{ fontSize: 10.5 }}>
            {specimenBusy ? "Generating specimen canvas…" : "Click button to auto-stage benchmark test"}
          </span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {SPECIMEN_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn btn--outline btn--sm"
              style={{ fontSize: 11, padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
              disabled={busy || specimenBusy}
              onClick={() => void handleLoadPreset(p)}
              title={p.description}
            >
              <strong>{p.title}</strong>
              <span
                style={{
                  fontSize: 9.5,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: p.id.includes("tampered") || p.id.includes("syndicate") ? "rgba(239, 68, 68, 0.18)" : "rgba(16, 185, 129, 0.18)",
                  color: p.id.includes("tampered") || p.id.includes("syndicate") ? "#f87171" : "#34d399",
                  fontWeight: 600,
                }}
              >
                {p.badge}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 2-Column Workstation Grid: Intake on Left, Biometrics on Right */}
      <div className="workspace-grid mb-4">
        {/* Left Column: Document Intake */}
        <div style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
          padding: "18px 20px",
          boxShadow: "var(--shadow)",
        }}>
          <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 18 }}>📄</span>
            <div>
              <strong style={{ fontSize: 14, color: "var(--ink)" }}>Document Intake</strong>
              <div className="stat-note" style={{ fontSize: 10 }}>PDF or Photo (JPEG/PNG) · In-Memory Only</div>
            </div>
          </div>

          <div className="row-stretch mb-2">
            <Field label="Document type">
              <select
                className="select"
                value={docType}
                onChange={(e) => setDocType(e.target.value as ScreenDocType)}
              >
                {SCREEN_DOC_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {SCREEN_DOC_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Checkpoint / Office">
              <input
                className="input"
                value={checkpoint}
                placeholder="e.g. Raxaul ICP"
                onChange={(e) => setCheckpoint(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Declared number (optional matching check)">
            <input
              className="input"
              value={docNumber}
              placeholder={SCREEN_DOC_NUMBER_PLACEHOLDERS[docType]}
              onChange={(e) => setDocNumber(e.target.value)}
            />
          </Field>

          <Dropzone
            label="Drop identity document (PDF or Photo)"
            sub="Accepts PDF, JPG, PNG. Raw bytes are processed in-memory and never stored on disk."
            accept=".pdf,image/*"
            files={file}
            onFiles={(f) => setFile(f.slice(0, 1))}
            busy={busy}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={aadhaarBusy || file.length === 0}
              onClick={() => void handleInspectAadhaar()}
              title="Run YOLOv8 5-Class detector to locate Photo, Name, DOB, Aadhaar Number, and Gender zones"
            >
              🎯 {aadhaarBusy ? "Scanning Zones…" : "5-Class ID Zones"}
            </button>
            {file.length > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => { setFile([]); setAadhaarBoxes(null); }}
              >
                Clear
              </button>
            )}
          </div>

          {aadhaarBoxes && (
            <div className="mt-2 p-2" style={{ background: "var(--surface-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-sm)" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span className="kicker kicker--plain" style={{ margin: 0, fontSize: 10.5 }}>
                  🎯 YOLOv8 5-Class Field Zones ({aadhaarBoxes.length} detected)
                </span>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  style={{ fontSize: 10, padding: "2px 6px" }}
                  onClick={() => setAadhaarBoxes(null)}
                >
                  ✕
                </button>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {aadhaarBoxes.map((box, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "rgba(59, 130, 246, 0.1)",
                      border: "1px solid rgba(59, 130, 246, 0.3)",
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)"
                    }}
                  >
                    <strong style={{ color: "var(--primary)" }}>{box.label}</strong>:{" "}
                    <span>{(box.confidence * 100).toFixed(0)}%</span>{" "}
                    <span className="stat-note" style={{ fontSize: 9.5 }}>[x:{box.x.toFixed(2)}, y:{box.y.toFixed(2)}]</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Module 4 Biometric Liveness Kiosk */}
        <div style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
          padding: "18px 20px",
          boxShadow: "var(--shadow)",
        }}>
          <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 18 }}>📷</span>
            <div>
              <strong style={{ fontSize: 14, color: "var(--ink)" }}>Module 4 — Biometric Liveness Kiosk</strong>
              <div className="stat-note" style={{ fontSize: 10 }}>Active Challenge-Response · 3-Frame Burst · Anti-Spoofing</div>
            </div>
          </div>

          <LiveCapture
            onFrame={(b) => {
              setLiveFrame(b);
              if (b) toast("Holder capture attached — face will be compared.", "success");
              else {
                toast("Holder capture cleared.", "warn");
                setLiveLivenessStatus(null);
              }
            }}
            onLivenessStatus={(st) => {
              setLiveLivenessStatus(st);
              if (st.verified) {
                toast(`Liveness verified (${Math.round((st.confidence || 0.95) * 100)}% confidence). Cleared for screening.`, "success");
              } else if (st.verdict && st.verdict !== "LIVE" && st.verdict !== "MANUAL_BYPASS") {
                toast(`Liveness check failed (${st.verdict}). Retake challenge.`, "error");
              }
            }}
          />

          {liveFrame && liveLivenessStatus && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 12px",
              borderRadius: "var(--r-sm)",
              fontSize: 11.5,
              background: liveLivenessStatus.verified ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
              border: `1px solid ${liveLivenessStatus.verified ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)"}`,
              color: liveLivenessStatus.verified ? "#10b981" : "#ef4444",
              marginTop: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15 }}>{liveLivenessStatus.verified ? "🔒" : "⚠️"}</span>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {liveLivenessStatus.verified ? "Biometric Gate: PASSED & CLEARED" : `Biometric Gate: ${liveLivenessStatus.verdict || "LOCKED"}`}
                  </div>
                  <div style={{ fontSize: 10.5, opacity: 0.85 }}>
                    {liveLivenessStatus.verified ? "Live subject verified anti-spoof. Face will be matched." : "Officer must complete challenge before screening."}
                  </div>
                </div>
              </div>
              <Pill tone={liveLivenessStatus.verified ? "seal" : "danger"}>
                {liveLivenessStatus.verified ? "CLEARED" : "LOCKED"}
              </Pill>
            </div>
          )}
        </div>
      </div>

      {/* Primary Action Button */}
      <div style={{ marginBottom: 24 }}>
        <Button
          variant="seal"
          size="lg"
          style={{ width: "100%", padding: "14px 20px", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em" }}
          busy={busy}
          disabled={busy || file.length === 0 || (liveFrame !== null && liveLivenessStatus !== null && !liveLivenessStatus.verified)}
          onClick={() => void run()}
        >
          <IconBolt size={18} /> {busy ? "Executing 4-Module Forensic Pipeline…" : "Run 4-Module Forensic Screening"}
        </Button>
      </div>

      {/* ── LIVE FORENSIC INSPECTION REPORT ──────────────────────────────── */}
      {report && vm && (
        <div className={`screen-report ${vm.pill} mb-4`} data-tone={vm.pill}>
          <div className="screen-report__top">
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Pill tone={vm.pill}>{report.verdict}</Pill>
              <span className="strong" style={{ fontSize: 16 }}>
                {report.risk_score}
                <span className="stat-note"> /100 risk</span>
              </span>
              <span className="stat-note">confidence {(report.confidence * 100).toFixed(0)}%</span>
              {report.watchlist_hits && report.watchlist_hits.length > 0 && (
                <Pill tone="danger">WATCHLIST HIT</Pill>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <a
                  href={`/api/screen/dossier/${encodeURIComponent(report.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--outline btn--sm"
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: "11.5px" }}
                  title="Open tamper-evident forensic dossier (printable court record)"
                >
                  ⚖️ Statutory Court Dossier
                </a>
              </div>
            </div>
            <div className="mono stat-note" style={{ marginTop: 6 }}>
              {formatScreenDocType(report.doc_type)} · {report.checkpoint || "Land Checkpoint"} · {report.created_at}
            </div>
          </div>

          <div className="risk-meter mt-3">
            <span className={`risk-meter__fill risk-meter__fill--${vm.pill}`} style={{ width: `${report.risk_score}%` }} />
          </div>

          {/* Syndicate Alert Banner */}
          {report.syndicate_alerts && report.syndicate_alerts.length > 0 && (
            <div className="syndicate-alert-banner mt-3" style={{ background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.4)", borderRadius: 6, padding: "10px 14px" }}>
              <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>🚨</span>
                <strong style={{ color: "#f87171", fontFamily: "var(--font-mono)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Cross-Border Syndicate Alert ({report.syndicate_alerts.length})
                </strong>
              </div>
              {report.syndicate_alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 12, color: "#fecaca", marginTop: 4, paddingLeft: 8, borderLeft: "2px solid #ef4444" }}>
                  <strong>[{a.type}] {a.title}:</strong> {a.detail}
                </div>
              ))}
            </div>
          )}

          {/* Module Scorecard */}
          {report.modules && <ModuleScorecard modules={report.modules} />}

          {/* Travel Validity */}
          {report.travel_validity && report.travel_validity.status !== "UNKNOWN" && (
            <TravelValidityBadge tv={report.travel_validity} />
          )}

          {/* Masked PII Fields */}
          {report.masked_fields && (
            <div className="screen-fields mt-3">
              {Object.entries(report.masked_fields)
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => (
                  <span className="screen-chip mono" key={k}>
                    {MASKED_FIELD_LABELS[k] || k.replace(/_/g, " ").toUpperCase()}:{" "}
                    {formatMaskedFieldValue(v)}
                  </span>
                ))}
            </div>
          )}

          {/* Explainable Reasons */}
          {Array.isArray(report.reasons) && report.reasons.length > 0 && (
            <ul className="screen-reasons mt-3">
              {report.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          {/* 4 Deep-Dive Module Panels */}
          {report.modules && (
            <div className="screen-modules mt-4">
              <div className="screen-modules__grid">
                <div id="m1-panel">
                  <ModulePanel
                    label="M1 Extract"
                    tone={report.modules.extraction.medium === "unknown" ? "slate" : "seal"}
                    verdict={report.modules.extraction.medium === "unknown" ? "UNVERIFIED" : "PASS"}
                    rows={[
                      ["medium", report.modules.extraction.medium],
                      ["mrz", report.modules.extraction.mrz ? (report.modules.extraction.mrz.valid ? "valid" : "INVALID") : "not extracted"],
                      ["ocr", report.modules.extraction.ocr?.ran ? "read" : report.modules.extraction.ocr?.reason || "skipped"],
                      ["document-aware", report.modules.extraction.document_aware === null ? "n/a" : report.modules.extraction.document_aware ? "yes" : "no"],
                    ]}
                  />
                </div>
                <div id="m2-panel">
                  <ModulePanel
                    label="M2 Validate"
                    tone={MODULE_VERDICT_TONE[report.modules.validation.verdict] || "slate"}
                    verdict={report.modules.validation.verdict}
                    checks={report.modules.validation.checks}
                  />
                </div>
                <div id="m3-panel">
                  <ModulePanel
                    label="M3 Tamper"
                    tone={MODULE_VERDICT_TONE[report.modules.tampering.verdict] || "slate"}
                    verdict={report.modules.tampering.verdict}
                    extra={
                      report.modules.tampering.ela
                        ? `ELA Δ ${report.modules.tampering.ela.mean_diff?.toFixed(3) ?? "—"}`
                        : undefined
                    }
                    checks={report.modules.tampering.checks}
                    heatmapB64={report.modules.tampering.heatmap_b64}
                    tamperingData={report.modules.tampering}
                  />
                </div>
                <div id="m4-panel">
                  <ModulePanel
                    label="M4 Face"
                    tone={MODULE_VERDICT_TONE[report.modules.face.verdict] || "slate"}
                    verdict={report.modules.face.verdict}
                    extra={`${report.modules.face.method} · ${report.modules.face.match === null ? "no capture" : report.modules.face.match ? "match" : "mismatch"}`}
                    checks={report.modules.face.checks}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Adjudication Toolbar */}
          {isSuper && (
            <div className="mt-3" style={{ borderTop: "1px dashed var(--line-2)", paddingTop: 12 }}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Button size="sm" variant="seal" onClick={() => void adjudicate("CLEARED")}>
                  Clear
                </Button>
                <Button size="sm" variant="danger-ghost" onClick={() => void adjudicate("CONFIRMED_FRAUD")}>
                  Confirm fraud
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void adjudicate("INCONCLUSIVE")}>
                  Inconclusive
                </Button>
                <input
                  className="input"
                  style={{ maxWidth: 280, flex: 1 }}
                  placeholder="Adjudication note…"
                  value={adjudicateNote}
                  onChange={(e) => setAdjudicateNote(e.target.value)}
                />
              </div>
              {report.adjudication && (
                <p className="stat-note mt-3">
                  Adjudicated <strong>{report.adjudication}</strong> by {report.adjudicator}
                  {report.adjudication_note ? ` — “${report.adjudication_note}”` : ""} at {report.adjudicated_at}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// MAIN EXPORT: AuthorityView with Clean Sub-Navigation & Segregated Sub-Tables
// ----------------------------------------------------------------------------

export function AuthorityView() {
  const { signedIn, booting, me } = useAuth();
  const { toast } = useToast();
  const isSuper = !!me?.is_super_admin;

  // Active Sub-Nav Tab
  const [tab, setTab] = useState<AuthorityTab>("desk");

  // Shared Data across tabs
  const [queue, setQueue] = useState<ScreenQueue | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [signers, setSigners] = useState<OfficerEntry[]>([]);
  const [ledgerAnchor, setLedgerAnchor] = useState<LedgerAnchorStatus | null>(null);
  const [anchorBusy, setAnchorBusy] = useState(false);

  const [syndicateData, setSyndicateData] = useState<{
    alerts: Array<{ level: string; type: string; title: string; detail: string; checkpoint: string }>;
    total_screened_sample: number;
    active_alerts_count: number;
    checkpoint_filter: string;
  } | null>(null);
  const [syndicateBusy, setSyndicateBusy] = useState(false);
  const [syndicateFilter, setSyndicateFilter] = useState("");

  const loadQueue = async () => {
    const res = await getScreenQueue();
    if (res.ok) setQueue(res.data);
  };

  const loadWatchlist = async () => {
    if (!isSuper) return;
    const res = await getWatchlist();
    if (res.ok) setWatchlist(res.data.entries);
  };

  const loadSigners = async () => {
    if (!isSuper) return;
    const res = await getSigners();
    if (res.ok) setSigners(res.data.signers);
  };

  const loadSyndicate = async (cp?: string) => {
    setSyndicateBusy(true);
    const res = await getSyndicateAlerts(cp);
    setSyndicateBusy(false);
    if (res.ok) setSyndicateData(res.data);
  };

  const loadLedgerAnchor = async () => {
    const res = await getLedgerAnchor();
    if (res.ok) setLedgerAnchor(res.data);
  };

  useEffect(() => {
    if (signedIn && me) {
      void loadQueue();
      void loadSyndicate();
      void loadLedgerAnchor();
      if (isSuper) {
        void loadWatchlist();
        void loadSigners();
      }
    }
  }, [signedIn, me, isSuper]);

  const handleTriggerAnchor = async () => {
    setAnchorBusy(true);
    const res = await triggerLedgerAnchor();
    setAnchorBusy(false);
    if (res.ok) {
      toast(`Anchored Block #${res.data.total_blocks} (${res.data.anchor_type}). Public non-repudiation verified!`, "success");
      void loadLedgerAnchor();
    } else {
      toast(res.error, "error");
    }
  };

  const handleAdjudicateFromQueue = async (
    id: string,
    decision: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE",
    note?: string,
  ) => {
    const res = await adjudicateScreen(id, decision, note || "");
    if (res.ok) {
      toast(`Adjudication saved: ${decision}.`, "success");
      await loadQueue();
    } else {
      toast(res.error, "error");
    }
  };

  const handleAddWatchlist = async (category: ScreenWatchlistCategory, val: string, reason: string) => {
    const res = await addWatchlistEntry(category, val, reason);
    if (res.ok) {
      toast(`Added hash to ${SCREEN_WATCHLIST_LABELS[category]} watchlist.`, "success");
      await loadWatchlist();
    } else {
      toast(res.error, "error");
    }
  };

  const handleRemoveWatchlist = async (id: number) => {
    const res = await removeWatchlistEntry(id);
    if (res.ok) {
      toast("Watchlist hash removed.", "success");
      await loadWatchlist();
    } else {
      toast(res.error, "error");
    }
  };

  const handleAssignRole = async (email: string, designation: string, institution: string) => {
    const res = await assignRole(email, designation, institution);
    if (res.ok) {
      toast(`Role assigned to ${email}.`, "success");
      await loadSigners();
    } else {
      toast(res.error, "error");
    }
  };

  if (booting) {
    return (
      <div className="section">
        <EmptyNote>Checking your officer clearance…</EmptyNote>
      </div>
    );
  }

  if (!signedIn || !me) {
    return (
      <section className="section" style={{ maxWidth: 560, margin: "0 auto" }}>
        <Card title="Restricted access" icon={<IconLock size={14} />}>
          <div style={{ textAlign: "center", padding: "22px 10px" }}>
            <p style={{ color: "var(--ink-2)", marginBottom: 22 }}>
              Authenticate with an authorized Google account to reach the border screening
              console, duty watchlist, and role approvals.
            </p>
            <div className="hero__kicker" style={{ display: "inline-flex" }}>
              <span className="dot" aria-hidden="true" /> Google single sign-in
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
              <GoogleSignInButton />
            </div>
            <p className="stat-note mt-4">
              Screening duty is assigned only by an administrator — desk access is never self-claimed.
            </p>
          </div>
        </Card>
      </section>
    );
  }

  const pendingQueueCount = queue?.pending.length || 0;
  const alertCount = syndicateData?.active_alerts_count || 0;
  const watchlistCount = watchlist.length;
  const totalBlocks = ledgerAnchor?.total_blocks ?? (queue?.recent.length || 0);

  return (
    <section className="section">
      {/* ── COMMAND CONSOLE HEADER ────────────────────────────────────────── */}
      <div className="section__head rv">
        <div>
          <Kicker>SSB Border Screening Command Console</Kicker>
          <h2>AI-Based Fake Identity &amp; Document Screening Desk</h2>
        </div>
        <p>
          {me.name} — session active.{" "}
          {me.is_super_admin
            ? "Supervisor clearance."
            : me.pending_approval
            ? "Your screening role is pending approval."
            : "Duty post authorized."}
        </p>
      </div>

      {me.pending_approval && (
        <div className="rv rv--d2 mb-3">
          <Card title="Role pending approval" icon={<IconKey size={14} />}>
            <EmptyNote>
              <span className="big">Screening is temporarily blocked</span>
              <br />
              An administrator must assign your post &amp; institution before you can screen documents
              or adjudicate results.
            </EmptyNote>
          </Card>
        </div>
      )}

      {/* ── SUB-NAV TAB BAR WITH LIVE METRIC BADGES ───────────────────────── */}
      <nav className="sub-nav-bar rv rv--d1" aria-label="Console sub-navigation">
        <button
          type="button"
          className={`sub-tab-btn ${tab === "desk" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("desk")}
        >
          <span>🎯</span>
          <span>Screening Desk</span>
        </button>

        <button
          type="button"
          className={`sub-tab-btn ${tab === "queue" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("queue")}
        >
          <span>📋</span>
          <span>Adjudication Queue</span>
          {pendingQueueCount > 0 ? (
            <span className="sub-tab-badge sub-tab-badge--amber">{pendingQueueCount}</span>
          ) : (
            <span className="sub-tab-badge sub-tab-badge--slate">{queue?.recent.length || 0}</span>
          )}
        </button>

        <button
          type="button"
          className={`sub-tab-btn ${tab === "syndicate" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("syndicate")}
        >
          <span>🚨</span>
          <span>Syndicate Monitor</span>
          {alertCount > 0 && (
            <span className="sub-tab-badge sub-tab-badge--danger">{alertCount}</span>
          )}
        </button>

        {isSuper && (
          <button
            type="button"
            className={`sub-tab-btn ${tab === "watchlist" ? "sub-tab-btn--active" : ""}`}
            onClick={() => setTab("watchlist")}
          >
            <span>🛑</span>
            <span>Watchlist</span>
            <span className="sub-tab-badge sub-tab-badge--slate">{watchlistCount}</span>
          </button>
        )}

        <button
          type="button"
          className={`sub-tab-btn ${tab === "ledger" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("ledger")}
        >
          <span>⛓️</span>
          <span>Blockchain Ledger</span>
          <span className="sub-tab-badge sub-tab-badge--seal">#{totalBlocks}</span>
        </button>

        {isSuper && (
          <button
            type="button"
            className={`sub-tab-btn ${tab === "admin" ? "sub-tab-btn--active" : ""}`}
            onClick={() => setTab("admin")}
          >
            <span>🛡️</span>
            <span>Officer Roster</span>
            <span className="sub-tab-badge sub-tab-badge--slate">{signers.length}</span>
          </button>
        )}

        <button
          type="button"
          className={`sub-tab-btn ${tab === "notices" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("notices")}
        >
          <span>📢</span>
          <span>Bulletins</span>
        </button>
      </nav>

      {/* ── TAB CONTENT ROUTING ───────────────────────────────────────────── */}
      <div className="rv rv--d2">
        {tab === "desk" && (
          <ScreeningDeskView
            onScreenSuccess={async () => {
              await loadQueue();
              await loadSyndicate();
              await loadLedgerAnchor();
            }}
            isSuper={isSuper}
            ledgerAnchor={ledgerAnchor}
            onTriggerAnchor={handleTriggerAnchor}
            anchorBusy={anchorBusy}
          />
        )}

        {tab === "queue" && (
          <AdjudicationQueueSubTable
            queue={queue}
            isSuper={isSuper}
            onAdjudicate={handleAdjudicateFromQueue}
            onRefresh={loadQueue}
          />
        )}

        {tab === "syndicate" && (
          <SyndicateThreatSubTable
            data={syndicateData}
            busy={syndicateBusy}
            filter={syndicateFilter}
            onFilterChange={(cp) => {
              setSyndicateFilter(cp);
              void loadSyndicate(cp);
            }}
            onRefresh={() => void loadSyndicate(syndicateFilter)}
          />
        )}

        {tab === "watchlist" && isSuper && (
          <WatchlistSubTable
            entries={watchlist}
            isSuper={isSuper}
            onAdd={handleAddWatchlist}
            onRemove={handleRemoveWatchlist}
          />
        )}

        {tab === "ledger" && (
          <BlockchainLedgerSubTable
            ledgerAnchor={ledgerAnchor}
            queue={queue}
            anchorBusy={anchorBusy}
            onTriggerAnchor={handleTriggerAnchor}
            onRefresh={async () => {
              await loadLedgerAnchor();
              await loadQueue();
            }}
          />
        )}

        {tab === "admin" && isSuper && (
          <OfficerDirectorySubTable
            signers={signers}
            isSuper={isSuper}
            onAssignRole={handleAssignRole}
          />
        )}

        {tab === "notices" && (
          <NoticeBoard />
        )}
      </div>

      <div style={{ height: 24 }} />
    </section>
  );
}