import { useEffect, useId, useState, type Ref } from "react";
import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import { useLatest } from "../../hooks/useLatest";
import { isTopupActive } from "../../lib/private-flow";
import { formatCredits, updatedAgo, type PaymentSource } from "../../lib/private-credits";
import { privateUsageRows } from "../../lib/private-usage";
import type { Session } from "../../types";
import { BalanceCard } from "../private/BalanceCard";
import { OwnKeySection } from "../private/OwnKeySection";
import { PromoField } from "../private/PromoField";
import { RecoveryCard } from "../private/RecoveryCard";
import { RestoreDialog } from "../private/RestoreDialog";
import { LOW_STOCK_CREDITS, TopupPicker } from "../private/TopupPicker";
import { TopupProgress } from "../private/TopupProgress";
import { SettingsGroup, SettingsHeader, SettingsRow } from "./SettingsGroup";

export interface PrivateSectionProps {
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  credits: PrivateCredits;
  /** Asks the app for its recovery-code dialog: for the stored code, or for a new one from a restore. */
  onShowRecoveryCode: (code?: string) => void;
  /** Tells the app a restore is open or running, so no second recovery dialog opens over it. */
  onRestoringChange?: (isRestoring: boolean) => void;
  /** The Safety switch's state; on unless the user turned it off. */
  secretGuard?: boolean;
  onSecretGuardChange?: (isOn: boolean) => void;
  /** Sessions' persisted private totals, grouped by model under the balance. */
  sessions?: readonly Session[];
  agentNameOf?: (profileId: string) => string;
  paymentSource?: PaymentSource;
  onPaymentSourceChange?: (source: PaymentSource) => void;
}

const RESTORE_BLOCKED = "Finish or cancel your top-up first.";

/**
 * Settings → Private mode: the credits Qwen Code's private sessions use, how to add more, and the
 * recovery code that moves them to another Mac. Zorvo holds no card or key here; the backend does.
 */
export function PrivateSection({
  titleRef,
  titleId,
  credits,
  onShowRecoveryCode,
  onRestoringChange,
  secretGuard = true,
  onSecretGuardChange = () => {},
  sessions = [],
  agentNameOf = (profileId) => profileId,
  paymentSource = "credits",
  onPaymentSourceChange = () => {},
}: PrivateSectionProps) {
  const { status, flow, loadCatalog } = credits;
  const secretGuardLabelId = useId();
  const topupHeadingId = useId();
  const onRestoringChangeRef = useLatest(onRestoringChange);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const isActive = isTopupActive(flow);

  // The packages are asked for only now that the user has opened this section.
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Leaving with the dialog open must not leave the app waiting for it.
  useEffect(() => () => onRestoringChangeRef.current?.(false), [onRestoringChangeRef]);

  const setRestoring = (next: boolean) => {
    setIsRestoring(next);
    onRestoringChange?.(next);
  };
  const balance = status?.balance?.credits ?? status?.lastBalance?.credits ?? null;
  const usageRows = privateUsageRows(sessions, credits.models, balance);

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader title="Private mode" titleRef={titleRef} titleId={titleId}>
        Qwen Code runs on models inside NEAR AI's secure hardware. Your code never reaches OpenAI or Anthropic, and the
        credits server never sees your prompts.
      </SettingsHeader>
      <BalanceCard
        status={status}
        refresh={credits.refresh}
        forget={credits.forget}
        onShowRecoveryCode={() => onShowRecoveryCode()}
        usageRows={usageRows}
        agentNameOf={agentNameOf}
        paymentSource={paymentSource}
      />
      <section aria-labelledby={topupHeadingId} className="flex flex-col">
        <div className="flex items-baseline gap-2 px-1 pb-2">
          <h2 id={topupHeadingId} className="text-caption font-medium text-fg-muted">
            Top-up
          </h2>
          {credits.stock && (
            <span className="ml-auto text-[11px] text-fg-subtle">
              {`Stock: ${formatCredits(credits.stock.availableCredits)}${
                credits.stock.availableCredits < LOW_STOCK_CREDITS ? " · more coming soon" : ""
              } · ${updatedAgo(credits.stock.updatedAt, Date.now()).replace(/^Updated/, "updated")}`}
            </span>
          )}
        </div>
        <div className="pb-4">
          {flow.kind === "idle" && (
            <TopupPicker
              stock={credits.stock}
              models={credits.models}
              modelsError={credits.modelsError}
              stockError={credits.stockError}
              isDisabled={isRedeeming}
              onBuy={(usd) => void credits.buy(usd)}
              onRetry={() => void loadCatalog()}
            />
          )}
          <TopupProgress
            flow={flow}
            balanceCredits={balance}
            onOpenCheckout={credits.openCheckout}
            onCancel={credits.cancel}
            onDismiss={credits.dismiss}
          />
        </div>
        <div className="flex flex-col rounded-xl border border-border bg-surface-2">
          <PromoField redeem={credits.redeem} isBlocked={isActive} onRedeeming={setIsRedeeming} />
        </div>
      </section>
      <details className="rounded-xl border border-border bg-surface-2 px-4 py-3">
        <summary className="cursor-pointer text-ui font-semibold text-fg">How credits work</summary>
        <div className="mt-2 flex flex-col gap-2 text-ui-sm text-fg-muted">
          <p>
            You buy credits at 1 credit = $0.01. Each model has its own price at NEAR AI; Zorvo adds 20% to cover
            payments and running the service.
          </p>
          <p>
            A typical turn on Qwen 3.8 27B uses about 0.4 credits; bigger models use more. Credits don't expire, can't
            be withdrawn, and work only on this Mac or the one you move them to.
          </p>
        </div>
      </details>
      <RecoveryCard
        revealCode={credits.revealCode}
        isAvailable={status?.device === "ready"}
        restoreBlockedReason={isActive ? RESTORE_BLOCKED : undefined}
        onRestore={() => setRestoring(true)}
      />
      <OwnKeySection
        credits={credits}
        paymentSource={paymentSource}
        onPaymentSourceChange={onPaymentSourceChange}
      />
      <SettingsGroup heading="Safety">
        <SettingsRow
          label={<span id={secretGuardLabelId}>Check messages for secrets before sending</span>}
          description="Zorvo looks for keys and passwords in what you send, on this Mac. The agent can still read files in the folder itself."
          control={
            <button
              type="button"
              role="switch"
              aria-checked={secretGuard}
              aria-labelledby={secretGuardLabelId}
              onClick={() => onSecretGuardChange(!secretGuard)}
              className={`focus-ring flex h-5 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                secretGuard ? "justify-end bg-fg" : "justify-start bg-border-strong"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-4 rounded-full transition-colors ${secretGuard ? "bg-bg" : "bg-fg"}`}
              />
            </button>
          }
        />
      </SettingsGroup>
      {isRestoring && (
        <RestoreDialog
          recover={credits.recover}
          onRestored={(newCode) => onShowRecoveryCode(newCode)}
          onClose={() => setRestoring(false)}
        />
      )}
    </div>
  );
}
