// ============================================================================
// preloader.ts — Background Preloader & In-Memory Data Cache (SIH26188).
// Warmed silently in the background during idle time so every tab renders in 0ms.
// ============================================================================

import {
  getCheckpoints,
  getSessions,
  getSessionLedger,
  getStatsOverview,
  getSigners,
  getWatchlist,
  verifySessionLedger,
  type CheckpointCatalog,
  type OfficerEntry,
  type ScreeningSession,
  type SessionLedgerPayload,
  type SessionLedgerVerify,
  type StatsOverview,
  type WatchlistEntry,
} from "../api";

export interface GlobalPortalCache {
  openSessions: ScreeningSession[] | null;
  closedSessions: ScreeningSession[] | null;
  checkpoints: CheckpointCatalog | null;
  ledgerPayload: SessionLedgerPayload | null;
  ledgerVerify: SessionLedgerVerify | null;
  statsOverview: StatsOverview | null;
  watchlistEntries: WatchlistEntry[] | null;
  signers: OfficerEntry[] | null;
  lastPreloadedAt: number | null;
}

export const portalCache: GlobalPortalCache = {
  openSessions: null,
  closedSessions: null,
  checkpoints: null,
  ledgerPayload: null,
  ledgerVerify: null,
  statsOverview: null,
  watchlistEntries: null,
  signers: null,
  lastPreloadedAt: null,
};

let _preloadPromise: Promise<void> | null = null;

/**
 * Silently preloads and warms data across all portal tabs in the background.
 * Uses idle callback so initial rendering of the desk is never blocked.
 */
export function preloadAllBackgroundData(forceFresh = false): Promise<void> {
  if (!forceFresh && _preloadPromise && portalCache.lastPreloadedAt && Date.now() - portalCache.lastPreloadedAt < 30000) {
    return _preloadPromise;
  }

  const runTasks = async () => {
    try {
      const pCheckpoints = getCheckpoints().then((res) => {
        if (res.ok) portalCache.checkpoints = res.data;
      });

      const pOpen = getSessions("open").then((res) => {
        if (res.ok) portalCache.openSessions = res.data.sessions;
      });

      const pClosed = getSessions("closed").then((res) => {
        if (res.ok) portalCache.closedSessions = res.data.sessions;
      });

      const pLedger = getSessionLedger().then((res) => {
        if (res.ok) portalCache.ledgerPayload = res.data;
      });

      const pStats = getStatsOverview().then((res) => {
        if (res.ok) portalCache.statsOverview = res.data;
      });

      const pVerify = verifySessionLedger().then((res) => {
        if (res.ok) portalCache.ledgerVerify = res.data;
      });

      const pWatchlist = getWatchlist().then((res) => {
        if (res.ok) portalCache.watchlistEntries = res.data.entries;
      });

      const pSigners = getSigners().then((res) => {
        if (res.ok) portalCache.signers = res.data.signers;
      });

      await Promise.allSettled([
        pCheckpoints,
        pOpen,
        pClosed,
        pLedger,
        pStats,
        pVerify,
        pWatchlist,
        pSigners,
      ]);

      portalCache.lastPreloadedAt = Date.now();
    } catch {
      // Background preload failures degrade silently
    }
  };

  // Schedule in next idle frame so UI thread stays 100% fluid
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    _preloadPromise = new Promise<void>((resolve) => {
      (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(
        async () => {
          await runTasks();
          resolve();
        },
        { timeout: 800 },
      );
    });
  } else {
    _preloadPromise = new Promise<void>((resolve) => {
      setTimeout(async () => {
        await runTasks();
        resolve();
      }, 50);
    });
  }

  return _preloadPromise;
}
