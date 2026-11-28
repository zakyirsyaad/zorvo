import type { ChatMessage, NextStep, NextStepAction } from '../types';
import { changesFiles } from './activity';

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

/** What the turn under the box did, and what its agent picked. */
export interface TurnScope {
  /** A reply of the turn completed a tool that changed a file. */
  turnChanged: boolean;
  /** The agent's pick in `wrap_up`, offered whatever the turn did when the facts allow it. */
  pick?: NextStepAction;
}

export type NextStepButton =
  | { kind: 'action'; action: NextStepAction; label: string; message?: string; isPick: boolean }
  | { kind: 'reply'; label: string; message: string };

export const ACTION_LABELS: Record<NextStepAction, string> = {
  commit: 'Commit',
  push: 'Push',
  create_pr: 'Create PR',
  merge: 'Merge',
  auto_merge: 'Turn on auto-merge',
  open_preview: "Open in Zorvo's browser",
  open_pr: 'Open PR',
};

const MESSAGES: Partial<Record<NextStepAction, string>> = {
  commit: 'Commit the changes you made.',
  push: 'Push this branch.',
  create_pr: 'Commit the changes you made, push them and open a pull request.',
  merge: 'Merge the pull request.',
  auto_merge: 'Turn on auto-merge for the pull request.',
};

const ACTIONS: readonly NextStepAction[] = ['commit', 'push', 'create_pr', 'merge', 'auto_merge', 'open_preview', 'open_pr'];

export const MAX_RECAP_CHARS = 300;
export const MAX_ASK_CHARS = 100;
export const MAX_REPLIES = 3;
export const MAX_REPLY_CHARS = 40;
const MAX_BUTTONS = 5;

/** The sentence a button sends as the user's message; none for the two that only open a page. */
export function messageOf(action: NextStepAction): string | undefined {
  return MESSAGES[action];
}

/**
 * Whether the last turn changed a file, as its own tools report: a tool that completed in a reply
 * after the user's last message. A subagent's tool counts, since it stays in the reply's `tools`.
 */
export function turnChangedFiles(messages: readonly ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user') return false;
    if ((message.tools ?? []).some((tool) => tool.status === 'completed' && changesFiles(tool))) return true;
  }
  return false;
}

/**
 * The actions the facts allow, in the order the box shows them. The facts are the whole folder's,
 * so an action that sends a message is offered only after a turn that changed a file, or as the
 * agent's own pick: otherwise a turn that only read would offer to commit someone else's work.
 */
export function offeredActions(facts: NextStepFacts, scope: TurnScope): NextStepAction[] {
  const openPr = facts.pr && facts.pr.state === 'open' ? facts.pr : undefined;
  const hasChanges = (facts.changes?.files ?? 0) > 0;
  const hasUnpushed = (facts.ahead ?? 0) > 0;
  const mayOffer = (action: NextStepAction) => scope.turnChanged || scope.pick === action;
  const offered: NextStepAction[] = [];
  if (hasChanges && mayOffer('commit')) offered.push('commit');
  if (hasUnpushed && mayOffer('push') && (scope.pick === 'push' || Boolean(openPr))) offered.push('push');
  if ((hasChanges || hasUnpushed) && !openPr && mayOffer('create_pr')) offered.push('create_pr');
  if (openPr) {
    const { failing, pending } = openPr.checks;
    const hasConflicts = openPr.mergeState === 'DIRTY';
    if (failing === 0 && pending === 0 && openPr.mergeState === 'CLEAN') {
      if (mayOffer('merge')) offered.push('merge');
    } else if (failing === 0 && pending > 0 && !hasConflicts && mayOffer('auto_merge')) offered.push('auto_merge');
  }
  if (facts.preview) offered.push('open_preview');
  if (openPr) offered.push('open_pr');
  return offered;
}

/** The box's buttons: the agent's pick first when offered, Zorvo's in order, then the replies; at most five. */
export function buttonsOf(step: NextStep | undefined, facts: NextStepFacts, turn: Pick<TurnScope, 'turnChanged'>): NextStepButton[] {
  const offered = offeredActions(facts, { turnChanged: turn.turnChanged, ...(step?.pick ? { pick: step.pick } : {}) });
  const pick = step?.pick && offered.includes(step.pick) ? step.pick : undefined;
  const hasChanges = (facts.changes?.files ?? 0) > 0;
  const hasUnpushed = (facts.ahead ?? 0) > 0;
  const actionMessage = (name: NextStepAction): string | undefined => {
    if (name === 'create_pr' && !hasChanges && hasUnpushed) return 'Push this branch and open a pull request.';
    return MESSAGES[name];
  };
  const action = (name: NextStepAction, isPick: boolean): NextStepButton => {
    const message = actionMessage(name);
    return {
      kind: 'action',
      action: name,
      label: ACTION_LABELS[name],
      ...(message ? { message } : {}),
      isPick,
    };
  };
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
  const keptReplies = rawReplies
    ? rawReplies
        .map((reply) => boundedText(reply, MAX_REPLY_CHARS))
        .filter((reply): reply is string => reply !== undefined)
        .slice(0, MAX_REPLIES)
    : undefined;
  const replies = keptReplies && keptReplies.length > 0 ? keptReplies : undefined;
  const answer = input.answered as { label?: unknown; at?: unknown } | undefined;
  const answered =
    typeof answer === 'object' && answer !== null && typeof answer.label === 'string' && answer.label.length > 0 && typeof answer.at === 'number'
      ? { label: answer.label, at: answer.at }
      : undefined;
  const step: NextStep = {
    ...(recap ? { recap } : {}),
    ...(ask ? { ask } : {}),
    ...(pick ? { pick } : {}),
    ...(replies ? { replies } : {}),
    ...(answered ? { answered } : {}),
  };
  return Object.keys(step).length > 0 ? step : null;
}
