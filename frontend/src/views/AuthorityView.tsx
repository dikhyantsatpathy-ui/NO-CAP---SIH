// ============================================================================
// AuthorityView — the screening console (SSB border inspection / SIH26188):
// Google Single Sign-In gate, the 4-module screening desk, adjudication queue,
// cross-border syndicate monitor, watchlist, officer bulletin, and (super-admin)
// role approvals. The signing/ledger/anchor capabilities were removed.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import {
  adjudicateScreen,
  addWatchlistEntry,
  assignRole,
  getAadhaarFields,
  getDossierUrl,
  getScreenQueue,
  getScreenReport,
  getSigners,
  getSyndicateAlerts,
  getWatchlist,
  googleLogin,
  removeWatchlistEntry,
  SCREEN_DOC_LABELS,
  SCREEN_DOC_NUMBER_PLACEHOLDERS,
  SCREEN_DOC_TYPES,
  SCREEN_WATCHLIST_CATEGORIES,
  SCREEN_WATCHLIST_LABELS,
  SCREEN_WATCHLIST_PLACEHOLDERS,
  screenDocument,
  verifyLiveness,
  type AadhaarFieldBox,
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
import { initials } from "../app/util";
import {
  Button,
  Card,
  Dropzone,
  EmptyNote,
  Field,
  IconBolt,
  IconKey,
  IconLock,
  IconPen,
  IconUsers,
  Kicker,
  Modal,
  Pill,
  useGsiReady,
} from "../components/ui";
import { FALLBACK_CLIENT_ID } from "./gsi";
import { NoticeBoard } from "../components/NoticeBoard";

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
// Officer directory & role approvals (super-admin only)
// ----------------------------------------------------------------------------

function OfficerDirectory() {
  const { toast } = useToast();
  const [signers, setSigners] = useState<OfficerEntry[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleAssign, setRoleAssign] = useState<{
    email: string;
    name: string;
    designation: string;
    institution: string;
  } | null>(null);

  const load = async () => {
    const res = await getSigners();
    if (res.ok) setSigners(res.data.signers);
  };

  useEffect(() => {
    void load();
  }, []);

  const submitAssign = async () => {
    if (!roleAssign) return;
    setBusy(true);
    const res = await assignRole(roleAssign.email, roleAssign.designation, roleAssign.institution);
    if (res.ok) {
      toast(`Role assigned to ${roleAssign.email}.`, "success");
      setRoleAssign(null);
      setSigners((prev) =>
        prev.map((s) =>
          s.email === roleAssign.email
            ? { ...s, designation: roleAssign.designation, institution: roleAssign.institution }
            : s,
        ),
      );
    } else {
      toast(res.error, "error");
    }
    setBusy(false);
  };

  const q = query.trim().toLowerCase();
  const filtered = signers.filter((s) => {
    if (!q) return true;
    return [s.name, s.email, s.designation, s.institution].some((v) =>
      (v || "").toLowerCase().includes(q),
    );
  });

  return (
    <Card
      title="Officers & roles"
      icon={<IconUsers size={14} />}
      aside={<span className="stat-note">Role approvals — supervisor clearance</span>}
    >
      <p className="stat-note" style={{ fontSize: 12, marginBottom: 12 }}>
        Every officer account is authorized here before it can screen at a checkpoint. Accounts
        without an assigned post &amp; institution are blocked from screening.
      </p>
      <div className="dir-toolbar">
        <input
          className="input dir-search"
          placeholder="Search name, email, designation, institution…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter officer directory"
        />
        <span className="dir-count">
          {filtered.length} / {signers.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <EmptyNote>
          {signers.length === 0 ? "No officers have signed in yet." : "No officers match that filter."}
        </EmptyNote>
      ) : (
        <div className="dir-scroll">
          {filtered.map((s) => {
            const pending = !(s.designation && s.institution);
            return (
              <div key={s.email} className="authority-row">
                <span className="authority-row__avatar">{initials(s.name)}</span>
                <div className="authority-row__info">
                  <div className="authority-row__name">
                    {s.name}
                    {pending ? (
                      <Pill tone="amber" style={{ marginLeft: 8 }}>pending</Pill>
                    ) : (
                      <Pill tone="seal" style={{ marginLeft: 8 }}>approved</Pill>
                    )}
                  </div>
                  <div className="authority-row__id">{s.email}</div>
                  <div className="authority-row__key">
                    {s.designation || "—"} · {s.institution || "—"}
                  </div>
                </div>
                <div className="authority-row__actions">
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
                    Role
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {roleAssign && (
        <Modal
          narrow
          title={`Assign role · ${roleAssign.name}`}
          onClose={() => setRoleAssign(null)}
          footer={
            <Button variant="seal" busy={busy} onClick={() => void submitAssign()}>
              Assign
            </Button>
          }
        >
          <Field label="Designation">
            <input
              className="input"
              value={roleAssign.designation}
              placeholder="e.g. Emergency Response Officer"
              onChange={(e) => setRoleAssign({ ...roleAssign, designation: e.target.value })}
            />
          </Field>
          <Field label="Institution">
            <input
              className="input"
              value={roleAssign.institution}
              placeholder="e.g. National Disaster Authority"
              onChange={(e) => setRoleAssign({ ...roleAssign, institution: e.target.value })}
            />
          </Field>
          <p className="stat-note mt-3" style={{ margin: "12px 0 0" }}>
            Assigning a role clears the pending block and lets this officer screen documents at
            checkpoints.
          </p>
        </Modal>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Screening desk — MHA SIH26188: AI-Based Fake Identity & Document Screening
// Upload -> Extract -> Analyze -> Verify -> Assess Risk, human-in-the-loop.
// ----------------------------------------------------------------------------

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

// ---- Feature 2: 4-pill Module Scorecard -----------------------------------
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

// ---------------------------------------------------------------------------
// Challenge constants — cycled round-robin for each liveness test
// ---------------------------------------------------------------------------
const CHALLENGES: { id: string; prompt: string; icon: string; hint: string }[] = [
  { id: "blink",   prompt: "Blink naturally",        icon: "👁️",  hint: "Blink both eyes once" },
  { id: "nod",     prompt: "Nod your head slowly",   icon: "↕️",  hint: "Move head up, then down" },
  { id: "turn",    prompt: "Turn head slightly left", icon: "↩️",  hint: "Rotate 10–20° left" },
];

/** Multi-round challenge-response live capture for Module 4 anti-spoofing. */
function LiveCapture({ onFrame }: { onFrame: (blob: Blob | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // Liveness challenge state
  const [liveness, setLiveness] = useState<LivenessResult | null>(null);
  const [livenessBusy, setLivenessBusy] = useState(false);
  const [challengeIdx, setChallengeIdx] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);   // 3-2-1 before burst
  const [frameProgress, setFrameProgress] = useState(0);            // 0-3 frames captured
  const challenge = CHALLENGES[challengeIdx % CHALLENGES.length];

  const stop = () => {
    const v = videoRef.current;
    if (v && v.srcObject) {
      (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
    setActive(false);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      const v = videoRef.current;
      if (!v) { stream.getTracks().forEach((t) => t.stop()); return; }
      v.srcObject = stream;
      await v.play();
      setActive(true);
      setDenied(false);
    } catch {
      setDenied(true);
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      onFrame(blob);
      setImgUrl(URL.createObjectURL(blob));
      stop();
    }, "image/jpeg", 0.85);
  };

  /** 3-frame burst with countdown UI, then POST to /api/screen/liveness */
  const runLivenessCheck = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setLivenessBusy(true);
    setFrameProgress(0);

    // 3-2-1 countdown
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
      if (f) { frames.push(f); timestamps.push(Date.now()); }
      setFrameProgress(i + 1);
      if (i < 2) await new Promise((r) => setTimeout(r, 280));
    }

    const stream = v.srcObject as MediaStream | null;
    const cameraLabel = stream?.getVideoTracks()[0]?.label || "Integrated Webcam";

    const res = await verifyLiveness(frames, challenge.id, {
      camera_label: cameraLabel,
      challenge_prompt: challenge.prompt,
      timestamps,
    });

    setLivenessBusy(false);
    setFrameProgress(0);

    if (res.ok) {
      setLiveness(res.data);
      // Auto-advance to next challenge on failure so officer can retry different action
      if (res.data.verdict !== "LIVE") {
        setChallengeIdx((i) => i + 1);
      }
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stop();
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgUrl]);

  const livenessColor = liveness?.verdict === "LIVE" ? "#10b981" : "#ef4444";
  const livenessAlpha = liveness?.verdict === "LIVE" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)";
  const confidencePct = liveness ? Math.round(liveness.confidence * 100) : null;

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* Camera / snapshot */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <video
          ref={videoRef}
          playsInline muted
          style={{
            display: active ? "block" : "none",
            width: 160, height: 112,
            borderRadius: "var(--r-sm)",
            background: "#000",
            objectFit: "cover",
            border: active ? "2px solid var(--primary)" : undefined,
          }}
        />
        {/* Countdown overlay */}
        {countdown !== null && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "var(--r-sm)",
            background: "rgba(0,0,0,0.55)",
            fontSize: 38, fontWeight: 800, color: "#fff",
            pointerEvents: "none",
            fontFamily: "var(--font-mono)",
          }}>
            {countdown}
          </div>
        )}
        {imgUrl && (
          <img
            src={imgUrl}
            alt="holder capture"
            style={{
              width: 160, height: 112,
              borderRadius: "var(--r-sm)",
              objectFit: "cover",
              border: "2px solid var(--border-seal-mid)",
            }}
          />
        )}
      </div>

      {/* Controls column */}
      <div className="stack-sm" style={{ flex: 1, minWidth: 180 }}>
        <span className="stat-note" style={{ fontWeight: 600 }}>Module 4 — Live Holder Capture</span>

        {/* Challenge badge (shown when camera is active) */}
        {active && !liveness && (
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(99,102,241,0.3)",
            borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 600,
          }}>
            <span style={{ fontSize: 16 }}>{challenge.icon}</span>
            <div>
              <div style={{ color: "var(--ink)" }}>{challenge.prompt}</div>
              <div className="stat-note" style={{ fontSize: 10.5 }}>{challenge.hint}</div>
            </div>
          </div>
        )}

        {/* Frame capture progress bar */}
        {livenessBusy && (
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
            <span>Capturing frame {frameProgress}/3…</span>
            <div style={{ marginTop: 4, height: 4, background: "var(--surface-3)", borderRadius: 2 }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${(frameProgress / 3) * 100}%`,
                background: "var(--primary)",
                transition: "width 0.25s ease",
              }} />
            </div>
          </div>
        )}

        {/* Buttons */}
        {!active && !imgUrl && (
          <Button size="sm" variant={denied ? "danger-ghost" : "ghost"} onClick={() => void start()}>
            {denied ? "Camera blocked — retry" : "📷 Open camera"}
          </Button>
        )}
        {active && (
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <Button size="sm" variant="seal" onClick={capture}>
              Capture frame
            </Button>
            <Button
              size="sm"
              variant="ghost"
              busy={livenessBusy}
              onClick={() => void runLivenessCheck()}
              title="3-frame burst: detect printed-photo replay, virtual-camera injection, and motion dynamics"
            >
              {livenessBusy ? "Running…" : "🔍 Liveness test"}
            </Button>
          </div>
        )}
        {imgUrl && (
          <Button size="sm" variant="ghost" onClick={() => {
            onFrame(null);
            setImgUrl(null);
            setLiveness(null);
            void start();
          }}>
            ↩ Retake
          </Button>
        )}

        {/* Liveness result */}
        {liveness && (
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: livenessColor,
            background: livenessAlpha,
            border: `1px solid ${livenessColor}33`,
            padding: "6px 10px",
            borderRadius: 6,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 14 }}>
                {liveness.verdict === "LIVE" ? "✅" : "⚠️"}
              </span>
              <span>
                {liveness.verdict === "LIVE"
                  ? "LIVE HUMAN CONFIRMED"
                  : `${liveness.verdict} DETECTED`}
                {confidencePct !== null && (
                  <span style={{ fontWeight: 400, color: "var(--ink-3)", marginLeft: 6 }}>
                    {confidencePct}% confidence
                  </span>
                )}
              </span>
            </div>
            {liveness.verdict !== "LIVE" && (
              <div style={{ fontWeight: 400, fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
                Try again with challenge: <strong>{CHALLENGES[(challengeIdx) % CHALLENGES.length].prompt}</strong>
              </div>
            )}
            {/* Per-check detail */}
            {liveness.checks && liveness.checks.length > 0 && (
              <div style={{ marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {liveness.checks.slice(0, 4).map((ck, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 10, padding: "1px 5px",
                      borderRadius: 3,
                      background: ck.ok === false ? "rgba(239,68,68,0.2)" : "rgba(0,0,0,0.15)",
                      color: "inherit",
                    }}
                  >
                    {ck.ok === true ? "✓" : ck.ok === false ? "✗" : "—"} {ck.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Retry challenge link */}
        {liveness && liveness.verdict !== "LIVE" && active && (
          <button
            type="button"
            className="btn btn--outline btn--sm"
            style={{ fontSize: 10.5 }}
            onClick={() => { setLiveness(null); setChallengeIdx((i) => i + 1); }}
          >
            Next challenge →
          </button>
        )}
      </div>
    </div>
  );
}

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

const MASKED_FIELD_LABELS: Record<string, string> = {
  pan: "PAN",
  passport: "PASSPORT",
  driving_licence: "DRIVING LICENCE",
  voter_id: "VOTER ID",
  phone: "PHONE",
  dob: "DOB",
  expiry: "EXPIRY",
  mrz_name: "MRZ NAME",
  mrz_valid: "MRZ CHECK DIGITS",
  mrz_passport_ck: "MRZ DOCUMENT CHECK",
  mrz_dob_ck: "MRZ DOB CHECK",
  mrz_expiry_ck: "MRZ EXPIRY CHECK",
};

function formatMaskedFieldValue(value: string | boolean | null) {
  if (typeof value === "boolean") return value ? "valid" : "INVALID";
  return String(value);
}

function formatScreenDocType(docType: string) {
  if ((SCREEN_DOC_TYPES as readonly string[]).includes(docType)) {
    return SCREEN_DOC_LABELS[docType as ScreenDocType];
  }
  return docType.replace(/_/g, " ").toUpperCase();
}

function formatWatchlistCategory(category: string | null) {
  if (!category) return "—";
  if ((SCREEN_WATCHLIST_CATEGORIES as readonly string[]).includes(category)) {
    return SCREEN_WATCHLIST_LABELS[category as ScreenWatchlistCategory];
  }
  return category.replace(/_/g, " ").toUpperCase();
}

export function ScreeningDesk() {
  const { me } = useAuth();
  const { toast } = useToast();
  const isSuper = !!me?.is_super_admin;

  const [file, setFile] = useState<File[]>([]);
  const [docType, setDocType] = useState<ScreenDocType>("passport");
  const [checkpoint, setCheckpoint] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [liveFrame, setLiveFrame] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [specimenBusy, setSpecimenBusy] = useState(false);
  const [report, setReport] = useState<ScreenReport | null>(null);
  const [queue, setQueue] = useState<ScreenQueue | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [adjudicateNote, setAdjudicateNote] = useState("");
  const [wlCategory, setWlCategory] = useState<ScreenWatchlistCategory>("pan");
  const [wlValue, setWlValue] = useState("");
  const [wlReason, setWlReason] = useState("");
  const [syndicateData, setSyndicateData] = useState<{
    alerts: Array<{ level: string; type: string; title: string; detail: string; checkpoint: string }>;
    total_screened_sample: number;
    active_alerts_count: number;
    checkpoint_filter: string;
  } | null>(null);
  const [syndicateBusy, setSyndicateBusy] = useState(false);
  const [syndicateFilter, setSyndicateFilter] = useState("");
  const [aadhaarBoxes, setAadhaarBoxes] = useState<AadhaarFieldBox[] | null>(null);
  const [aadhaarBusy, setAadhaarBusy] = useState(false);

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

  const loadQueue = async () => {
    const res = await getScreenQueue();
    if (res.ok) setQueue(res.data);
  };
  const loadWatchlist = async () => {
    if (!isSuper) return;
    const res = await getWatchlist();
    if (res.ok) setWatchlist(res.data.entries);
  };
  const loadSyndicate = async (cp?: string) => {
    setSyndicateBusy(true);
    const res = await getSyndicateAlerts(cp);
    setSyndicateBusy(false);
    if (res.ok) setSyndicateData(res.data);
  };

  useEffect(() => {
    void loadQueue();
    void loadWatchlist();
    void loadSyndicate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  const run = async () => {
    const f = file[0];
    if (!f) {
      toast("Choose a document file to screen.", "warn");
      return;
    }
    setBusy(true);
    const declared: Record<string, string> = {};
    if (docNumber.trim()) declared.document_number = docNumber.trim();
    const res = await screenDocument(f, docType, checkpoint.trim(), declared, liveFrame);
    setBusy(false);
    if (res.ok) {
      setReport(res.data);
      recordScreeningMetric(res.data.verdict);
      toast(
        `Screen complete — ${res.data.verdict} (risk ${res.data.risk_score}/100).`,
        res.data.verdict === "FLAGGED" ? "error" : res.data.verdict === "REVIEW" ? "warn" : "success",
      );
      void loadQueue();
      void loadSyndicate(checkpoint.trim());
    } else {
      toast(res.error, "error");
    }
  };

  const adjudicate = async (id: string, decision: string) => {
    const res = await adjudicateScreen(id, decision, adjudicateNote);
    if (res.ok) {
      toast(`Adjudicated ${decision}.`, "success");
      setAdjudicateNote("");
      void loadQueue();
      // mirror the decision onto the visible report card immediately.
      // The detail endpoint returns a queue-shaped summary, so merge its
      // adjudication metadata into the full screening result instead of
      // replacing the modules, reasons, travel, and syndicate sections.
      void getScreenReport(id).then((r) => {
        if (!r.ok) return;
        setReport((prev) =>
          prev && prev.id === r.data.id ? { ...prev, ...r.data } : r.data,
        );
      });
    } else {
      toast(res.error, "error");
    }
  };

  const addWl = async () => {
    if (!wlValue.trim()) {
      toast("Enter an identifier value.", "warn");
      return;
    }
    const res = await addWatchlistEntry(wlCategory, wlValue, wlReason);
    if (res.ok) {
      toast(res.data.already ? "Already on the watchlist." : `Watchlisted ${res.data.mask}.`, "success");
      setWlValue("");
      setWlReason("");
      void loadWatchlist();
    } else {
      toast(res.error, "error");
    }
  };

  const removeWl = async (id: number) => {
    const res = await removeWatchlistEntry(id);
    if (res.ok) {
      toast("Entry removed.", "success");
      void loadWatchlist();
    } else {
      toast(res.error, "error");
    }
  };

  const vm = report && VERDICT_META[report.verdict];

  return (
    <Card title="SSB Identity & Document Screening Desk (SIH26188)" icon={<IconLock size={14} />}>

      {/* ── SYSTEM GUIDE BANNER ───────────────────────────────────────────── */}
      <div style={{
        background: "rgba(99, 102, 241, 0.08)",
        border: "1px solid rgba(99, 102, 241, 0.25)",
        borderRadius: "var(--r-md)",
        padding: "12px 16px",
        marginBottom: 16,
      }}>
        <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 15 }}>🛂</span>
          <strong style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink)" }}>
            WHAT THIS SYSTEM DOES
          </strong>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.65, margin: 0 }}>
          This desk runs a <strong>4-module forensic pipeline</strong> on any identity document you upload (Passport, Driving Licence, PAN card, Voter ID, or Visa).
          It extracts text from the document automatically, checks whether the document's data is valid, looks for digital tampering, and compares the
          portrait photo with a live camera capture of the person standing in front of you — all in one click.
          The result is a risk score (0–100) and a verdict of <strong>CLEAR</strong>, <strong>REVIEW</strong>, or <strong>FLAGGED</strong>.
          Administrators can then formally adjudicate the result, and a tamper-evident court dossier is available for legal proceedings.
        </p>
      </div>

      {/* ── MODULE EXPLANATION CARDS ──────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 8,
        marginBottom: 16,
      }}>
        {([
          { id: "M1", icon: "📄", title: "Extract (OCR/MRZ)", desc: "Reads all text from the document — the printed fields, the machine-readable zone (MRZ) at the bottom of passports, and any declared numbers. Nothing is stored." },
          { id: "M2", icon: "✔️", title: "Validate (Format/Expiry)", desc: "Checks that dates are not expired, check-digits in the MRZ are correct, the document number format matches the type, and the identity is not on the watchlist." },
          { id: "M3", icon: "🔬", title: "Tamper Detection (Forensic)", desc: "Runs 3 forensic tests: Error Level Analysis (ELA) finds re-saved JPEG regions, 2D-FFT finds unnatural pixel patterns, and PRNU Noise checks if the portrait was digitally spliced in." },
          { id: "M4", icon: "📷", title: "Face Match (Live Capture)", desc: "If you open the camera and capture the person's face, it is compared with the portrait on the document. This detects impostors using someone else's genuine document." },
        ] as const).map((m) => (
          <div key={m.id} style={{
            background: "var(--surface-2)",
            border: "1px solid var(--line-2)",
            borderRadius: "var(--r-sm)",
            padding: "10px 12px",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
              <span>{m.icon}</span>
              <span style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{m.id}</span>
              <span>{m.title}</span>
            </div>
            <p style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.55, margin: 0 }}>{m.desc}</p>
          </div>
        ))}
      </div>

      {/* 1-Click SIH26188 Benchmark Specimens */}
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
            ⚡ 1-CLICK TEST SPECIMENS (PASSPORT, VISA, DL, PAN):
          </span>
          <span className="stat-note" style={{ fontSize: 10.5 }}>
            {specimenBusy ? "Generating specimen canvas…" : "Click button to auto-stage document"}
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

      <div className="row-stretch">
        <Field label="Document type">
          <select
            className="select"
            value={docType}
            aria-label="Screening document type"
            onChange={(e) => setDocType(e.target.value as ScreenDocType)}
          >
            {SCREEN_DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {SCREEN_DOC_LABELS[d]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Checkpoint / office">
          <input
            className="input"
            value={checkpoint}
            placeholder="e.g. IGI Delhi — T2 Arrival"
            onChange={(e) => setCheckpoint(e.target.value)}
          />
        </Field>
        <Field label="Declared number (optional)">
          <input
            className="input"
            value={docNumber}
            placeholder={SCREEN_DOC_NUMBER_PLACEHOLDERS[docType]}
            aria-label={`${SCREEN_DOC_LABELS[docType]} declared number`}
            onChange={(e) => setDocNumber(e.target.value)}
          />
        </Field>
      </div>

      <Dropzone
        label="Drop the identity document (PDF or photo)"
        sub="Accepts PDF or photo (JPEG/PNG). Raw bytes are processed in-memory and never stored to disk."
        accept=".pdf,image/*"
        files={file}
        onFiles={(f) => setFile(f.slice(0, 1))}
        busy={busy}
      />

      <div className="mt-3" style={{ borderTop: "1px dashed var(--line-2)", paddingTop: 12 }}>
        <p style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 8 }}>
          <strong>Module 4 — Live face capture (optional):</strong> Open the camera, point it at the person's face, and click "Capture frame".
          The system will compare this photo with the portrait on the document. Skip this step if the person is not physically present.
        </p>
        <LiveCapture
          onFrame={(b) => {
            setLiveFrame(b);
            if (b) toast("Holder capture attached — face will be compared.", "success");
            else toast("Holder capture cleared.", "warn");
          }}
        />
      </div>

      {!file.length && !busy && (
        <EmptyNote className="mt-3">
          <span className="big">Nothing staged</span>
          <br />
          Drop a document above to run the screening checks.
        </EmptyNote>
      )}

      {file.length > 0 && (
        <>
          <div className="row mt-3" style={{ gap: 8 }}>
            <Button
              variant="seal"
              style={{ flex: 1 }}
              busy={busy}
              onClick={() => void run()}
            >
              <IconBolt size={15} /> {busy ? "Screening…" : "Run screening"}
            </Button>
            <button
              type="button"
              className="btn btn--outline"
              disabled={aadhaarBusy}
              onClick={() => void handleInspectAadhaar()}
              title="Run YOLOv8 5-Class detector to locate Photo, Name, DOB, Aadhaar Number, and Gender zones"
            >
              🎯 {aadhaarBusy ? "Scanning Zones…" : "5-Class ID Zones"}
            </button>
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
                  Clear
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
                    <span className="stat-note" style={{ fontSize: 10 }}>[x:{box.x.toFixed(2)}, y:{box.y.toFixed(2)}, w:{box.w.toFixed(2)}, h:{box.h.toFixed(2)}]</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {report && vm && (
        <div className={`screen-report ${vm.pill}`} data-tone={vm.pill}>
          <div className="screen-report__top">
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Pill tone={vm.pill}>{report.verdict}</Pill>
              <span className="strong">
                {report.risk_score}
                <span className="stat-note"> /100 risk</span>
              </span>
              <span className="stat-note">confidence {(report.confidence * 100).toFixed(0)}%</span>
              {report.watchlist_hits && report.watchlist_hits.length > 0 && (
                <Pill tone="danger">watchlist hit</Pill>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <a
                  href={`/api/screen/dossier/${encodeURIComponent(report.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--outline btn--sm"
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: "11px" }}
                  aria-label="Court dossier"
                  title="Open tamper-evident forensic dossier (printable record)"
                >
                  ⚖️ Court Dossier
                </a>
              </div>
            </div>
            <div className="mono stat-note" style={{ marginTop: 6 }}>
              {formatScreenDocType(report.doc_type)} · {report.checkpoint || "no checkpoint"} · {report.created_at}
            </div>
          </div>

          <div className="risk-meter mt-3">
            <span className={`risk-meter__fill risk-meter__fill--${vm.pill}`} style={{ width: `${report.risk_score}%` }} />
          </div>

          {/* Syndicate & Cross-Border Recidivism Alert Banner */}
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

          {/* Feature 2: Module Scorecard */}
          {report.modules && <ModuleScorecard modules={report.modules} />}

          {/* Feature 1: Travel Validity */}
          {report.travel_validity && report.travel_validity.status !== "UNKNOWN" && (
            <TravelValidityBadge tv={report.travel_validity} />
          )}

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

          {Array.isArray(report.reasons) && report.reasons.length > 0 && (
            <ul className="screen-reasons mt-3">
              {report.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

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

          {isSuper && (
            <div className="mt-3" style={{ borderTop: "1px dashed var(--line-2)", paddingTop: 12 }}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Button size="sm" variant="seal" onClick={() => void adjudicate(report.id, "CLEARED")}>
                  Clear
                </Button>
                <Button size="sm" variant="danger-ghost" onClick={() => void adjudicate(report.id, "CONFIRMED_FRAUD")}>
                  Confirm fraud
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void adjudicate(report.id, "INCONCLUSIVE")}>
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

      {/* Cross-Border Syndicate Threat Intel Monitor */}
      <div className="mt-4" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 14 }}>
        <p style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 10 }}>
          <strong>Cross-Border Syndicate Monitor:</strong> This panel automatically analyses all recent screenings across checkpoints
          to detect organised fraud patterns — the same identity used at multiple border posts, a cluster of suspicious documents
          from the same origin, or an individual who has been flagged repeatedly. It refreshes every time you run a new screening.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="kicker">🚨 Cross-Border Syndicate Threat Intel</span>
            <span className="stat-note">
              {syndicateData?.active_alerts_count || 0} active alert{(syndicateData?.active_alerts_count || 0) === 1 ? "" : "s"} · {syndicateData?.total_screened_sample || 0} global passes analyzed
            </span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <select
              className="select"
              value={syndicateFilter}
              onChange={(e) => {
                setSyndicateFilter(e.target.value);
                void loadSyndicate(e.target.value);
              }}
              style={{ fontSize: 11, padding: "2px 6px", height: 28 }}
            >
              <option value="">All Checkpoints</option>
              <option value="Raxaul ICP">Raxaul ICP (Bihar/Nepal)</option>
              <option value="Panitanki ICP">Panitanki ICP (WB/Nepal)</option>
              <option value="Jogbani ICP">Jogbani ICP (Bihar/Nepal)</option>
              <option value="Jaigaon ICP">Jaigaon ICP (WB/Bhutan)</option>
            </select>
            <Button size="sm" variant="ghost" busy={syndicateBusy} onClick={() => void loadSyndicate(syndicateFilter)}>
              Refresh
            </Button>
          </div>
        </div>

        {syndicateData && syndicateData.alerts.length > 0 ? (
          <div className="queue-scroll mt-3">
            {syndicateData.alerts.map((a, i) => (
              <div
                key={i}
                className="queue-row"
                style={{
                  borderLeft: `3px solid ${a.level === "CRITICAL" ? "#ef4444" : a.level === "HIGH" ? "#f59e0b" : "#38bdf8"}`,
                  background: a.level === "CRITICAL" ? "rgba(239, 68, 68, 0.06)" : undefined,
                }}
              >
                <div>
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <Pill tone={a.level === "CRITICAL" ? "danger" : a.level === "HIGH" ? "amber" : "slate"}>
                      {a.level}
                    </Pill>
                    <span className="mono strong" style={{ fontSize: 11 }}>[{a.type}]</span>
                    <strong style={{ fontSize: 12 }}>{a.title}</strong>
                  </div>
                  <div className="stat-note mt-1" style={{ fontSize: 11.5 }}>
                    {a.detail}
                  </div>
                </div>
                <Pill tone="slate">{a.checkpoint || "Cross-Border"}</Pill>
              </div>
            ))}
          </div>
        ) : (
          <div className="stat-note mt-2" style={{ padding: "8px 12px", background: "var(--surface-2)", borderRadius: "var(--r-sm)" }}>
            ✓ No active syndicate clusters, identity clashes, or sector bursts detected across monitored checkpoints.
          </div>
        )}
      </div>

      {queue && (queue.pending.length > 0 || queue.recent.length > 0) && (
        <div className="mt-4" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 14 }}>
          <p style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 10 }}>
            <strong>Screening Queue:</strong> Every document screening is logged here. Items marked <em>pending</em> need a supervisor
            decision — click <strong>Clear</strong> if the document checks out, or <strong>Fraud</strong> to flag it for escalation.
            A court-admissible dossier (PDF) is available for each entry via the ⚖️ button.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="kicker">Screening queue</span>
            <span className="stat-note">
              {queue.pending.length} pending adjudication{queue.pending.length === 1 ? "" : "s"} · {queue.recent.length} recent
            </span>
            {isSuper && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Export shift log"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  window.open(`/api/screen/shift-export?to_date=${today}`, "_blank");
                }}
              >
                ⬇ Export shift log
              </Button>
            )}
          </div>
          <div className="queue-scroll mt-3">
            {(isSuper ? queue.pending : []).map((r) => (
              <div className="queue-row" key={r.id}>
                <div>
                  <span className="mono" style={{ fontSize: 11.5 }}>{r.filename}</span>
                  <br />
                  <span className="stat-note">
                    {formatScreenDocType(r.doc_type)} · risk {r.risk_score}/100 · {r.created_at}
                  </span>
                </div>
                <div className="row" style={{ gap: 5 }}>
                  <a
                    href={getDossierUrl(r.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--outline btn--sm"
                    style={{ textDecoration: "none", fontSize: 11, padding: "2px 7px" }}
                    title="Open statutory court dossier"
                  >
                    ⚖️ Dossier
                  </a>
                  <Pill tone={VERDICT_META[r.verdict]?.pill || "slate"}>{r.verdict}</Pill>
                  {isSuper && (
                    <>
                      <Button size="sm" variant="seal" onClick={() => void adjudicate(r.id, "CLEARED")}>Clear</Button>
                      <Button size="sm" variant="danger-ghost" onClick={() => void adjudicate(r.id, "CONFIRMED_FRAUD")}>Fraud</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!isSuper &&
              queue.recent.map((r) => (
                <div className="queue-row" key={r.id}>
                  <div>
                    <span className="mono" style={{ fontSize: 11.5 }}>{r.filename}</span>
                    <br />
                    <span className="stat-note">
                      {formatScreenDocType(r.doc_type)} · risk {r.risk_score}/100 · {r.created_at}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 5 }}>
                    <a
                      href={getDossierUrl(r.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn--outline btn--sm"
                      style={{ textDecoration: "none", fontSize: 11, padding: "2px 7px" }}
                      title="Open statutory court dossier"
                    >
                      ⚖️ Dossier
                    </a>
                    <Pill tone={VERDICT_META[r.verdict]?.pill || "slate"}>{r.verdict}</Pill>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {isSuper && (
        <div className="mt-4" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 14 }}>
          <p style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 10 }}>
            <strong>Watchlist (Administrators only):</strong> Add any identifier (PAN number, Passport number, phone, etc.)
            that should trigger an automatic flag during screening. The system stores only a cryptographic hash of the value —
            the actual number is never saved to disk and cannot be reversed. Every new screening automatically checks against this list.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="kicker">Watchlist</span>
            <span className="stat-note">hash-only — raw identifiers never stored</span>
          </div>
          <div className="row-stretch mt-3">
            <Field label="Category">
              <select
                className="select"
                value={wlCategory}
                aria-label="Watchlist identifier category"
                onChange={(e) => setWlCategory(e.target.value as ScreenWatchlistCategory)}
              >
                {SCREEN_WATCHLIST_CATEGORIES.map((d) => (
                  <option key={d} value={d}>
                    {SCREEN_WATCHLIST_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Identifier value">
              <input
                className="input"
                value={wlValue}
                placeholder={SCREEN_WATCHLIST_PLACEHOLDERS[wlCategory]}
                aria-label={`${SCREEN_WATCHLIST_LABELS[wlCategory]} watchlist value`}
                onChange={(e) => setWlValue(e.target.value)}
              />
            </Field>
            <Field label="Reason">
              <input className="input" value={wlReason} placeholder="e.g. Debit blocked in fraud case 23/xx" onChange={(e) => setWlReason(e.target.value)} />
            </Field>
          </div>
          <Button variant="seal" size="sm" className="mt-3" disabled={!wlValue.trim()} onClick={() => void addWl()}>
            <IconPen size={13} /> Add to watchlist
          </Button>

          <div className="queue-scroll mt-3">
            {watchlist.map((e) => (
              <div className="queue-row" key={e.id}>
                <div>
                  <span className="mono" style={{ fontSize: 11.5 }}>{e.mask || e.category}</span>
                  <br />
                  <span className="stat-note">
                    {formatWatchlistCategory(e.category)} · {e.reason || "no reason"} · by {e.added_by}
                  </span>
                </div>
                <Button size="sm" variant="danger-ghost" onClick={() => void removeWl(e.id)}>
                  Remove
                </Button>
              </div>
            ))}
            {watchlist.length === 0 && <EmptyNote>Watchlist is empty.</EmptyNote>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------
// The view
// ----------------------------------------------------------------------------

export function AuthorityView() {
  const { signedIn, booting, me } = useAuth();

  if (booting) {
    return (
      <div className="section">
        <EmptyNote>Checking your officer session…</EmptyNote>
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

  return (
    <section className="section">
      <div className="section__head rv">
        <div>
          <Kicker>SSB border screening console</Kicker>
          <h2>AI-based fake identity &amp; document screening desk</h2>
        </div>
        <p>
          {me.name} — session active.{" "}
          {me.is_super_admin ? "Supervisor clearance." : me.pending_approval ? "Your screening role is pending approval." : "Duty post authorized."}
        </p>
      </div>

      {me.pending_approval && (
        <div className="rv rv--d2">
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

      <div className="rv rv--d2">
        <ScreeningDesk />
      </div>

      {me.is_super_admin && (
        <div className="rv rv--d3 mt-4">
          <OfficerDirectory />
        </div>
      )}

      <div className="rv rv--d4 mt-4">
        <NoticeBoard />
      </div>

      <div style={{ height: 16 }} />
    </section>
  );
}