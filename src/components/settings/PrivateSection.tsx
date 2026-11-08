import { useEffect, useState, type Ref } from "react";
import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import { useLatest } from "../../hooks/useLatest";
import { isTopupActive } from "../../lib/private-flow";
import { BalanceCard } from "../private/BalanceCard";
import { PromoField } from "../private/PromoField";
import { RecoveryCard } from "../private/RecoveryCard";
import { RestoreDialog } from "../private/RestoreDialog";
import { TopupPicker } from "../private/TopupPicker";
import { TopupProgress } from "../private/TopupProgress";
import { SettingsGroup, SettingsHeader } from "./SettingsGroup";

export interface PrivateSectionProps {
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  credits: PrivateCredits;
  /** Asks the app for its recovery-code dialog: for the stored code, or for a new one from a restore. */
  onShowRecoveryCode: (code?: string) => void;
  /** Tells the app a restore is open or running, so no second recovery dialog opens over it. */
  onRestoringChange?: (isRestoring: boolean) => void;
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
}: PrivateSectionProps) {
  const { status, flow, loadCatalog } = credits;
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
      />
      <SettingsGroup heading="Top-up">
        <div className="border-b border-border p-4">
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
        <PromoField redeem={credits.redeem} isBlocked={isActive} onRedeeming={setIsRedeeming} />
      </SettingsGroup>
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
