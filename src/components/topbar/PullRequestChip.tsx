import { Check, Circle, GitPullRequest, X } from "lucide-react";
import { Chip } from "../ui/Chip";
import type { PullRequestStatus } from "../../hooks/usePullRequest";

const STATE_STYLE: Record<string, string> = {
  open: "text-status-running",
  draft: "text-fg-muted",
  merged: "text-status-merged",
  closed: "text-danger",
};

/** "open" reads "Open"; a state gh adds later still reads as a word. */
function stateWord(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/** How the checks stand, in a word: failing beats running beats passing. */
function checksWord({ passing, failing, pending }: PullRequestStatus["checks"]): "failing" | "running" | "passing" | null {
  if (failing > 0) return "failing";
  if (pending > 0) return "running";
  return passing > 0 ? "passing" : null;
}

/** The open session's pull request in the top bar: its number, its state as a word and its checks; a click opens it. */
export function PullRequestChip({ pullRequest, onOpen }: { pullRequest: PullRequestStatus; onOpen: (url: string) => void }) {
  const state = pullRequest.isDraft && pullRequest.state === "open" ? "draft" : pullRequest.state;
  const checks = checksWord(pullRequest.checks);
  const label = [`Pull request #${pullRequest.number}`, state, checks && `checks ${checks}`].filter(Boolean).join(", ");
  return (
    <Chip
      variant="plain"
      icon={<GitPullRequest size={12} className={STATE_STYLE[state] ?? "text-fg-muted"} />}
      label={label}
      title={`${pullRequest.title}\n${label}`}
      onClick={() => onOpen(pullRequest.url)}
      className="shrink-0"
    >
      <span className="font-mono text-fg-muted">#{pullRequest.number}</span>
      <span className="text-fg-secondary">{stateWord(state)}</span>
      {checks === "passing" && <Check size={11} aria-hidden="true" className="text-status-running" />}
      {checks === "failing" && <X size={11} aria-hidden="true" className="text-danger" />}
      {checks === "running" && <Circle size={8} aria-hidden="true" className="fill-status-attention text-status-attention" />}
    </Chip>
  );
}
