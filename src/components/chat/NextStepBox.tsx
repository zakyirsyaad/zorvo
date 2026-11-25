import { useId } from "react";
import { GitBranch, Reply } from "lucide-react";
import { Button } from "../ui/Button";
import { ZorvoSymbol } from "../ui/ZorvoSymbol";
import { ACTION_LABELS, buttonsOf, type NextStepButton, type NextStepFacts } from "../../lib/next-step";
import type { NextStep } from "../../types";

/** What the main window hands the box under the newest finished turn. */
export interface NextStepView {
  messageId: string;
  facts: NextStepFacts;
  /** Why the composer cannot send now; the message buttons are disabled with it. */
  blockedReason?: string;
  /** A press is being sent: every button waits. */
  isSending: boolean;
  onPress: (button: NextStepButton) => void;
}

interface NextStepBoxProps {
  step?: NextStep;
  agentName: string;
  /** The active box's facts and actions; null for an earlier turn's box; undefined in a popout. */
  view: NextStepView | null | undefined;
}

function checksLine(checks: { passing: number; failing: number; pending: number }): string | null {
  const total = checks.passing + checks.failing + checks.pending;
  if (total === 0) return null;
  if (checks.failing > 0) return `${checks.failing} ${checks.failing === 1 ? "check" : "checks"} failed`;
  if (checks.pending > 0) return `${checks.passing} of ${total} checks done`;
  return `${checks.passing} ${checks.passing === 1 ? "check" : "checks"} passed`;
}

function factChips(facts: NextStepFacts): string[] {
  const chips: string[] = [];
  if (facts.changes) {
    const { files, added, removed } = facts.changes;
    chips.push(`${files} ${files === 1 ? "file" : "files"} +${added} −${removed}`, "Not committed");
  }
  const ahead = facts.ahead ?? 0;
  if (ahead > 0) chips.push(facts.hasUpstream ? `${ahead} ${ahead === 1 ? "commit" : "commits"} not pushed` : "Not pushed");
  if (facts.pr) {
    const state = facts.pr.state.charAt(0).toUpperCase() + facts.pr.state.slice(1);
    chips.push(`PR #${facts.pr.number} · ${state}`);
    const checks = checksLine(facts.pr.checks);
    if (checks) chips.push(checks);
    if (facts.pr.mergeState === "DIRTY") chips.push("Conflicts");
  }
  if (facts.preview) chips.push(`localhost:${facts.preview.port}`);
  return chips;
}

/** The buttons an earlier turn's box or a popout shows: the agent's pick and replies, as words. */
function inertButtons(step: NextStep | undefined): string[] {
  return [...(step?.pick ? [ACTION_LABELS[step.pick]] : []), ...(step?.replies ?? [])];
}

/**
 * The next step under a finished turn: the agent's recap and question from `wrap_up`, what Zorvo
 * sees in the repository, and buttons that send their words as the user's message. Copy and look
 * follow the artboards `NextStepChat` and `NextStepStates`.
 */
export function NextStepBox({ step, agentName, view }: NextStepBoxProps) {
  const pickId = useId();
  const isActive = view !== null && view !== undefined;
  const facts = isActive ? view.facts : {};
  const chips = factChips(facts);
  const buttons = isActive ? buttonsOf(step, facts) : [];
  const hasAgentPart = Boolean(step?.recap || step?.ask);
  if (!hasAgentPart && chips.length === 0 && buttons.length === 0 && !step?.answered) return null;

  const pick = buttons[0]?.kind === "action" && buttons[0].isPick ? buttons[0] : null;
  const source = step?.recap ? "Next step" : `${agentName} finished`;

  const isDisabled = (button: NextStepButton) =>
    !isActive || view.isSending || (view.blockedReason !== undefined && button.message !== undefined);

  return (
    <section
      aria-label="Next step"
      className={`mt-4 flex w-full flex-col gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3.5 ${isActive ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-1.5 text-ui-sm text-fg-subtle">
        <ZorvoSymbol className="size-3.5" strokeWidth={4.2} />
        {source}
      </div>
      {step?.recap && <p className="whitespace-pre-wrap break-words text-ui text-fg-secondary">{step.recap}</p>}
      {chips.length > 0 && (
        <ul aria-label="What Zorvo sees" className="flex flex-wrap gap-1.5">
          {facts.branch && (
            <li className="flex h-[22px] items-center gap-1 rounded-md bg-chip px-1.5 font-mono text-ui-sm text-fg-secondary">
              <GitBranch size={11} aria-hidden="true" />
              {facts.branch}
            </li>
          )}
          {chips.map((chip) => (
            <li key={chip} className="flex h-[22px] items-center rounded-md bg-chip px-1.5 text-ui-sm text-fg-secondary">
              {chip}
            </li>
          ))}
        </ul>
      )}
      {step?.ask && <p className="text-ui font-semibold text-fg">{step.ask}</p>}
      {isActive && buttons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {buttons.map((button, index) => (
            <Button
              key={`${button.kind}-${button.label}`}
              variant={index === 0 && pick ? "primary" : button.kind === "reply" ? "ghost" : "outline"}
              size="sm"
              icon={button.kind === "reply" ? <Reply size={12} aria-hidden="true" /> : undefined}
              disabled={isDisabled(button)}
              aria-describedby={index === 0 && pick ? pickId : undefined}
              onClick={() => view.onPress(button)}
            >
              {button.label}
            </Button>
          ))}
          {pick && (
            <span id={pickId} className="ml-auto text-ui-sm text-fg-subtle">
              {agentName} suggests {pick.label}
            </span>
          )}
        </div>
      )}
      {view === null && (step?.answered || inertButtons(step).length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {inertButtons(step).map((label) => (
            <Button key={label} variant="outline" size="sm" disabled>
              {label}
            </Button>
          ))}
          {step?.answered && <span className="ml-auto text-ui-sm text-fg-subtle">You answered {step.answered.label}</span>}
        </div>
      )}
      {isActive && view.blockedReason && <p className="text-ui-sm text-fg-muted">{view.blockedReason}</p>}
      {view === undefined && <p className="text-ui-sm text-fg-muted">Answer in the main window.</p>}
    </section>
  );
}
