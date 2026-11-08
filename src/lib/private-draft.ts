// Zorvo Private in the new-session draft: whether the Private chip shows, and whether a private
// session can start yet. Pure: no invoke, no React.
import { canonicalAgentId } from './persistence';
import type { ModelPrice, PrivateStatus } from './private-credits';

/** The one agent that runs privately (the backend refuses any other with `not_qwen`). */
export const PRIVATE_AGENT_ID = 'qwen-code';

export const PRIVATE_DRAFT_TEXT = {
  oneAgent: 'Private sessions run one agent.',
  checking: 'Checking your credits…',
  statusFailed: "Couldn't check your credits. Try again.",
  moved: 'Your credits moved to another Mac.',
  addCredits: 'Add credits to start a private session',
  loadingModels: 'Loading the private models…',
  modelsFailed: "Couldn't load the private models. Try again.",
} as const;

export type PrivateChipKind = 'hidden' | 'off' | 'on' | 'disabled';

export interface PrivateDraftInput {
  /** The agents the draft would start: one, or several for a compare run. */
  agentIds: readonly string[];
  /** The agent's displayed name, for the disabled chip's reason. */
  agentName?: string;
  /** Where that agent sends code, for the disabled chip's reason. */
  agentProvider?: string;
  /** The user turned the chip on. */
  on: boolean;
  /** null until the first status read answers. */
  status: PrivateStatus | null;
  /** The last status read failed; only matters while no status was ever read. */
  statusFailed?: boolean;
  models: ModelPrice[] | null;
  /** A catalog load is running, so missing models are on their way rather than failed. */
  isLoadingModels?: boolean;
}

export interface PrivateDraftState {
  chip: PrivateChipKind;
  /** Why the chip is disabled; its accessible description. */
  reason?: string;
  /** False while an on chip waits for something; the draft then cannot send. */
  canStart: boolean;
  /** What an on chip waits for, said under the prompt. */
  note?: string;
}

const AGENT_NAMES: Readonly<Record<string, string>> = {
  'claude-acp': 'Claude Code',
  'codex-acp': 'Codex',
  'gemini': 'Gemini CLI',
  'goose': 'Goose',
};

const AGENT_PROVIDERS: Readonly<Record<string, string>> = {
  'claude-acp': 'Anthropic',
  'codex-acp': 'OpenAI',
  'gemini': 'Google',
  'goose': 'Block',
};

function creditsOf(status: PrivateStatus): number {
  return status.balance?.credits ?? status.lastBalance?.credits ?? 0;
}

/** What keeps an on chip from starting, or undefined once it can. */
function waitingFor(input: PrivateDraftInput): string | undefined {
  const { status, models } = input;
  if (status === null) return input.statusFailed ? PRIVATE_DRAFT_TEXT.statusFailed : PRIVATE_DRAFT_TEXT.checking;
  if (status.device === 'moved') return PRIVATE_DRAFT_TEXT.moved;
  if (status.device === 'none' || !status.keyReady || creditsOf(status) <= 0) return PRIVATE_DRAFT_TEXT.addCredits;
  if (models === null && input.isLoadingModels) return PRIVATE_DRAFT_TEXT.loadingModels;
  if (models === null || models.length === 0) return PRIVATE_DRAFT_TEXT.modelsFailed;
  return undefined;
}

/**
 * The draft's Private chip: shown for Qwen Code alone, disabled (with the reason) for another agent or a
 * compare run, and, while on, what the private start still waits for. An off or disabled chip changes
 * nothing about the draft.
 */
export function privateDraftState(input: PrivateDraftInput): PrivateDraftState {
  const { agentIds } = input;
  if (agentIds.length === 0) return { chip: 'hidden', canStart: true };
  if (agentIds.length > 1) return { chip: 'disabled', reason: PRIVATE_DRAFT_TEXT.oneAgent, canStart: true };
  const agentId = canonicalAgentId(agentIds[0]);
  if (agentId !== PRIVATE_AGENT_ID) {
    const agent = input.agentName ?? AGENT_NAMES[agentId] ?? agentId;
    const provider = input.agentProvider ?? AGENT_PROVIDERS[agentId] ?? 'its provider';
    return {
      chip: 'disabled',
      reason: `Private mode works with Qwen Code for now. ${agent} sends your code to ${provider}.`,
      canStart: true,
    };
  }
  if (!input.on) return { chip: 'off', canStart: true };
  const note = waitingFor(input);
  return note === undefined ? { chip: 'on', canStart: true } : { chip: 'on', canStart: false, note };
}
