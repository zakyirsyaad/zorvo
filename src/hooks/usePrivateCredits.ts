import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { notifyIfAway } from '../lib/notify';
import {
  formatCredits,
  privateErrorText,
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
  | { kind: 'credited'; credits: number }
  | { kind: 'failed' | 'expired'; topupId: string }
  | { kind: 'waiting-stock'; topup: PendingTopup }
  | { kind: 'error'; code: string };

export type ActionResult = { ok: true } | { ok: false; text: string };

export interface PrivateCredits {
  /** null until the first read answers. */
  status: PrivateStatus | null;
  stock: Stock | null;
  models: ModelPrice[] | null;
  modelsError?: string;
  /** Reads the status (`fresh` asks the server for the balance), the stock and the models. */
  refresh: (fresh?: boolean) => Promise<void>;
  flow: TopupFlow;
  buy: (usd: number) => Promise<void>;
  /** Opens the current top-up's checkout again, for a browser that did not open the first time. */
  openCheckout: () => Promise<void>;
  cancel: () => Promise<ActionResult>;
  dismiss: () => void;
  redeem: (code: string) => Promise<{ ok: true; credits: number } | { ok: false; text: string }>;
  recover: (code: string) => Promise<{ ok: true; newCode: string } | { ok: false; text: string }>;
  /** The recovery code, for a dialog to show. The hook keeps no copy of it. */
  revealCode: () => Promise<string>;
  markRecovery: (saved: boolean) => Promise<ActionResult>;
  forget: () => Promise<ActionResult>;
  /** Sessions whose turn was refused for lack of credits or a key, until the status shows it is fixed. */
  creditsOut: Readonly<Record<string, 'empty' | 'key'>>;
  markCreditsOut: (sessionId: string, reason: 'empty' | 'key') => void;
  /** True once this Mac holds credits and the user has not yet been asked to save the recovery code. */
  needsRecoveryDialog: boolean;
}

const POLL_MS = 3_000;
/** A paid top-up waiting for stock can take long; asking every 3 s would only load the server. */
const STOCK_POLL_MS = 15_000;

type CreditsOut = Readonly<Record<string, 'empty' | 'key'>>;

/** The backend rejects with a plain snake_case code. */
function codeOf(error: unknown): string {
  if (typeof error === 'string') return error;
  return error instanceof Error ? error.message : '';
}

function creditsOf(status: PrivateStatus): number {
  return status.balance?.credits ?? status.lastBalance?.credits ?? 0;
}

function toppedUp(flow: TopupFlow): PendingTopup | null {
  return flow.kind === 'waiting' || flow.kind === 'paid' || flow.kind === 'waiting-stock' ? flow.topup : null;
}

function pruneCreditsOut(marks: CreditsOut, status: PrivateStatus): CreditsOut {
  const hasCredits = creditsOf(status) > 0;
  const keyFixed = status.keyReady && status.keyError === null;
  const kept = Object.entries(marks).filter(([, reason]) => !(reason === 'empty' ? hasCredits : keyFixed));
  return kept.length === Object.keys(marks).length ? marks : Object.fromEntries(kept);
}

/** A notification is a convenience: its failure never reaches the top-up. */
function notifyCredits(credits: number) {
  try {
    void notifyIfAway({
      title: 'Zorvo',
      body: `+${formatCredits(credits)}. Private sessions can use them now.`,
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
  const [stock, setStock] = useState<Stock | null>(null);
  const [models, setModels] = useState<ModelPrice[] | null>(null);
  const [modelsError, setModelsError] = useState<string | undefined>(undefined);
  const [flow, setFlow] = useState<TopupFlow>({ kind: 'idle' });
  const [creditsOut, setCreditsOut] = useState<CreditsOut>({});

  const isAlive = useRef(false);
  // The flow as the async code below needs it: written when it changes, not on the next render.
  const flowRef = useRef<TopupFlow>(flow);
  const latestStatusRead = useRef(0);
  // The credits the last status showed; null before the first one. A later rise is a credit that landed.
  const knownCredits = useRef<number | null>(null);
  const isResumed = useRef(false);

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
      const credits = creditsOf(next);
      const known = knownCredits.current;
      knownCredits.current = credits;
      if (known !== null && credits > known) notifyCredits(credits - known);
      setStatus(next);
      setCreditsOut((prev) => pruneCreditsOut(prev, next));
      // After a restart, a top-up the backend still holds is followed from where it was left.
      if (!isResumed.current) {
        isResumed.current = true;
        const pending = next.pendingTopup;
        if (pending) updateFlow((prev) => (prev.kind === 'idle' ? { kind: 'waiting', topup: pending } : prev));
      }
    },
    [updateFlow],
  );

  /** Reads the status; null when it could not be read (the last one stays). */
  const loadStatus = useCallback(
    async (fresh: boolean): Promise<PrivateStatus | null> => {
      const read = ++latestStatusRead.current;
      try {
        const next = await invoke<PrivateStatus>('private_status', { fresh });
        if (!isAlive.current || read !== latestStatusRead.current) return null;
        applyStatus(next);
        return next;
      } catch {
        // The last status stays; there is nothing new to show.
        return null;
      }
    },
    [applyStatus],
  );

  const loadStock = useCallback(async () => {
    try {
      const next = await invoke<Stock>('private_stock');
      if (isAlive.current) setStock(next);
    } catch {
      // The last stock stays.
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const next = await invoke<ModelPrice[]>('private_models');
      if (!isAlive.current) return;
      setModels(next);
      setModelsError(undefined);
    } catch (error) {
      if (isAlive.current) setModelsError(privateErrorText(codeOf(error)));
    }
  }, []);

  const refresh = useCallback(
    async (fresh = false) => {
      await Promise.all([loadStatus(fresh), loadStock(), loadModels()]);
    },
    [loadStatus, loadStock, loadModels],
  );

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
          // The refresh below shows these credits: they are not a second arrival.
          knownCredits.current = (knownCredits.current ?? 0) + credits;
          updateFlow(() => ({ kind: 'credited', credits }));
          notifyCredits(credits);
          void refresh(true);
          break;
        }
        case 'failed':
        case 'expired':
          updateFlow(() => ({ kind: state.status as 'failed' | 'expired', topupId }));
          break;
      }
    },
    [refresh, updateFlow],
  );

  const followed = toppedUp(flow);
  const topupId = followed?.topupId ?? null;
  const pollMs = flow.kind === 'waiting-stock' ? STOCK_POLL_MS : POLL_MS;

  useEffect(() => {
    if (topupId === null) return;
    let isStopped = false;
    let isReading = false;
    const poll = async () => {
      // A slow answer is waited for: a second call on top of it would only race the first.
      if (isReading) return;
      isReading = true;
      try {
        const state = await invoke<TopupState>('private_topup_status', { topupId });
        if (!isStopped) settle(topupId, state);
      } catch (error) {
        // An unreachable server or a failing upstream shows nothing new: the next poll asks again.
        if (!isStopped && codeOf(error) === 'unauthorized') {
          updateFlow(() => ({ kind: 'error', code: 'unauthorized' }));
          void refresh();
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
    async (topup: PendingTopup) => {
      try {
        await invoke('private_open_checkout', { topupId: topup.topupId });
        updateFlow((prev) => {
          if (prev.kind !== 'waiting' || prev.topup.topupId !== topup.topupId) return prev;
          return { kind: 'waiting', topup: prev.topup };
        });
      } catch {
        // Whatever the reason, the hold stands: the user can open it again or cancel.
        updateFlow((prev) =>
          prev.kind === 'waiting' && prev.topup.topupId === topup.topupId ? { ...prev, openFailed: true } : prev,
        );
      }
    },
    [updateFlow],
  );

  const buy = useCallback(
    async (usd: number) => {
      // One top-up at a time: a second hold would charge nothing but would be lost track of.
      if (flowRef.current.kind === 'opening' || toppedUp(flowRef.current)) return;
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

  const openCheckout = useCallback(async () => {
    const current = flowRef.current;
    if (current.kind === 'waiting') await openCheckoutFor(current.topup);
  }, [openCheckoutFor]);

  const cancel = useCallback(async (): Promise<ActionResult> => {
    const topup = toppedUp(flowRef.current);
    if (topup) {
      try {
        await invoke('private_cancel_topup', { topupId: topup.topupId });
      } catch (error) {
        const code = codeOf(error);
        if (code === 'unauthorized') void refresh();
        return { ok: false, text: privateErrorText(code) };
      }
    }
    updateFlow(() => ({ kind: 'idle' }));
    return { ok: true };
  }, [refresh, updateFlow]);

  const dismiss = useCallback(() => updateFlow(() => ({ kind: 'idle' })), [updateFlow]);

  const redeem = useCallback(
    async (code: string) => {
      let result: PromoResult;
      try {
        result = await invoke<PromoResult>('private_redeem_promo', { code });
      } catch (error) {
        const errorCode = codeOf(error);
        if (errorCode === 'unauthorized') void refresh();
        return { ok: false as const, text: privateErrorText(errorCode) };
      }
      // The backend saved the promo as a pending top-up; its exact record comes from the status.
      const read = await loadStatus(false);
      const saved = read?.pendingTopup?.topupId === result.topupId ? read.pendingTopup : null;
      const topup = saved ?? { topupId: result.topupId, expiresAt: '', credits: result.credits };
      updateFlow(() => ({ kind: 'paid', topup }));
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
        return { ok: false as const, text: privateErrorText(codeOf(error)) };
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
        return { ok: false, text: privateErrorText(codeOf(error)) };
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
      return { ok: false, text: privateErrorText(codeOf(error)) };
    }
    updateFlow(() => ({ kind: 'idle' }));
    await refresh();
    return { ok: true };
  }, [refresh, updateFlow]);

  const markCreditsOut = useCallback((sessionId: string, reason: 'empty' | 'key') => {
    setCreditsOut((prev) => (prev[sessionId] === reason ? prev : { ...prev, [sessionId]: reason }));
  }, []);

  const needsRecoveryDialog =
    status !== null &&
    status.device === 'ready' &&
    status.keyReady &&
    creditsOf(status) > 0 &&
    !status.recoverySaved &&
    !status.recoveryPrompted;

  return {
    status,
    stock,
    models,
    modelsError,
    refresh,
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
    needsRecoveryDialog,
  };
}
