import type { PermissionChoice } from '../types';

/** Words an agent's tool title may start with; the title then reads as what it wants to do. */
const VERBS: ReadonlySet<string> = new Set([
  'edit',
  'write',
  'create',
  'delete',
  'remove',
  'move',
  'rename',
  'read',
  'run',
  'execute',
  'fetch',
  'open',
  'search',
  'install',
  'use',
]);

/** Whether the agent's title starts with a verb, so a sentence can carry it. */
export function titleHoldsPrompt(prompt: string): boolean {
  const first = prompt.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  return VERBS.has(first);
}

/**
 * A permission card's title as one sentence: "Claude Code wants to edit
 * src/app.ts" when the agent's title starts with a verb, else the plain
 * "Claude Code wants your permission", so it never reads as a broken sentence.
 */
export function permissionTitle(agentName: string, prompt: string): string {
  if (!titleHoldsPrompt(prompt)) return `${agentName} wants your permission`;
  const text = prompt.trim();
  return `${agentName} wants to ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** A question card's title: the agent asks, it does not ask for permission. */
export function questionsTitle(agentName: string, count: number): string {
  return count === 1 ? `${agentName} has a question for you` : `${agentName} has ${count} questions for you`;
}

/** Deny first, then Always allow, then Allow once: the safe choice is the first one you meet. */
function rank(option: PermissionChoice): number {
  if (!option.kind.startsWith('allow')) return 0;
  return option.kind === 'allow_once' ? 2 : 1;
}

/** The agent's options in the card's order, keeping the agent's order within each kind. */
export function orderedChoices(options: readonly PermissionChoice[]): PermissionChoice[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => rank(a.option) - rank(b.option) || a.index - b.index)
    .map(({ option }) => option);
}
