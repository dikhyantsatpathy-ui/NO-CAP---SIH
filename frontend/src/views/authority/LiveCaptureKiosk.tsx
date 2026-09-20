// ============================================================================
// LiveCaptureKiosk.tsx — Module 4 Biometric Liveness & Interactive Camera HUD
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { CHALLENGES, type LivenessStatusPayload } from "./types";
import { verifyLiveness, type LivenessResult } from "../../api";
import { Button } from "../../components/ui";

export function LiveCaptureKiosk({
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
    const onDeviceChange = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, []);

  // Liveness challenge state
  const [liveness, setLiveness] = useState<LivenessResult | null>(null);
  const [livenessBusy, setLivenessBusy] = useState(false);
  const [challengeIdx, setChallengeIdx] = useState(() =>
    Math.floor(Math.random() * CHALLENGES.length)
  );
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
            const activeId =
              fallbackStream.getVideoTracks()[0]?.getSettings()?.deviceId ||
              (devs && devs[0]?.deviceId) ||
              "";
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
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        onFrame(blob);
        setImgUrl(URL.createObjectURL(blob));
        onLivenessStatus?.({ verified: false, verdict: "MANUAL_BYPASS", confidence: null });
        stop();
      },
      "image/jpeg",
      0.85
    );
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
        c.width = v.videoWidth;
        c.height = v.videoHeight;
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
    const cameraLabel =
      track?.label ||
      videoDevices.find((d) => d.deviceId === selectedDeviceId)?.label ||
      "Integrated Border Checkpoint Sensor";

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
  const confidencePct = liveness ? Math.round(liveness.confidence * 100) : null;

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* Video Viewport / Biometric HUD View */}
      <div
        style={{
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
        }}
      >
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
            alt="Biometric still capture"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {/* Reticle / Face Guidance Oval */}
        {active && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: 140,
                height: 180,
                border: "2px dashed rgba(255,255,255,0.45)",
                borderRadius: "50%",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)",
              }}
            />
          </div>
        )}

        {/* Countdown overlay during challenge execution */}
        {countdown !== null && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 54,
                fontWeight: 900,
                fontFamily: "var(--mono)",
                color: "#f59e0b",
                textShadow: "0 0 20px rgba(245,158,11,0.8)",
              }}
            >
              {countdown}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "#fff",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Executing: {challenge.prompt}
            </span>
          </div>
        )}

        {/* Multi-frame progress banner */}
        {frameProgress > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 12,
              right: 12,
              background: "rgba(0,0,0,0.8)",
              borderRadius: "var(--r-sm)",
              padding: "4px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              zIndex: 10,
            }}
          >
            <span className="stat-note mono" style={{ color: "#f59e0b", fontSize: 10 }}>
              ANALYZING FRAMES ({frameProgress}/3)
            </span>
            <div
              style={{
                display: "flex",
                gap: 4,
              }}
            >
              {[1, 2, 3].map((f) => (
                <div
                  key={f}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: f <= frameProgress ? "#f59e0b" : "rgba(255,255,255,0.2)",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {!active && !imgUrl && (
          <div
            style={{
              textAlign: "center",
              padding: 16,
              color: "var(--ink-3)",
            }}
          >
            <span style={{ fontSize: 32, display: "block", marginBottom: 6 }}>📷</span>
            <span className="mono" style={{ fontSize: 11, fontWeight: 600, display: "block" }}>
              BIOMETRIC KIOSK STANDBY
            </span>
            <span style={{ fontSize: 10 }}>Ready for checkpoint enrollment</span>
          </div>
        )}
      </div>

      {/* Control Deck */}
      <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Device selector dropdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label
              className="stat-note mono"
              style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em" }}
            >
              INPUT SENSOR ({videoDevices.length} DETECTED)
            </label>
            {videoDevices.length > 1 && (
              <button
                type="button"
                className="action-btn-sm"
                onClick={cycleCamera}
                title="Switch to next camera"
              >
                🔄 Switch
              </button>
            )}
          </div>
          <select
            className="subtable-search-input"
            style={{ width: "100%", padding: "5px 8px", fontSize: 11 }}
            value={selectedDeviceId}
            onChange={(e) => void handleDeviceChange(e.target.value)}
          >
            {videoDevices.length === 0 ? (
              <option value="">Default System Webcam</option>
            ) : (
              videoDevices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera Sensor #${i + 1}`}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Interactive Challenge Prompt Card */}
        <div
          style={{
            padding: "8px 12px",
            background: "var(--surface-2)",
            border: "1px solid var(--line-2)",
            borderRadius: "var(--r-sm)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              className="stat-note mono"
              style={{ fontSize: 10, color: "var(--ink-2)", fontWeight: 700 }}
            >
              ACTIVE LIVENESS CHALLENGE
            </span>
            <button
              type="button"
              className="action-btn-sm"
              style={{ fontSize: 9.5, padding: "2px 6px" }}
              onClick={shuffleChallenge}
              disabled={livenessBusy}
            >
              🎲 New Prompt
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            <span style={{ fontSize: 18 }}>{challenge.icon}</span>
            <span>{challenge.prompt}</span>
          </div>
          <div className="stat-note mt-1" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
            {challenge.hint}
          </div>
        </div>

        {/* Buttons Deck */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!active ? (
            <Button
              type="button"
              variant="seal"
              onClick={() => void start()}
              disabled={denied}
              style={{ fontSize: 11 }}
            >
              {imgUrl ? "Recapture Biometrics" : "Initialize Camera"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ink"
                onClick={() => void runLivenessCheck()}
                disabled={livenessBusy}
                style={{ fontSize: 11 }}
              >
                {livenessBusy ? "Analyzing Challenge…" : "Run Liveness Challenge"}
              </Button>
              <button
                type="button"
                className="action-btn-sm"
                onClick={captureManual}
                title="Bypass interactive challenge and take single still"
              >
                Single Still
              </button>
              <button type="button" className="action-btn-sm" onClick={stop}>
                Stop
              </button>
            </>
          )}
        </div>

        {/* Liveness Verification Result Banner */}
        {liveness && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: "var(--r-sm)",
              border: `1px solid ${livenessColor}`,
              background: liveness.verdict === "LIVE" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              fontSize: 11.5,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, color: livenessColor }}>
                {liveness.verdict === "LIVE" ? "✓ LIVENESS CONFIRMED" : "✗ LIVENESS FAILED"}
              </span>
              {confidencePct !== null && (
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: livenessColor }}>
                  {confidencePct}% CONFIDENCE
                </span>
              )}
            </div>
            <div className="stat-note mt-1" style={{ fontSize: 10.5 }}>
              {liveness.signals?.join(" · ") || (liveness.liveness_passed ? "Multi-frame liveness verified." : "Biometric motion failed challenge threshold.")}
            </div>
          </div>
        )}

        {denied && (
          <div className="stat-note" style={{ color: "var(--danger)", fontSize: 11 }}>
            Camera permission denied or device busy. Check browser security settings.
          </div>
        )}
      </div>
    </div>
  );
}
