import { useEffect, useRef } from 'react';
import { formatCredits, LOW_BALANCE_CREDITS } from '../lib/private-credits';
import { notifyIfAway } from '../lib/notify';

export interface PrivateLowBalanceDeps {
  /** The live balance; null until a status read has one. */
  credits: number | null;
  /** The persisted flag: true after this crossing has been handled once. */
  notified: boolean;
  /** Stores the flag so a restart below 50 does not notify again; false re-arms the warning. */
  onNotified: (notified: boolean) => void;
  /** The user's own key has no Zorvo balance to warn about. */
  isOwnKey?: boolean;
}

/**
 * Notifies once when the live balance crosses below 50, and re-arms when it reaches 50 again.
 * A crossing seen while a Zorvo window has focus is still marked handled: the note is on screen,
 * and `notifyIfAway` itself shows nothing in that case.
 */
export function usePrivateLowBalanceNotice({
  credits,
  notified,
  onNotified,
  isOwnKey = false,
}: PrivateLowBalanceDeps) {
  const handled = useRef(false);

  useEffect(() => {
    if (isOwnKey || credits === null || !Number.isFinite(credits)) return;
    if (credits >= LOW_BALANCE_CREDITS) {
      handled.current = false;
      if (notified) onNotified(false);
      return;
    }
    if (notified || handled.current) return;
    handled.current = true;
    onNotified(true);
    void notifyIfAway({
      title: 'Zorvo Private credits are low',
      body: `${formatCredits(credits)} left. Top up to keep private sessions running.`,
    }).catch(() => {});
  }, [credits, isOwnKey, notified, onNotified]);
}