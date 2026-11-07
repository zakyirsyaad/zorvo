import { useState, type Ref } from "react";
import type { PrivateCredits } from "../../hooks/usePrivateCredits";
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
}

/**
 * Settings → Private mode: the credits Qwen Code's private sessions use, how to add more, and the
 * recovery code that moves them to another Mac. Zorvo holds no card or key here; the backend does.
 */
export function PrivateSection({ titleRef, titleId, credits, onShowRecoveryCode }: PrivateSectionProps) {
  const { status, flow } = credits;
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const isActive = isTopupActive(flow);
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
              isDisabled={isRedeeming}
              onBuy={(usd) => void credits.buy(usd)}
              onRetry={() => void credits.refresh()}
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
      <RecoveryCard
        revealCode={credits.revealCode}
        isAvailable={status?.device === "ready"}
        onRestore={() => setIsRestoring(true)}
      />
      {isRestoring && (
        <RestoreDialog
          recover={credits.recover}
          onRestored={(newCode) => onShowRecoveryCode(newCode)}
          onClose={() => setIsRestoring(false)}
        />
      )}
    </div>
  );
}
