import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import type { KeyCheck, PaymentSource } from "../../lib/private-credits";
import { Button } from "../ui/Button";
import { SettingsGroup, SettingsRow } from "../settings/SettingsGroup";
import { PrivateDialog } from "./PrivateDialog";

export interface OwnKeySectionProps {
  credits: Pick<PrivateCredits, "status" | "refresh">;
  paymentSource: PaymentSource;
  onPaymentSourceChange: (source: PaymentSource) => void;
}

type CheckState = "idle" | "checking" | "accepted" | "noCredits" | "invalid" | "unreachable" | "failed";

const CHECK_DEBOUNCE_MS = 400;
const KEY_INPUT =
  "h-8 w-full rounded-lg border border-border-strong bg-ground px-2.5 font-mono text-ui text-fg " +
  "placeholder:text-fg-subtle focus-ring disabled:opacity-40";

function checkStateText(state: CheckState): string | undefined {
  switch (state) {
    case "checking":
      return "Checking this key with NEAR AI…";
    case "accepted":
      return "NEAR AI accepted this key";
    case "noCredits":
      return "NEAR AI accepted this key, but your organization has no credits yet.";
    case "invalid":
      return "NEAR AI didn't accept this key.";
    case "unreachable":
      return "Couldn't check this key with NEAR AI. Try again.";
    case "failed":
      return "Couldn't check this key.";
    case "idle":
      return undefined;
  }
}

function addedLabel(iso: string | null | undefined): string {
  if (!iso) return "added";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "added";
  const today = new Date();
  return date.toDateString() === today.toDateString() ? "added today" : "added earlier";
}

/** Settings → Private mode → Your own NEAR AI key: the key, and which key sessions spend. */
export function OwnKeySection({ credits, paymentSource, onPaymentSourceChange }: OwnKeySectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<CheckState>("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const status = credits.status?.ownKey;
  const trimmed = key.trim();

  useEffect(() => {
    if (!isOpen || trimmed === "") {
      setCheck("idle");
      return;
    }
    setCheck("checking");
    let alive = true;
    const timer = setTimeout(() => {
      void invoke<KeyCheck>("private_check_own_key", { key: trimmed })
        .then((answer) => {
          if (alive) setCheck(answer === "accepted" ? "accepted" : "noCredits");
        })
        .catch((error: unknown) => {
          if (!alive) return;
          const code = typeof error === "string" ? error : "";
          setCheck(code === "unauthorized" ? "invalid" : code === "unreachable" ? "unreachable" : "failed");
        });
    }, CHECK_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [isOpen, trimmed]);

  const open = () => {
    setKey("");
    setCheck("idle");
    setIsOpen(true);
  };

  const save = async () => {
    if (trimmed === "" || isSaving || (check !== "accepted" && check !== "noCredits")) return;
    setIsSaving(true);
    try {
      await invoke("private_set_own_key", { key: trimmed });
      await credits.refresh(true);
      onPaymentSourceChange("ownKey");
      setIsOpen(false);
      setKey("");
    } catch (error) {
      const code = typeof error === "string" ? error : "";
      setCheck(code === "unauthorized" ? "invalid" : code === "unreachable" ? "unreachable" : "failed");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await invoke("private_remove_own_key");
      await credits.refresh(true);
      if (paymentSource === "ownKey") onPaymentSourceChange("credits");
    } catch {
      setRemoveError("Couldn't remove the key from your Keychain. Try again.");
    } finally {
      setIsRemoving(false);
    }
  };

  const description = checkStateText(check);
  const saveDisabled = trimmed === "" || isSaving || (check !== "accepted" && check !== "noCredits");
  const dotClass =
    check === "accepted" ? "bg-status-running" : check === "noCredits" || check === "unreachable" ? "bg-status-attention" : "bg-danger";

  return (
    <>
      <SettingsGroup heading="Your own NEAR AI key">
        <SettingsRow
          label="Use my own NEAR AI key"
          description="For NEAR holders who earn credits by staking in their own NEAR AI organization. Zorvo keeps the key in your Keychain and uses it instead of Zorvo credits."
          control={<Button onClick={open}>Add key</Button>}
        />
        {status?.saved && (
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-fg-subtle">
                {`sk-••••••••${status.last4 ?? ""} · ${addedLabel(status.addedAt)}`}
              </span>
              <Button variant="ghost" tone="danger" size="sm" disabled={isRemoving} onClick={() => void remove()}>
                Remove key
              </Button>
            </div>
            {removeError && (
              <span role="alert" className="text-ui-sm text-danger">
                {removeError}
              </span>
            )}
            <div className="flex items-center gap-3">
              <span id={labelId} className="text-ui text-fg">
                Private sessions pay with
              </span>
              <div role="radiogroup" aria-labelledby={labelId} className="flex rounded-lg border border-border bg-chip p-0.5">
                {(
                  [
                    ["credits", "Zorvo credits"],
                    ["ownKey", "My NEAR AI key"],
                  ] as const
                ).map(([source, text]) => (
                  <button
                    key={source}
                    type="button"
                    role="radio"
                    aria-checked={paymentSource === source}
                    onClick={() => onPaymentSourceChange(source)}
                    className={`focus-ring h-6.5 rounded-md px-2.5 text-ui-sm ${
                      paymentSource === source ? "bg-surface-hover text-fg" : "text-fg-muted"
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
            {status.noCredits && (
              <span className="flex items-center gap-2 text-ui-sm text-fg-secondary">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-attention" />
                NEAR AI has no credits for this key yet.
              </span>
            )}
          </div>
        )}
      </SettingsGroup>
      {isOpen && (
        <PrivateDialog
          title="Use your own NEAR AI key"
          initialFocusRef={inputRef}
          onEscape={isSaving ? undefined : () => setIsOpen(false)}
          footer={
            <>
              <Button variant="ghost" tone="secondary" disabled={isSaving} onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={saveDisabled} onClick={() => void save()}>
                Use this key
              </Button>
            </>
          }
        >
          <p className="text-ui text-fg-muted">
            Create a key in your NEAR AI dashboard and paste it here. Credits you earn by staking pay for your private
            sessions.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-ui-sm font-medium text-fg-secondary">NEAR AI key</span>
            <input
              ref={inputRef}
              type="password"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              className={KEY_INPUT}
              value={key}
              disabled={isSaving}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          {description && (
            <span role="status" className="flex items-center gap-2 text-ui-sm text-fg-secondary">
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
              {description}
            </span>
          )}
          <p className="text-ui-sm text-fg-subtle">
            Kept in your Keychain, never sent to the credits server. Your Zorvo credits stay; you can switch back any
            time.
          </p>
        </PrivateDialog>
      )}
    </>
  );
}