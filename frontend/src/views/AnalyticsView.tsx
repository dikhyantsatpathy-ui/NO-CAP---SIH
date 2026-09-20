// ============================================================================
// AnalyticsView — Analytics dashboard: scope stats, verdict breakdown, engine
// timing, AI-detector quota and the last few screenings on the desk.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  getScreenQueue,
  type ScreenReport,
} from "../api";
import { useAnalyticsSummary } from "../app/analyticsCache";
import { getLocalMetrics, getSessionMetrics, useAuth } from "../app/state";
import { timeLabel } from "../app/util";
import { BarChart, HBarChart, type BarDatum } from "../components/Charts";
import {
  Card,
  CountUp,
  EmptyNote,
  IconBar,
  IconCheck,
  IconClock,
  IconGrid,
  IconShield,
  Kicker,
  Pill,
} from "../components/ui";

type Scope = "session" | "local" | "global";

const SCOPE_META: Record<Scope, { title: string; subtitle: string; badge: string }> = {
  session: {
    title: "Session",
    subtitle: "Counts from this browser tab only",
    badge: "Session",
  },
  local: {
    title: "This device",
    subtitle: "All checks run on this browser, across tabs and visits",
    badge: "Local",
  },
  global: {
    title: "Network-wide",
    subtitle: "All screenings recorded across the network",
    badge: "Global",
  },
};

const VERDICT_CONFIG: Record<
  string,
  {
    label: string;
    name: string;
    chips: string[];
    statusNote: string;
    color: string;
    tone: "seal" | "danger" | "amber" | "slate";
  }
> = {
  AUTHENTIC: {
    label: "Authentic",
    name: "Authentic",
    chips: ["Checks passed", "Face match OK", "No tampering"],
    statusNote: "Screening checks agree",
    color: "var(--seal-2)",
    tone: "seal",
  },
  PROVEN_FAKE: {
    label: "Proven fake",
    name: "Proven fake",
    chips: ["Rollback residue", "Synthetic noise", "Altered headers"],
    statusNote: "Flagged — fails the checks",
    color: "var(--danger)",
    tone: "danger",
  },
  REVOKED: {
    label: "Revoked",
    name: "Revoked",
    chips: ["Retracted by authority", "Kept on record"],
    statusNote: "Notice was cancelled",
    color: "var(--warn)",
    tone: "amber",
  },
  UNSIGNED: {
    label: "Not screened",
    name: "Not screened",
    chips: ["No screening record", "Submitted for desk"],
    statusNote: "Nothing links it to a decision yet",
    color: "var(--slate)",
    tone: "slate",
  },
};

export function AnalyticsView() {
  const { signedIn } = useAuth();
  const [scope, setScope] = useState<Scope>("global");
  // Dashboard numbers come from the site-wide cache: prefetched once at load,
  // so this tab opens instantly, then refreshed live (mount + 30s + tab focus).
  const summary = useAnalyticsSummary(30000);
  const global = summary?.analytics ?? null;
  const usage = summary?.usage ?? null;
  const [recent, setRecent] = useState<ScreenReport[]>([]);
  const [recentReady, setRecentReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setRecentReady(false);
    if (!signedIn) {
      setRecent([]);
      setRecentReady(true);
      return () => {
        alive = false;
      };
    }
    // The "recent" strip renders 7 rows — fetch them from the screening queue.
    getScreenQueue().then((q) => {
      if (alive) {
        setRecent(q.ok ? (q.data.recent || []) : []);
        setRecentReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const loading = !summary || !recentReady;

  const counts = useMemo(() => {
    if (scope === "session") return getSessionMetrics();
    if (scope === "local") return getLocalMetrics();
    return global?.stats || { AUTHENTIC: 0, PROVEN_FAKE: 0, REVOKED: 0, UNSIGNED: 0 };
  }, [scope, global]);

  const total = useMemo(
    () => Object.values(counts).reduce((a, b) => a + (b || 0), 0),
    [counts],
  );

  const bars: BarDatum[] = useMemo(
    () =>
      (["AUTHENTIC", "PROVEN_FAKE", "REVOKED", "UNSIGNED"] as const).map((k) => {
        const conf = VERDICT_CONFIG[k];
        return { label: conf.label, value: counts[k] || 0, color: conf.color };
      }),
    [counts],
  );

  const latencyBars: BarDatum[] = useMemo(() => {
    const l = global?.latency;
    if (!l) return [];
    return [
      { label: "Fastest", value: l.min_ms, color: "var(--seal-2)" },
      { label: "Average", value: l.avg_ms, color: "var(--seal)" },
      { label: "Slowest", value: l.max_ms, color: "var(--warn)" },
    ];
  }, [global]);

  const aiTotal = Object.values(global?.providers || {}).reduce((a, b) => a + (b || 0), 0);
  const model = usage?.model || "genai";

  // Distribution shares
  const authenticShare = total ? ((counts.AUTHENTIC || 0) / total) * 100 : 0;
  const provenFakeShare = total ? ((counts.PROVEN_FAKE || 0) / total) * 100 : 0;
  const revokedShare = total ? ((counts.REVOKED || 0) / total) * 100 : 0;
  const unsignedShare = total ? ((counts.UNSIGNED || 0) / total) * 100 : 0;

  return (
    <section className="section analytics-page">
      {/* ---------------------------------------------------- Hero Header */}
      <div className="section__head rv">
        <div>
          <Kicker>Analytics</Kicker>
          <h2>Screening statistics</h2>
        </div>
        <p>
          How many documents have been screened, what the checks found, and how the detection engines are doing.
        </p>
      </div>

      {loading ? (
        <EmptyNote>Loading figures…</EmptyNote>
      ) : (
        <>
          {/* ------------------------------------------------ Scope Selector */}
          <div className="filter-toolbar mt-5 rv rv--d1">
            <div className="filter-strip" role="radiogroup" aria-label="Analytics scope">
              {(["global", "local", "session"] as const).map((s) => {
                const active = scope === s;
                const c = s === "session" ? getSessionMetrics() : s === "local" ? getLocalMetrics() : global?.stats || {};
                const sTotal = Object.values(c).reduce((a, b) => a + (b || 0), 0);
                return (
                  <button
                    key={s}
                    type="button"
                    className={`filter-btn${active ? " filter-btn--active" : ""}`}
                    onClick={() => setScope(s)}
                  >
                    <span className="filter-btn__label">{s.toUpperCase()}</span>
                    <span className="filter-btn__badge"><CountUp target={sTotal} /></span>
                  </button>
                );
              })}
            </div>
            <div className="filter-desc">
              <span className="stat-note">Showing:</span>
              <strong>{SCOPE_META[scope].title}</strong> — {SCOPE_META[scope].subtitle}
            </div>
          </div>

          {/* ------------------------------------------------ Verdict Share Bar */}
          <div className="distribution-card mt-5 rv rv--d2">
            <div className="distribution-card__head">
              <div className="row" style={{ gap: 8 }}>
                <span style={{ color: "var(--seal-2)", display: "inline-flex" }}>
                  <IconShield size={15} />
                </span>
                <span className="distribution-card__title">Screening Results</span>
              </div>
              <span className="stat-note"><CountUp target={total} /> screenings</span>
            </div>

            <div className="distribution-bar" role="meter" aria-label="Verdict distribution" aria-valuenow={total}>
              <div
                className="distribution-bar__seg distribution-bar__seg--auth"
                style={{ width: `${authenticShare}%` }}
                title={`Authentic: ${authenticShare.toFixed(1)}%`}
              />
              <div
                className="distribution-bar__seg distribution-bar__seg--fake"
                style={{ width: `${provenFakeShare}%` }}
                title={`Proven fake: ${provenFakeShare.toFixed(1)}%`}
              />
              <div
                className="distribution-bar__seg distribution-bar__seg--rev"
                style={{ width: `${revokedShare}%` }}
                title={`Revoked: ${revokedShare.toFixed(1)}%`}
              />
              <div
                className="distribution-bar__seg distribution-bar__seg--uns"
                style={{ width: `${unsignedShare}%` }}
                title={`Unsigned: ${unsignedShare.toFixed(1)}%`}
              />
            </div>

            <div className="distribution-legend">
              <div className="distribution-legend__item">
                <span className="dot" style={{ background: "var(--seal-2)" }} />
                <span>Authentic</span>
                <strong>{authenticShare.toFixed(1)}%</strong>
              </div>
              <div className="distribution-legend__item">
                <span className="dot" style={{ background: "var(--danger)" }} />
                <span>Proven fake</span>
                <strong>{provenFakeShare.toFixed(1)}%</strong>
              </div>
              <div className="distribution-legend__item">
                <span className="dot" style={{ background: "var(--warn)" }} />
                <span>Revoked</span>
                <strong>{revokedShare.toFixed(1)}%</strong>
              </div>
              <div className="distribution-legend__item">
                <span className="dot" style={{ background: "var(--slate)" }} />
                <span>Unsigned</span>
                <strong>{unsignedShare.toFixed(1)}%</strong>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------ Metric Cards */}
          <div className="metrics-grid mt-5">
            {(Object.keys(VERDICT_CONFIG) as Array<keyof typeof VERDICT_CONFIG>).map((k, i) => {
              const conf = VERDICT_CONFIG[k];
              const val = (counts as Record<string, number>)[k] || 0;
              const share = total ? Math.round((val / total) * 100) : 0;

              return (
                <div className={`metric-card metric-card--${conf.tone} rv rv--d${i + 1}`} key={k}>
                  <div className="metric-card__top">
                    <span className="metric-card__badge">
                      <span className="dot" style={{ background: conf.color }} />
                      {conf.label}
                    </span>
                    <span className="metric-card__share">{share}%</span>
                  </div>
                  <div className="metric-card__value"><CountUp target={val} /></div>
                  <div className="metric-card__name">{conf.name}</div>
                  <div className="metric-card__chips">
                    {conf.chips.map((chip) => (
                      <span key={chip} className="metric-chip">
                        {chip}
                      </span>
                    ))}
                  </div>
                  <div className="metric-card__status-note">
                    <span className="dot" style={{ background: conf.color }} />
                    <span>{conf.statusNote}</span>
                  </div>
                  <div className="metric-card__progress-wrap">
                    <div
                      className="metric-card__progress-bar"
                      style={{ width: `${share}%`, background: conf.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* ------------------------------------------------ Charts */}
          <div className="grid-2 mt-5">
            <Card title="Verdict distribution" icon={<IconBar size={14} />}>
              <BarChart data={bars} height={240} />
              <div className="insight-strip mt-3">
                <span style={{ color: "var(--seal-2)", display: "inline-flex" }}>
                  <IconCheck size={13} />
                </span>
                <span><CountUp target={counts.AUTHENTIC || 0} /> resolved and trusted — screening and face checks passed.</span>
              </div>
            </Card>

            <Card title="Check time" icon={<IconClock size={14} />}>
              {latencyBars.length ? (
                <>
                  <HBarChart data={latencyBars} unit="ms" />
                  <div className="latency-stages mt-4">
                    <div className="latency-stage">
                      <span className="latency-stage__dot" />
                      <div>
                        <div className="latency-stage__name">Hash the file</div>
                        <div className="latency-stage__val">SHA-256 digest computed in your browser</div>
                      </div>
                    </div>
                    <div className="latency-stage">
                      <span className="latency-stage__dot" style={{ background: "var(--seal-2)" }} />
                      <div>
                        <div className="latency-stage__name">Run 4-module screening</div>
                        <div className="latency-stage__val">Format, watchlist, AI tamper &amp; face checks</div>
                      </div>
                    </div>
                    <div className="latency-stage">
                      <span className="latency-stage__dot" style={{ background: "var(--slate)" }} />
                      <div>
                        <div className="latency-stage__name">Record the outcome</div>
                        <div className="latency-stage__val">Risk score saved to the screening queue</div>
                      </div>
                    </div>
                  </div>
                  <p className="stat-note mt-3">
                    Built from the last <CountUp target={global!.latency!.samples} /> screenings · <CountUp target={aiTotal} /> AI screens
                    run{Object.keys(global!.providers || {}).length
                      ? ` across ${Object.entries(global!.providers)
                          .map(([p, n]) => `${p}${n ? ` (${n})` : ""}`)
                          .join(", ")}`
                      : ""}
                  </p>
                </>
              ) : (
                <EmptyNote>
                  No timing data yet.
                  <br />
                  Run a few screenings and the timings will show up here.
                </EmptyNote>
              )}
            </Card>
          </div>

          {/* ------------------------------------------------ API Quota */}
          {usage && (
            <div className="mt-5 rv rv--d3">
              <Card
                title="AI screening allowance"
                icon={<IconShield size={14} />}
                aside={<Pill tone="seal">{usage.provider.toUpperCase()} · {model}</Pill>}
              >
                <div className="quota-container">
                  <div className="quota-track">
                    <div className="quota-track__head">
                      <span>Used today</span>
                      <strong>
                        <CountUp target={usage.ops_used_today} /> / <CountUp target={usage.limit_today} />
                      </strong>
                    </div>
                    <div className="quota-meter">
                      <div
                        className="quota-meter__fill"
                        style={{
                          width: `${Math.min(100, Math.round((usage.ops_used_today / (usage.limit_today || 1)) * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="quota-track__foot">
                      <span><CountUp target={usage.remaining_today} /> remaining today</span>
                      <span>{usage.period_day}</span>
                    </div>
                  </div>

                  <div className="quota-track">
                    <div className="quota-track__head">
                      <span>Used this month</span>
                      <strong>
                        <CountUp target={usage.ops_used_month} /> / <CountUp target={usage.limit_month} />
                      </strong>
                    </div>
                    <div className="quota-meter">
                      <div
                        className="quota-meter__fill quota-meter__fill--month"
                        style={{
                          width: `${Math.min(100, Math.round((usage.ops_used_month / (usage.limit_month || 1)) * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="quota-track__foot">
                      <span><CountUp target={usage.remaining_month} /> remaining this month</span>
                      <span>{usage.period_month}</span>
                    </div>
                  </div>
                </div>

                <div className="failopen-banner mt-4">
                  <span className="live-chip">
                    <span className="dot" aria-hidden="true" />
                    Screening always works
                  </span>
                  <span className="failopen-banner__desc">
                    If the AI allowance runs out, image screening falls back to rule-based checks. The core
                    format, watchlist and face modules are never affected.
                  </span>
                </div>
              </Card>
            </div>
          )}

          {/* ------------------------------------------------ Recent Screening Activity */}
          <div className="mt-5 rv rv--d4">
            <Card
              title="Latest screenings"
              icon={<IconGrid size={14} />}
              aside={<span className="stat-note">Newest first</span>}
            >
              <div className="ledger-stream">
                {!signedIn ? (
                  <EmptyNote>
                    <span className="big">Sign-in required</span>
                    <br />
                    The recent-screening list is limited to signed-in authorities. The overall figures above stay
                    visible to everyone.
                  </EmptyNote>
                ) : !recentReady ? (
                  <EmptyNote>Loading recent screenings…</EmptyNote>
                ) : recent.length === 0 ? (
                  <EmptyNote>Nothing screened yet.</EmptyNote>
                ) : (
                  <div className="ledger-stream__list">
                    {recent.slice(0, 7).map((r) => (
                      <div className="ledger-stream__row" key={r.id}>
                        <div className="ledger-stream__status">
                          {r.verdict === "CLEAR" ? (
                            <Pill tone="seal">CLEAR</Pill>
                          ) : r.verdict === "FLAGGED" ? (
                            <Pill tone="danger">FLAGGED</Pill>
                          ) : (
                            <Pill tone="amber">REVIEW</Pill>
                          )}
                        </div>
                        <div className="ledger-stream__meta">
                          <div className="ledger-stream__name">
                            <strong>{r.filename || "Screened payload"}</strong>
                            <span className="stat-note" style={{ marginLeft: 8 }}>
                              {r.doc_type || "doc"} · {r.checkpoint || "desk"}
                            </span>
                          </div>
                          <div className="ledger-stream__hash">
                            <span className="stat-note">
                              risk {(r.risk_score ?? 0).toFixed(0)}/100 · {Math.round((r.confidence ?? 0) * 100)}% conf
                              {r.screener ? ` · ${r.screener}` : ""}
                            </span>
                          </div>
                        </div>
                        <div className="ledger-stream__time mono stat-note">
                          <IconClock size={11} /> {timeLabel(r.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      <div style={{ height: 20 }} />
    </section>
  );
}