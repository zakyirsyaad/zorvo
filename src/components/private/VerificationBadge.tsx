import { useState, type ReactNode } from "react";
import { Loader2, ShieldCheck, ShieldMinus, ShieldX } from "lucide-react";
import type { MessageVerification, VerificationKind, VerificationState } from "../../types";
import { shortSigner, VERIFICATION_LABEL } from "../../lib/private-verification";
import { VERIFICATION_CENTER_URL } from "./PrivateInspector";
import { Chip } from "../ui/Chip";
import { Popover } from "../ui/Popover";

const LOOK: Record<
  VerificationState,
  { icon: typeof ShieldCheck; chip: string; iconClass: string }
> = {
  verified: { icon: ShieldCheck, chip: "", iconClass: "text-status-running" },
  didnt_verify: { icon: ShieldX, chip: "border-danger text-danger", iconClass: "" },
  not_signed: { icon: ShieldMinus, chip: "text-fg-muted", iconClass: "" },
  checking: { icon: Loader2, chip: "text-fg-muted", iconClass: "animate-spin" },
};

const BODY: Record<"didnt_verify" | "not_signed" | "checking", string> = {
  didnt_verify: "The signature doesn't match this answer. Treat the answer as unverified.",
  not_signed:
    "The answer was cut off before NEAR AI could sign it, for example when you pressed Stop. It ran on the same hardware; it just can't be proven.",
  checking: "Right after the answer ends, for a second or two.",
};

function kindLabel(kind: VerificationKind | undefined): string {
  if (kind === "provider_tee") return "provider TEE";
  if (kind === "gateway") return "gateway";
  return "unknown signer";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
      <dt className="w-24 shrink-0 text-caption text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-fg-secondary">{children}</dd>
    </div>
  );
}

export interface VerificationBadgeProps {
  verification: MessageVerification;
  /** The model that made the calls, for the popover's Model row. */
  modelId?: string;
  onOpenUrl?: (url: string) => void;
}

/**
 * A private reply's signature state: a 24px outlined badge, with the verified signer beside it and
 * the canvas's details in the popover. Hashes and prompts are never shown.
 */
export function VerificationBadge({ verification, modelId, onOpenUrl }: VerificationBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const look = LOOK[verification.state];
  const Icon = look.icon;
  const label = VERIFICATION_LABEL[verification.state];

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <Popover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        trigger={
          <Chip
            variant="outline"
            textSize="ui-sm"
            onClick={() => setIsOpen((open) => !open)}
            label={`${label}. Show how this answer was verified`}
            title="Show how this answer was verified"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            className={look.chip}
            icon={
              <Icon
                size={12}
                strokeWidth={1.75}
                aria-hidden="true"
                className={look.iconClass}
                data-verification-icon={verification.state}
              />
            }
          >
            {label}
          </Chip>
        }
        label="Signature"
        role="dialog"
        align="start"
      >
        {verification.state === "verified" ? (
          <div className="flex w-72 flex-col gap-3.5 p-[18px]">
            <div className="flex items-center gap-2 pb-2">
              <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" className="text-status-running" />
              <span className="text-ui font-semibold text-fg">Verified in TEE</span>
            </div>
            <dl className="flex flex-col">
              <Row label="Model">
                <span className="font-mono text-caption">{modelId ?? "—"}</span>
              </Row>
              <Row label="Signed by">
                <span className="font-mono text-caption">
                  {verification.signer
                    ? `${shortSigner(verification.signer)} · ${kindLabel(verification.kind)}`
                    : "—"}
                </span>
              </Row>
              <Row label="Checked">
                <span className="text-ui-sm">The request and the answer match their signed hashes</span>
              </Row>
            </dl>
            <button
              type="button"
              className="focus-ring mt-2 self-start text-left text-ui-sm text-fg-secondary hover:text-fg"
              onClick={() => onOpenUrl?.(VERIFICATION_CENTER_URL)}
            >
              Check it yourself in NEAR AI's Verification Center
            </button>
          </div>
        ) : (
          <div className="flex w-72 flex-col gap-3.5 p-[18px]">
            <p className="text-ui-sm text-fg-secondary">{BODY[verification.state]}</p>
          </div>
        )}
      </Popover>
      {verification.state === "verified" && verification.signer && (
        <span className="font-mono text-caption text-fg-subtle">signed by {shortSigner(verification.signer)}</span>
      )}
    </div>
  );
}