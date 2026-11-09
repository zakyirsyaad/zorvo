import { useEffect, useId, useRef, useState } from "react";
import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import { formatCredits } from "../../lib/private-credits";
import { Button } from "../ui/Button";
import { SettingsRow } from "../settings/SettingsGroup";

export interface PromoFieldProps {
  redeem: PrivateCredits["redeem"];
  /** A top-up is created or followed: a promo would replace its hold. */
  isBlocked: boolean;
  /** Tells the section a redeem is in flight, so the packages stay out of its way. */
  onRedeeming: (isRedeeming: boolean) => void;
}

const INPUT =
  "h-8 w-44 rounded-lg border border-border-strong bg-bg px-2.5 font-mono text-ui text-fg " +
  "placeholder:text-fg-subtle focus-ring disabled:opacity-40";

/** A code from Zorvo: its credits land in the balance as a top-up. */
export function PromoField({ redeem, isBlocked, onRedeeming }: PromoFieldProps) {
  const [code, setCode] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const labelId = useId();
  const isAlive = useRef(true);

  useEffect(() => {
    isAlive.current = true;
    return () => {
      isAlive.current = false;
    };
  }, []);

  const trimmed = code.trim();
  const submit = async () => {
    if (isBusy || isBlocked || trimmed === "") return;
    setIsBusy(true);
    setResult(null);
    onRedeeming(true);
    const answer = await redeem(trimmed);
    onRedeeming(false);
    if (!isAlive.current) return;
    setIsBusy(false);
    if (answer.ok) {
      setCode("");
      setResult({ ok: true, text: `${formatCredits(answer.credits)} added. Enjoy.` });
    } else {
      setResult({ ok: false, text: answer.text });
    }
  };

  return (
    <SettingsRow
      label={<span id={labelId}>Promo code</span>}
      description={
        <>
          Got a code from Zorvo? Its credits land here.
          <span
            role="status"
            className={`mt-1 flex min-h-4 items-center gap-1.5 ${
              result?.ok === false ? "text-fg-secondary" : "text-fg-muted"
            }`}
          >
            {result && (
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${
                  result.ok ? "bg-status-running" : "bg-status-attention"
                }`}
              />
            )}
            {result?.text}
          </span>
        </>
      }
      control={
        <>
          <input
            type="text"
            aria-labelledby={labelId}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="ZORVO-HACK-…"
            className={INPUT}
            value={code}
            disabled={isBusy}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
          <Button disabled={isBlocked || isBusy || trimmed === ""} onClick={() => void submit()}>
            Redeem
          </Button>
        </>
      }
    />
  );
}
