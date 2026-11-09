import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { notifyIfAway } from '../lib/notify';
import type { CreditsOutReason } from '../lib/private-session';
import { TOPUP_UNCHECKED } from '../lib/private-flow';
import {
  PRIVATE_ERROR_CODES,
  actionError,
  creditedNoticeText,
  isPricedModel,
  parseIsoTime,
  type ModelPrice,
  type PendingTopup,
  type PrivateStatus,
  type PromoResult,
  type Stock,
  type TopupState,
} from '../lib/private-credits';

export type TopupFlow =
  | { kind: 'idle' }
  | { kind: 'opening'; usd: number }
  /** `openFailed`: the hold exists but the browser did not open; Open again or Cancel. */
  | { kind: 'waiting'; topup: PendingTopup; openFailed?: boolean }
  | { kind: 'paid'; topup: PendingTopup }
  | { kind: 'credited'; credits: number; keyCreated?: boolean }
  | { kind: 'failed' | 'expired'; topupId: string }
  | { kind: 'waiting-stock'; topup: PendingTopup }
  | { kind: 'error'; code: string };

export type ActionResult = { ok: true } | { ok: false; text: string };

/** `code` is the backend's plain error code (`not_found`: no checkout address is kept, as after a restart). */
export type OpenCheckoutResult = { ok: true } | { ok: false; code: string };

export interface PrivateCredits {
  /** null until the first read answers. */
  status: PrivateStatus | null;
  /** The last status read failed; cleared by the next one that succeeds. */
  statusFailed: boolean;
  stock: Stock | null;
  models: ModelPrice[] | null;
  modelsError?: string;
  stockError?: string;
  /** Reads the status; `fresh` asks the server for the balance. Never loads the catalog. */
  refresh: (fresh?: boolean) => Promise<void>;
  /**
   * Loads the stock and the models, each on its own. The credits server is asked only when Settings
   * shows Private mode (and on its retry links), never at app start. One load at a time: a call during
   * a load waits for it.
   */
  loadCatalog: () => Promise<void>;
  flow: TopupFlow;
  buy: (usd: number) => Promise<void>;
  /** Opens the current top-up's checkout again, for a browser that did not open the first time. */
  openCheckout: () => Promise<OpenCheckoutResult>;
  cancel: () => Promise<ActionResult>;
  dismiss: () => void;
  redeem: (code: string) => Promise<{ ok: true; credits: number } | { ok: false; text: string }>;
  recover: (code: string) => Promise<{ ok: true; newCode: string } | { ok: false; text: string }>;
  /** The recovery code, for a dialog to show. The hook keeps no copy of it. */
  revealCode: () => Promise<string>;
  markRecovery: (saved: boolean) => Promise<ActionResult>;
  forget: () => Promise<ActionResult>;
  /** Sessions whose turn was refused for lack of credits or a key, until the status shows it is fixed. */
  creditsOut: Readonly<Record<string, CreditsOutReason>>;
  /**
   * Marks the session; for `empty` reads the balance afresh and calls `onBalanceLagging` when that read
   * already shows credits (the server's balance lags NEAR AI's refusal), which clears the mark at once.
   */
  markCreditsOut: (sessionId: string, reason: CreditsOutReason, onBalanceLagging?: () => void) => void;
  /** Clears a mark after the user chooses another payment source. */
  clearCreditsOut: (sessionId: string) => void;
  /** True once this Mac holds credits and the user has not yet been asked to save the recovery code. */
  needsRecoveryDialog: boolean;
}

const POLL_MS = 3_000;
/** A paid top-up waiting for stock can take long; asking every 3 s would only load the server. */
const STOCK_POLL_MS = 15_000;
/** How long after its hold ends a waiting top-up is still asked about while the server cannot answer. */
const GIVE_UP_AFTER_HOLD_MS = 10 * 60_000;
/** The same, for a top-up whose hold's end is unknown, counted from when polling started. */
const GIVE_UP_UNKNOWN_HOLD_MS = 90 * 60_000;

/** Errors that pass by themselves; any other error code ends the polling. */
const TRANSIENT_POLL_ERRORS: ReadonlySet<string> = new Set(['unreachable', 'upstream', 'rate_limited']);

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(PRIVATE_ERROR_CODES);

/**
 * A poll error that may pass by itself: a transient code, or a rejection that is not one of the
 * backend's codes at all (an unknown shape says nothing lasting about the top-up).
 */
function isTransientPollError(code: string): boolean {
  return TRANSIENT_POLL_ERRORS.has(code) || !KNOWN_ERROR_CODES.has(code);
}

const ONE_TOPUP_AT_A_TIME = 'Finish or cancel your current top-up first.';
const STILL_OPENING = 'Wait a moment, then cancel.';

type CreditsOut = Readonly<Record<string, CreditsOutReason>>;

/** The backend rejects with a plain snake_case code. */
function codeOf(error: unknown): string {
  if (typeof error === 'string') return error;
  return error instanceof Error ? error.message : '';
}

function creditsOf(status: PrivateStatus): number {
  return status.balance?.credits ?? status.lastBalance?.credits ?? 0;
}

/**
 * Credits a read of the balance itself showed: a read that failed falls back to the last known
 * balance in `creditsOf`, which says nothing about a refusal that came after it.
 */
function freshCreditsOf(status: PrivateStatus): number {
  return status.balance?.credits ?? 0;
}

function toppedUp(flow: TopupFlow): PendingTopup | null {
  return flow.kind === 'waiting' || flow.kind === 'paid' || flow.kind === 'waiting-stock' ? flow.topup : null;
}

/** A top-up is being created or followed: its hold must not be lost track of. */
function isTopupInProgress(flow: TopupFlow): boolean {
  return flow.kind === 'opening' || toppedUp(flow) !== null;
}

/** When polling a waiting top-up the server cannot answer about stops, for polling that started at `startedAt`. */
function giveUpAt(topup: PendingTopup, startedAt: number): number {
  const holdEnds = parseIsoTime(topup.expiresAt);
  return Number.isNaN(holdEnds)
    ? startedAt + GIVE_UP_UNKNOWN_HOLD_MS
    : Math.max(holdEnds, startedAt) + GIVE_UP_AFTER_HOLD_MS;
}

function pruneCreditsOut(marks: CreditsOut, status: PrivateStatus): CreditsOut {
  const hasCredits = freshCreditsOf(status) > 0;
  const keyFixed = status.keyReady && status.keyError === null;
  const kept = Object.entries(marks).filter(([, reason]) => {
    if (reason === 'session_limit') return true;
    return !(reason === 'empty' ? hasCredits : keyFixed);
  });
  return kept.length === Object.keys(marks).length ? marks : Object.fromEntries(kept);
}

/** A notification is a convenience: its failure never reaches the top-up. */
function notifyCredits(credits: number) {
  try {
    void notifyIfAway({
      title: 'Zorvo',
      body: creditedNoticeText(credits),
    }).catch(() => undefined);
  } catch {
    // Same: nothing to do.
  }
}

/**
 * Zorvo Private's credits: the status, the stock and the prices, and the top-up flow (create,
 * checkout, polling until the credit lands). Built once per app. Zorvo holds no card or key here:
 * the backend creates the top-up and opens the checkout, and this hook only follows it.
 */
export function usePrivateCredits(): PrivateCredits {
  const [status, setStatus] = useState<PrivateStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [stock, setStock] = useState<Stock | null>(null);
  const [models, setModels] = useState<ModelPrice[] | null>(null);
  const [modelsError, setModelsError] = useState<string | undefined>(undefined);
  const [stockError, setStockError] = useState<string | undefined>(undefined);
  const [flow, setFlow] = useState<TopupFlow>({ kind: 'idle' });
  const [creditsOut, setCreditsOut] = useState<CreditsOut>({});

  const isAlive = useRef(false);
  // The flow as the async code below needs it: written when it changes, not on the next render.
  const flowRef = useRef<TopupFlow>(flow);
  const latestStatusRead = useRef(0);
  // The top-ups a credit notification was sent for: one per top-up, however often its credit is seen.
  const notifiedTopups = useRef<Set<string>>(new Set());
  const isResumed = useRef(false);
  // A promo redeem is on its way: it will make the pending top-up, so no buy or second redeem may start.
  const isRedeeming = useRef(false);

  useEffect(() => {
    isAlive.current = true;
    return () => {
      isAlive.current = false;
    };
  }, []);

  const updateFlow = useCallback((change: (prev: TopupFlow) => TopupFlow) => {
    if (!isAlive.current) return;
    flowRef.current = change(flowRef.current);
    setFlow(flowRef.current);
  }, []);

  const applyStatus = useCallback(
    (next: PrivateStatus) => {
      setStatus(next);
      setCreditsOut((prev) => pruneCreditsOut(prev, next));
      // After a restart, or after polling gave up, a top-up the backend still holds is followed from where it was left.
      if (!isResumed.current) {
        isResumed.current = true;
        const pending = next.pendingTopup;
        const isResumable = (prev: TopupFlow) =>
          prev.kind === 'idle' || (prev.kind === 'error' && prev.code === TOPUP_UNCHECKED);
        if (pending) updateFlow((prev) => (isResumable(prev) ? { kind: 'waiting', topup: pending } : prev));
      }
    },
    [updateFlow],
  );

  /** Reads the status; null when it could not be read (the last one stays). */
  const loadStatus = useCallback(
    async (fresh: boolean): Promise<PrivateStatus | null> => {
      const read = ++latestStatusRead.current;
      if (isAlive.current) setStatusFailed(false);
      try {
        const next = await invoke<PrivateStatus>('private_status', { fresh });
        if (!isAlive.current || read !== latestStatusRead.current) return null;
        setStatusFailed(false);
        applyStatus(next);
        return next;
      } catch {
        // The last status stays; the draft says when there never was one.
        if (isAlive.current && read === latestStatusRead.current) setStatusFailed(true);
        return null;
      }
    },
    [applyStatus],
  );

  const loadStock = useCallback(async () => {
    if (isAlive.current) setStockError(undefined);
    try {
      const next = await invoke<Stock>('private_stock');
      if (isAlive.current) setStock(next);
    } catch (error) {
      // The last stock stays; the error says why the packages are missing or stale.
      if (isAlive.current) setStockError(actionError('stock', codeOf(error)));
    }
  }, []);

  const loadModels = useCallback(async () => {
    if (isAlive.current) setModelsError(undefined);
    try {
      const next = await invoke<ModelPrice[]>('private_models');
      if (!isAlive.current) return;
      // A model whose price is not a usable number could never be priced or offered.
      setModels(next.filter(isPricedModel));
      setModelsError(undefined);
    } catch (error) {
      if (isAlive.current) setModelsError(actionError('models', codeOf(error)));
    }
  }, []);

  const refresh = useCallback(
    async (fresh = false) => {
      await loadStatus(fresh);
    },
    [loadStatus],
  );

  const catalogLoad = useRef<Promise<void> | null>(null);
  const loadCatalog = useCallback(() => {
    if (catalogLoad.current) return catalogLoad.current;
    const load = Promise.all([loadStock(), loadModels()])
      .then(() => undefined)
      .finally(() => {
        catalogLoad.current = null;
      });
    catalogLoad.current = load;
    return load;
  }, [loadStock, loadModels]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Applies a top-up's answer to the flow, if that top-up is still the one being followed. */
  const settle = useCallback(
    (topupId: string, state: TopupState) => {
      const topup = toppedUp(flowRef.current);
      if (topup?.topupId !== topupId) return;
      switch (state.status) {
        case 'created':
          updateFlow((prev) => (prev.kind === 'waiting' ? prev : { kind: 'waiting', topup }));
          break;
        case 'paid':
          updateFlow(() => ({ kind: 'paid', topup }));
          break;
        case 'paid_waiting_stock':
          updateFlow(() => ({ kind: 'waiting-stock', topup }));
          break;
        case 'credited': {
          const credits = state.credits > 0 ? state.credits : topup.credits;
          updateFlow(() => ({
            kind: 'credited',
            credits,
            ...(status?.device === 'none' ? { keyCreated: true } : {}),
          }));
          if (!notifiedTopups.current.has(topupId)) {
            notifiedTopups.current.add(topupId);
            notifyCredits(credits);
          }
          void refresh(true);
          break;
        }
        case 'failed':
        case 'expired':
          updateFlow(() => ({ kind: state.status as 'failed' | 'expired', topupId }));
          break;
      }
    },
    [refresh, status?.device, updateFlow],
  );

  const followed = toppedUp(flow);
  const topupId = followed?.topupId ?? null;
  const pollMs = flow.kind === 'waiting-stock' ? STOCK_POLL_MS : POLL_MS;

  useEffect(() => {
    if (topupId === null) return;
    let isStopped = false;
    let isReading = false;
    const followedTopup = toppedUp(flowRef.current);
    const stopAt = followedTopup ? giveUpAt(followedTopup, Date.now()) : Number.POSITIVE_INFINITY;
    const poll = async () => {
      // A slow answer is waited for: a second call on top of it would only race the first.
      if (isReading) return;
      isReading = true;
      try {
        const state = await invoke<TopupState>('private_topup_status', { topupId });
        if (!isStopped) settle(topupId, state);
      } catch (error) {
        // A cancel or a dismiss may have taken this top-up away before the effect stopped.
        if (toppedUp(flowRef.current)?.topupId !== topupId) return;
        const code = codeOf(error);
        // A server out of reach or too busy shows nothing new: the next poll asks again. Any other
        // error will not pass by itself, so the flow says so instead of polling on for nothing.
        if (!isStopped && !isTransientPollError(code)) {
          updateFlow(() => ({ kind: 'error', code }));
          if (code === 'unauthorized') void refresh();
        } else if (!isStopped && flowRef.current.kind === 'waiting' && Date.now() > stopAt) {
          // Long past its hold and still no answer: stop asking every few seconds for the app's lifetime.
          // A later status read that still holds the top-up follows it again, as a restart does.
          isResumed.current = false;
          updateFlow(() => ({ kind: 'error', code: TOPUP_UNCHECKED }));
        }
      } finally {
        isReading = false;
      }
    };
    const timer = setInterval(() => void poll(), pollMs);
    return () => {
      isStopped = true;
      clearInterval(timer);
    };
  }, [topupId, pollMs, settle, refresh, updateFlow]);

  const openCheckoutFor = useCallback(
    async (topup: PendingTopup): Promise<OpenCheckoutResult> => {
      try {
        await invoke('private_open_checkout', { topupId: topup.topupId });
        updateFlow((prev) => {
          if (prev.kind !== 'waiting' || prev.topup.topupId !== topup.topupId) return prev;
          return { kind: 'waiting', topup: prev.topup };
        });
        return { ok: true };
      } catch (error) {
        // Whatever the reason, the hold stands: the user can open it again or cancel.
        updateFlow((prev) =>
          prev.kind === 'waiting' && prev.topup.topupId === topup.topupId ? { ...prev, openFailed: true } : prev,
        );
        return { ok: false, code: codeOf(error) };
      }
    },
    [updateFlow],
  );

  const buy = useCallback(
    async (usd: number) => {
      // One top-up at a time: a second hold would charge nothing but would be lost track of.
      if (isTopupInProgress(flowRef.current) || isRedeeming.current) return;
      if (!Number.isInteger(usd) || usd <= 0) {
        updateFlow(() => ({ kind: 'error', code: 'bad_request' }));
        return;
      }
      updateFlow(() => ({ kind: 'opening', usd }));
      let topup: PendingTopup;
      try {
        topup = await invoke<PendingTopup>('private_create_topup', { packageUsd: usd });
      } catch (error) {
        const code = codeOf(error);
        updateFlow(() => ({ kind: 'error', code }));
        if (code === 'unauthorized') void refresh();
        return;
      }
      updateFlow(() => ({ kind: 'waiting', topup }));
      await openCheckoutFor(topup);
    },
    [openCheckoutFor, refresh, updateFlow],
  );

  const openCheckout = useCallback(async (): Promise<OpenCheckoutResult> => {
    const current = flowRef.current;
    return current.kind === 'waiting' ? openCheckoutFor(current.topup) : { ok: false, code: 'not_found' };
  }, [openCheckoutFor]);

  const cancel = useCallback(async (): Promise<ActionResult> => {
    if (flowRef.current.kind === 'opening') return { ok: false, text: STILL_OPENING };
    const topup = toppedUp(flowRef.current);
    if (topup) {
      try {
        await invoke('private_cancel_topup', { topupId: topup.topupId });
      } catch (error) {
        const code = codeOf(error);
        // The server no longer knows the top-up, so there is nothing left to cancel.
        if (code !== 'not_found') {
          if (code === 'unauthorized') void refresh();
          return { ok: false, text: actionError('cancel', code) };
        }
      }
    }
    // A poll may have settled the top-up while the cancel was on its way: that outcome stays.
    updateFlow((prev) => (topup && toppedUp(prev)?.topupId !== topup.topupId ? prev : { kind: 'idle' }));
    return { ok: true };
  }, [refresh, updateFlow]);

  /** Closes a finished top-up's result. A live hold is never dropped this way: it is cancelled. */
  const dismiss = useCallback(
    () =>
      updateFlow((prev) =>
        prev.kind === 'credited' || prev.kind === 'failed' || prev.kind === 'expired' || prev.kind === 'error'
          ? { kind: 'idle' }
          : prev,
      ),
    [updateFlow],
  );

  const redeem = useCallback(
    async (code: string) => {
      // The backend keeps one pending top-up and a promo replaces it: a hold in progress would be lost.
      if (isTopupInProgress(flowRef.current) || isRedeeming.current) {
        return { ok: false as const, text: ONE_TOPUP_AT_A_TIME };
      }
      let result: PromoResult;
      isRedeeming.current = true;
      try {
        result = await invoke<PromoResult>('private_redeem_promo', { code });
      } catch (error) {
        isRedeeming.current = false;
        const errorCode = codeOf(error);
        if (errorCode === 'unauthorized') void refresh();
        return { ok: false as const, text: actionError('redeem', errorCode) };
      }
      // The backend saved the promo as a pending top-up; its exact record comes from the status.
      const read = await loadStatus(false);
      const saved = read?.pendingTopup?.topupId === result.topupId ? read.pendingTopup : null;
      const topup = saved ?? { topupId: result.topupId, expiresAt: '', credits: result.credits };
      updateFlow(() => ({ kind: 'paid', topup }));
      // Held until the flow follows the promo's top-up, which then blocks a buy by itself.
      isRedeeming.current = false;
      return { ok: true as const, credits: result.credits };
    },
    [loadStatus, refresh, updateFlow],
  );

  const recover = useCallback(
    async (code: string) => {
      let newCode: string;
      try {
        newCode = await invoke<string>('private_recover', { code });
      } catch (error) {
        return { ok: false as const, text: actionError('recover', codeOf(error)) };
      }
      await refresh(true);
      return { ok: true as const, newCode };
    },
    [refresh],
  );

  const revealCode = useCallback(() => invoke<string>('private_recovery_code'), []);

  const markRecovery = useCallback(
    async (saved: boolean): Promise<ActionResult> => {
      try {
        await invoke('private_mark_recovery', { saved });
      } catch (error) {
        return { ok: false, text: actionError('mark', codeOf(error)) };
      }
      await loadStatus(false);
      return { ok: true };
    },
    [loadStatus],
  );

  const forget = useCallback(async (): Promise<ActionResult> => {
    try {
      await invoke('private_forget_device');
    } catch (error) {
      return { ok: false, text: actionError('forget', codeOf(error)) };
    }
    updateFlow(() => ({ kind: 'idle' }));
    await refresh();
    return { ok: true };
  }, [refresh, updateFlow]);

  const clearCreditsOut = useCallback((sessionId: string) => {
    setCreditsOut((prev) => {
      if (!(sessionId in prev)) return prev;
      const { [sessionId]: _cleared, ...rest } = prev;
      return rest;
    });
  }, []);

  const markCreditsOut = useCallback(
    (sessionId: string, reason: CreditsOutReason, onBalanceLagging?: () => void) => {
      setCreditsOut((prev) => (prev[sessionId] === reason ? prev : { ...prev, [sessionId]: reason }));
      if (reason !== 'empty') return;
      // The balance shown elsewhere (the Private tab, Settings) must not contradict the refusal.
      void loadStatus(true).then((next) => {
        if (next !== null && freshCreditsOf(next) > 0) onBalanceLagging?.();
      });
    },
    [loadStatus],
  );

  const needsRecoveryDialog =
    status !== null &&
    status.device === 'ready' &&
    status.keyReady &&
    creditsOf(status) > 0 &&
    !status.recoverySaved &&
    !status.recoveryPrompted;

  return {
    status,
    statusFailed,
    stock,
    models,
    modelsError,
    stockError,
    refresh,
    loadCatalog,
    flow,
    buy,
    openCheckout,
    cancel,
    dismiss,
    redeem,
    recover,
    revealCode,
    markRecovery,
    forget,
    creditsOut,
    markCreditsOut,
    clearCreditsOut,
    needsRecoveryDialog,
  };
}
