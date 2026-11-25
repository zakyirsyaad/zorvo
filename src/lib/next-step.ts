import type { NextStep, NextStepAction } from '../types';

export type { NextStep, NextStepAction } from '../types';

/** What Zorvo knows about the session's repository at a turn's end; any part may be missing. */
export interface NextStepFacts {
  branch?: string;
  /** Uncommitted changes against HEAD. */
  changes?: { files: number; added: number; removed: number };
  /** Commits on the branch that its upstream does not have. */
  ahead?: number;
  hasUpstream?: boolean;
  isDefaultBranch?: boolean;
  pr?: {
    number: number;
    url: string;
    state: string;
    checks: { passing: number; failing: number; pending: number };
    mergeState?: string;
  };
  /** A dev server the agent started. */
  preview?: { port: number; command: string };
}

export type NextStepButton =
  | { kind: 'action'; action: NextStepAction; label: string; message?: string; isPick: boolean }
  | { kind: 'reply'; label: string; message: string };

export const ACTION_LABELS: Record<NextStepAction, string> = {
  commit: 'Commit',
  create_pr: 'Create PR',
  merge: 'Merge',
  auto_merge: 'Turn on auto-merge',
  open_preview: "Open in Zorvo's browser",
  open_pr: 'Open PR',
};

const MESSAGES: Partial<Record<NextStepAction, string>> = {
  commit: 'Commit these changes.',
  create_pr: 'Commit, push and open a pull request.',
  merge: 'Merge the pull request.',
  auto_merge: 'Turn on auto-merge for the pull request.',
};

const ACTIONS: readonly NextStepAction[] = ['commit', 'create_pr', 'merge', 'auto_merge', 'open_preview', 'open_pr'];

export const MAX_RECAP_CHARS = 300;
export const MAX_ASK_CHARS = 100;
export const MAX_REPLIES = 2;
export const MAX_REPLY_CHARS = 24;
const MAX_BUTTONS = 5;

/** The sentence a button sends as the user's message; none for the two that only open a page. */
export function messageOf(action: NextStepAction): string | undefined {
  return MESSAGES[action];
}

/** The actions the facts allow, in the order the box shows them. */
export function offeredActions(facts: NextStepFacts): NextStepAction[] {
  const openPr = facts.pr && facts.pr.state === 'open' ? facts.pr : undefined;
  const hasChanges = (facts.changes?.files ?? 0) > 0;
  const hasUnpushed = (facts.ahead ?? 0) > 0;
  const offered: NextStepAction[] = [];
  if (hasChanges) offered.push('commit');
  if ((hasChanges || hasUnpushed) && !openPr) offered.push('create_pr');
  if (openPr) {
    const { failing, pending } = openPr.checks;
    const hasConflicts = openPr.mergeState === 'DIRTY';
    if (failing === 0 && pending === 0 && openPr.mergeState === 'CLEAN') offered.push('merge');
    else if (failing === 0 && pending > 0 && !hasConflicts) offered.push('auto_merge');
  }
  if (facts.preview) offered.push('open_preview');
  if (openPr) offered.push('open_pr');
  return offered;
}

/** The box's buttons: the agent's pick first when offered, Zorvo's in order, then the replies; at most five. */
export function buttonsOf(step: NextStep | undefined, facts: NextStepFacts): NextStepButton[] {
  const offered = offeredActions(facts);
  const pick = step?.pick && offered.includes(step.pick) ? step.pick : undefined;
  const action = (name: NextStepAction, isPick: boolean): NextStepButton => ({
    kind: 'action',
    action: name,
    label: ACTION_LABELS[name],
    ...(MESSAGES[name] ? { message: MESSAGES[name] } : {}),
    isPick,
  });
  const replies: NextStepButton[] = (step?.replies ?? []).map((label) => ({ kind: 'reply', label, message: label }));
  const picked = pick ? [action(pick, true)] : [];
  const room = Math.max(0, MAX_BUTTONS - picked.length - replies.length);
  const rest = offered.filter((name) => name !== pick).slice(0, room).map((name) => action(name, false));
  return [...picked, ...rest, ...replies];
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : undefined;
}

function isAction(value: unknown): value is NextStepAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/** A `wrap_up` result or a saved step, each field kept only when it has its shape and limit; null when nothing is left. */
export function parseNextStep(raw: unknown): NextStep | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const recap = boundedText(input.recap, MAX_RECAP_CHARS);
  const ask = boundedText(input.ask, MAX_ASK_CHARS);
  const pick = isAction(input.pick) ? input.pick : undefined;
  const rawReplies = Array.isArray(input.replies) ? input.replies : undefined;
  const replies =
    rawReplies && rawReplies.length <= MAX_REPLIES
      ? rawReplies.map((reply) => boundedText(reply, MAX_REPLY_CHARS))
      : undefined;
  const keptReplies = replies && replies.length > 0 && replies.every((reply) => reply !== undefined) ? (replies as string[]) : undefined;
  const answer = input.answered as { label?: unknown; at?: unknown } | undefined;
  const answered =
    typeof answer === 'object' && answer !== null && typeof answer.label === 'string' && answer.label.length > 0 && typeof answer.at === 'number'
      ? { label: answer.label, at: answer.at }
      : undefined;
  const step: NextStep = {
    ...(recap ? { recap } : {}),
    ...(ask ? { ask } : {}),
    ...(pick ? { pick } : {}),
    ...(keptReplies ? { replies: keptReplies } : {}),
    ...(answered ? { answered } : {}),
  };
  return Object.keys(step).length > 0 ? step : null;
}
