import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useNow } from "../../hooks/useNow";
import type { ActionResult, PrivateCredits } from "../../hooks/usePrivateCredits";
import { formatRelativeTime } from "../../lib/relative-time";
import {
  formatCredits,
  parseIsoTime,
  privateErrorText,
  updatedAgo,
  type PrivateStatus,
} from "../../lib/private-credits";
import { Button } from "../ui/Button";
import { StatusLine } from "../ui/StatusLine";
import { SettingsGroup, SettingsRow } from "../settings/SettingsGroup";

export interface BalanceCardProps {
  /** null until the first read answers. */
  status: PrivateStatus | null;
  refresh: PrivateCredits["refresh"];
  forget: () => Promise<ActionResult>;
  /** Opens the recovery-code dialog, for the note that asks for it. */
  onShowRecoveryCode: () => void;
}

const SOLO_AMOUNT = "text-base font-semibold text-fg";

function KeyState({ isReady }: { isReady: boolean }) {
  return <StatusLine status={isReady ? "ready" : "idle"}>{isReady ? "Key ready" : "No key yet"}</StatusLine>;
}

function BalanceSkeleton() {
  return (
    <SettingsGroup heading="Balance">
      <div className="flex flex-col gap-2 px-4 py-3">
        <span role="status" className="sr-only">
          Loading your balance…
        </span>
        <span aria-hidden="true" className="h-5 w-32 rounded-md bg-surface-hover motion-safe:animate-pulse" />
        <span aria-hidden="true" className="h-4 w-64 rounded-md bg-surface-hover motion-safe:animate-pulse" />
      </div>
    </SettingsGroup>
  );
}

/** Settings → Private mode → Balance, in the state the credits server and this Mac's device are in. */
export function BalanceCard({ status, refresh, forget, onShowRecoveryCode }: BalanceCardProps) {
  const now = useNow();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isForgetting, setIsForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const isAlive = useRef(true);

  useEffect(() => {
    isAlive.current = true;
    return () => {
      isAlive.current = false;
    };
  }, []);

  if (status === null) return <BalanceSkeleton />;

  const reload = async () => {
    setIsRefreshing(true);
    try {
      await refresh(true);
    } finally {
      if (isAlive.current) setIsRefreshing(false);
    }
  };

  const forgetHere = async () => {
    setIsForgetting(true);
    setForgetError(null);
    const result = await forget();
    if (!isAlive.current) return;
    setIsForgetting(false);
    if (!result.ok) setForgetError(result.text);
  };

  if (status.device === "moved") {
    return (
      <SettingsGroup heading="Balance">
        <SettingsRow
          label={<span className={SOLO_AMOUNT}>Your credits moved to another Mac</span>}
          description={
            <>
              This Mac can't use them anymore. Forget them here to start again with a top-up, or restore a recovery
              code below.
              {forgetError && (
                <span role="alert" className="mt-1 block text-danger">
                  {forgetError}
                </span>
              )}
            </>
          }
          control={
            <Button disabled={isForgetting} onClick={() => void forgetHere()}>
              Forget on this Mac
            </Button>
          }
        />
      </SettingsGroup>
    );
  }

  const { balance, lastBalance } = status;
  if (balance === null && status.balanceError !== null) {
    const when = lastBalance ? formatRelativeTime(parseIsoTime(lastBalance.at), now).toLowerCase() : null;
    return (
      <SettingsGroup heading="Balance">
        <SettingsRow
          label={
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-attention" />
              <span className="text-ui font-semibold">Balance unavailable</span>
            </span>
          }
          description={
            <>
              {status.balanceError === "unreachable"
                ? "Zorvo can't reach the credits server right now. Private sessions keep working while your credits last; top-ups wait until it's back."
                : privateErrorText(status.balanceError)}
              {lastBalance && (
                <span className="mt-1 block text-fg-muted">
                  {`Last known: ${formatCredits(lastBalance.credits)} · ${when}`}
                </span>
              )}
            </>
          }
          control={
            <Button disabled={isRefreshing} onClick={() => void reload()}>
              Try again
            </Button>
          }
        />
      </SettingsGroup>
    );
  }

  const credits = balance?.credits ?? lastBalance?.credits ?? 0;
  const used = balance?.usedCredits ?? lastBalance?.usedCredits ?? 0;
  const isFirstRun = status.device === "none";
  const needsRecoveryNote = status.recoveryPrompted && !status.recoverySaved;
  return (
    <SettingsGroup heading="Balance">
      <SettingsRow
        label={<span className={SOLO_AMOUNT}>{formatCredits(credits)}</span>}
        description={
          isFirstRun ? (
            <>
              You haven't topped up yet. Your first top-up also sets up the private key this Mac uses.
              <span className="mt-1 block">
                Got a promo code? Redeem it under the packages to try Private mode for free.
              </span>
            </>
          ) : (
            `One balance for every private session on this Mac · ${used.toLocaleString("en-US")} used so far`
          )
        }
        control={
          <>
            <KeyState isReady={status.keyReady} />
            {balance && <span className="text-ui-sm text-fg-subtle">{updatedAgo(balance.updatedAt, now)}</span>}
            {!isFirstRun && (
              <Button
                icon={<RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />}
                disabled={isRefreshing}
                onClick={() => void reload()}
              >
                Refresh
              </Button>
            )}
          </>
        }
      />
      {status.keyError !== null && (
        <SettingsRow
          label={<span className="text-danger">{privateErrorText(status.keyError)}</span>}
        />
      )}
      {needsRecoveryNote && (
        <SettingsRow
          label="Your recovery code isn't saved yet."
          control={<Button onClick={onShowRecoveryCode}>Save your recovery code</Button>}
        />
      )}
    </SettingsGroup>
  );
}
