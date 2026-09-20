// ============================================================================
// PublicView — the public front page. Simple stacked sections:
// hero (headline + stats + live notices) → verifier → how it works.
// Each section reveals on scroll via `.rv` / `.rv--in`.
// ============================================================================

import { useEffect, useState } from "react";
import { getStats } from "../api";
import { CountUp, IconDoc, IconHash, IconLayers, IconShield, Kicker } from "../components/ui";
import { VerifyPanel } from "../components/VerifyPanel";
import { NoticeBoard } from "../components/NoticeBoard";
import { TerminalDecrypt } from "../components/TerminalDecrypt";

export function PublicView() {
  const [stats, setStats] = useState<{ signed_docs: number; trusted_issuers: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await getStats();
      if (res.ok && alive) setStats(res.data);
    };
    void load();
    const t = window.setInterval(load, 90_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  return (
    <div className="public-flow">
      {/* -------------------------------------------------- hero */}
      <section className="section section--hero hero hero--centered" id="top">
        <div className="hero__grid">
          <div className="hero__main">
            <div className="hero__kicker rv">
              <span className="dot" aria-hidden="true" /> Live provenance ledger — check before you share
            </div>
            <h1 className="rv">
              The time to doubt is <TerminalDecrypt text="before" /> you forward.
            </h1>
            <p className="hero__lede rv rv--d1">
              nocap is the SSB Border Screening public record: every screened
              document lands as a stamped verdict in an append-only SHA-256
              ledger, and institutions post signed authority notices to the
              bulletin. Drop any file, paste text, or check a digest — get a
              verdict in under a second: real, forged, revoked, or unofficial.
            </p>

            <div className="hero__cta rv rv--d2">
              <a className="btn btn--seal btn--lg" href="#verify">
                Verify a file
              </a>
              <a className="btn btn--ghost btn--lg" href="#how">
                How it works
              </a>
            </div>

            <div className="hero__stats rv rv--d3" aria-label="Ledger statistics">
              <div className="stat-plate">
                <span className="stat-plate__icon">
                  <IconDoc size={22} />
                </span>
                <div>
                  <div className="stat-plate__num">
                    <CountUp target={stats?.signed_docs ?? 0} />
                  </div>
                  <div className="stat-plate__label">Screened documents</div>
                </div>
              </div>
              <div className="stat-plate">
                <span className="stat-plate__icon stat-plate__icon--amber">
                  <IconShield size={22} />
                </span>
                <div>
                  <div className="stat-plate__num">
                    <CountUp target={stats?.trusted_issuers ?? 0} />
                  </div>
                  <div className="stat-plate__label">Registered officers</div>
                </div>
              </div>
            </div>

            <div className="hero__meta rv rv--d4" aria-hidden="true">
              <span>SHA-256 fingerprints</span>
              <span>append-only hash chain</span>
              <span>open, replayable record</span>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ verifier */}
      <section className="section section--rule" id="verify">
        <div className="section__head rv">
          <div>
            <Kicker>Check the provenance of any file</Kicker>
            <h2>Verify it against the screening ledger</h2>
          </div>
          <p>
            Every screened document carries a digest in the trust chain. Drop it
            here to re-derive the hash, look it up in the ledger, and replay the
            verdict — authentic, forged, revoked, or unofficial.
          </p>
        </div>

        <div className="verify-duo rv rv--d1">
          <VerifyPanel />
          <NoticeBoard />
        </div>
      </section>

      {/* --------------------------------------------- how it works */}
      <section className="section section--rule" id="how">
        <div className="how-wrap">
          <div className="section__head rv">
            <div>
              <Kicker>How the record works</Kicker>
              <h2>Three layers, one trust chain</h2>
            </div>
            <p>Screen, stamp, chain — each verdict leaves a public, replayable trace.</p>
          </div>
          <div className="grid-3">
            <div className="pillar rv rv--d1">
              <div className="pillar__num">
                <span>01</span>
                <IconHash size={15} />
              </div>
              <div className="pillar__title">The digest</div>
              <p className="pillar__desc">
                Every document screened at the border is reduced to a SHA-256
                fingerprint. The fingerprint is what gets recorded — the file
                itself never lives on the ledger, so nothing sensitive is stored
                here.
              </p>
            </div>
            <div className="pillar rv rv--d2">
              <div className="pillar__num">
                <span>02</span>
                <IconShield size={15} />
              </div>
              <div className="pillar__title">The screening</div>
              <p className="pillar__desc">
                Four modules — extraction, validation, tamper forensics and face
                matching — stamp each document CLEAR, REVIEW or FLAGGED, and the
                verdict is bound to the officer who recorded it.
              </p>
            </div>
            <div className="pillar rv rv--d3">
              <div className="pillar__num">
                <span>03</span>
                <IconLayers size={15} />
              </div>
              <div className="pillar__title">The chain</div>
              <p className="pillar__desc">
                Each verdict hashes onto the previous one — an append-only ledger.
                Tampering with any historical row breaks the chain for every
                later block. Retractions stay on record, marked revoked.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}