import { useId, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { PrivateCredits } from "../../hooks/usePrivateCredits";
import {
  formatCredits,
  LOW_BALANCE_CREDITS,
  modelLabel,
  type PrivateStatus,
} from "../../lib/private-credits";
import { formatUsageCredits, usageLead, usageUsd } from "../../lib/private-usage";
import type { ChatMessage, Session } from "../../types";
import { Button } from "../ui/Button";

/** NEAR AI's public page that checks a model's attestation and a reply's signature in the browser (docs.near.ai/cloud/verification/verification-center). */
export const VERIFICATION_CENTER_URL = "https://cloud.near.ai/verify";

/**
 * The page for one model's deployment. Without `?model=` the page only asks for one (seen live
 * 2026-11-14); it has no address for a single reply, so the link names the model, never a chat id.
 */
export function verificationCenterUrl(modelId: string | undefined): string {
  const id = modelId?.trim();
  return id ? `${VERIFICATION_CENTER_URL}?model=${encodeURIComponent(id)}` : VERIFICATION_CENTER_URL;
}

const WHERE_IT_RUNS =
  "NEAR AI Cloud, inside Intel TDX and NVIDIA confidential computing. The credits server never sees your prompts.";

export interface PrivateInspectorProps {
  session: Pick<Session, "privateMode" | "privateUsage">;
  /** What the app already read: the status, and the models once Settings or the draft's chip loaded them. Nothing is asked here. */
  credits: Pick<PrivateCredits, "status" | "models">;
  /** The session's replies, to count its turns and verified answers. */
  messages?: ChatMessage[];
  onTopUp: () => void;
  onOpenUrl: (url: string) => void;
}

function balanceText(status: PrivateStatus | null): string {
  if (status === null) return "Checking…";
  return formatCredits(status.balance?.credits ?? status.lastBalance?.credits ?? 0);
}

/** A small muted heading over its content, named for screen readers as a region. */
function Section({ heading, children }: { heading: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-caption font-medium text-fg-muted">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/** The inspector's Private tab: the model and turns a private session runs, its verification and balance. */
export function PrivateInspector({
  session,
  credits,
  messages = [],
  onTopUp,
  onOpenUrl,
}: PrivateInspectorProps) {
  const modelId = session.privateMode?.modelId ?? "";
  // The label only once the catalog says the model is one of the private ones; till then its id.
  const isKnownModel = credits.models?.some((model) => model.id === modelId) === true;
  const model = isKnownModel ? modelLabel(modelId) : modelId;
  const shownCredits =
    credits.status === null
      ? null
      : credits.status.balance?.credits ?? credits.status.lastBalance?.credits ?? 0;
  const turns = messages.filter((message) => message.role === "user").length;
  const answers = messages.filter((message) => message.role === "agent");
  const verified = answers.filter((message) => message.verification?.state === "verified").length;
  const usage = session.privateUsage ?? { credits: 0, estimated: false };
  const sessionCap = session.privateMode?.sessionCap;
  const cappedUsed = Math.floor(usage.credits);
  const average =
    turns > 0 && session.privateUsage !== undefined ? formatUsageCredits(usage.credits / turns) : "—";

  if (session.privateMode?.ownKey === true) {
    return (
      <aside aria-label="Private panel" className="flex h-full min-h-0 flex-1 flex-col bg-surface-1 text-ui text-fg-secondary">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
          <dl className="flex flex-col text-ui-sm">
            <div className="flex items-center gap-2 border-b border-border py-2">
              <dt className="flex-1 text-fg-muted">Paying with</dt>
              <dd className="text-fg-secondary">Your NEAR AI key</dd>
            </div>
            <div className="flex items-center gap-2 border-b border-border py-2">
              <dt className="flex-1 text-fg-muted">This session</dt>
              <dd className="text-fg-secondary">{usageUsd(usage.credits)}</dd>
            </div>
            <div className="flex items-center gap-2 py-2">
              <dt className="flex-1 text-fg-muted">Verified answers</dt>
              <dd className="flex items-center gap-1.5 text-fg-secondary">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-running" />
                {`${verified} of ${answers.length}`}
              </dd>
            </div>
          </dl>
          <p className="text-ui-sm text-fg-subtle">
            Shown in dollars, the way NEAR AI bills your organization. Zorvo credits aren't used, and no session limit
            applies.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label="Private panel" className="flex h-full min-h-0 flex-1 flex-col bg-surface-1 text-ui text-fg-secondary">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        <Section heading="This session">
          {sessionCap !== undefined ? (
            <>
              <span className="text-2xl font-semibold leading-[30px] tracking-[-0.02em] text-fg">
                {cappedUsed}{" "}
                <span className="text-ui-sm font-medium tracking-normal text-fg-muted">of {sessionCap} credits</span>
              </span>
              <div
                role="progressbar"
                aria-label="Session credit cap"
                aria-valuenow={cappedUsed}
                aria-valuemin={0}
                aria-valuemax={sessionCap}
                className="h-1 overflow-hidden rounded-full bg-surface-hover"
              >
                <div
                  className="h-full bg-fg-secondary"
                  style={{ width: `${Math.min(100, (cappedUsed / sessionCap) * 100)}%` }}
                />
              </div>
              <span className="text-caption text-fg-subtle">
                NEAR AI stops this session at {sessionCap} credits, even if Zorvo is closed.
              </span>
            </>
          ) : (
            <span className="text-2xl font-semibold leading-[30px] tracking-[-0.02em] text-fg">
              {usageLead(usage.credits, usage.estimated)}
            </span>
          )}
        </Section>
        <dl className="flex flex-col text-ui-sm">
          <div className="flex items-center gap-2 border-b border-border py-2">
            <dt className="flex-1 text-fg-muted">Model</dt>
            <dd className="min-w-0 truncate text-fg-secondary">{model}</dd>
          </div>
          <div className="flex items-center gap-2 border-b border-border py-2">
            <dt className="flex-1 text-fg-muted">Turns</dt>
            <dd className="text-fg-secondary">{turns}</dd>
          </div>
          <div className="flex items-center gap-2 border-b border-border py-2">
            <dt className="flex-1 text-fg-muted">Verified answers</dt>
            <dd className="flex items-center gap-1.5 text-fg-secondary">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-running" />
              {`${verified} of ${answers.length}`}
            </dd>
          </div>
          <div className="flex items-center gap-2 py-2">
            <dt className="flex-1 text-fg-muted">Average per turn</dt>
            <dd className="text-fg-secondary">{average}</dd>
          </div>
        </dl>
        <div
          role="region"
          aria-label="Balance"
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3"
        >
          <div className="flex items-center gap-2">
            <span className="flex-1 text-caption font-medium text-fg-muted">Balance</span>
            {shownCredits !== null && shownCredits < LOW_BALANCE_CREDITS && (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-attention" />
            )}
            <span className="text-ui-sm text-fg-secondary">{balanceText(credits.status)}</span>
          </div>
          <Button variant="outline" className="w-full" onClick={onTopUp}>
            Top up
          </Button>
        </div>
        <Section heading="Where it runs">
          <p className="text-ui-sm text-fg-secondary">{WHERE_IT_RUNS}</p>
          <Button
            variant="ghost"
            tone="secondary"
            size="sm"
            className="self-start"
            icon={<ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />}
            onClick={() => onOpenUrl(verificationCenterUrl(modelId))}
          >
            Open the Verification Center
          </Button>
        </Section>
      </div>
    </aside>
  );
}