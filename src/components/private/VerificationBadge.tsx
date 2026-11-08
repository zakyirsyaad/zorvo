import { useState } from "react";
import { ExternalLink, Loader2, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import type { MessageVerification, VerificationState } from "../../types";
import {
  signedCallsText,
  shortSigner,
  VERIFICATION_LABEL,
  verificationKindText,
} from "../../lib/private-verification";
import { VERIFICATION_CENTER_URL } from "./PrivateInspector";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Popover } from "../ui/Popover";

const LOOK: Record<VerificationState, { icon: typeof ShieldCheck; className: string }> = {
  verified: { icon: ShieldCheck, className: "text-status-running" },
  didnt_verify: { icon: ShieldAlert, className: "text-danger" },
  not_signed: { icon: ShieldOff, className: "text-fg-subtle" },
  checking: { icon: Loader2, className: "text-fg-muted" },
};

function detailOf(verification: MessageVerification): string {
  if (verification.state === "verified") return verificationKindText(verification.kind);
  if (verification.state === "didnt_verify") return "A call in this answer did not verify.";
  if (verification.state === "checking") return "Zorvo is checking NEAR AI's signature.";
  return "NEAR AI did not sign this answer.";
}

export interface VerificationBadgeProps {
  verification: MessageVerification;
  onOpenUrl?: (url: string) => void;
}

/**
 * A private reply's signature state, with the honest kind and signer in a popover. The badge is a
 * chip: its text is the state, and the panel explains it without ever showing a hash or a prompt.
 */
export function VerificationBadge({ verification, onOpenUrl }: VerificationBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const look = LOOK[verification.state];
  const Icon = look.icon;
  const label = VERIFICATION_LABEL[verification.state];

  return (
    <div className="mt-1.5 flex">
      <Popover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        trigger={
          <Chip
            variant="plain"
            onClick={() => setIsOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
          >
            <Icon
              size={12}
              strokeWidth={1.75}
              aria-hidden="true"
              className={`${look.className} ${verification.state === "checking" ? "animate-spin" : ""}`}
            />
            <span className={look.className}>{label}</span>
          </Chip>
        }
        label="Signature"
        role="dialog"
        align="start"
      >
        <div className="flex w-64 flex-col gap-2 p-1.5">
          <p className="text-ui-sm text-fg-secondary">{detailOf(verification)}</p>
          {verification.state === "verified" && (
            <p className="text-caption text-fg-subtle">
              {signedCallsText(verification)}
              {verification.signer ? ` · ${shortSigner(verification.signer)}` : ""}
            </p>
          )}
          {verification.state !== "verified" && (
            <p className="text-caption text-fg-subtle">{signedCallsText(verification)}</p>
          )}
          <Button
            variant="ghost"
            tone="secondary"
            size="sm"
            className="self-start"
            icon={<ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />}
            onClick={() => onOpenUrl?.(VERIFICATION_CENTER_URL)}
          >
            Open the Verification Center
          </Button>
        </div>
      </Popover>
    </div>
  );
}