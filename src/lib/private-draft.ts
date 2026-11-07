// Zorvo Private in the new-session draft: whether the Private chip shows, and whether a private
// session can start yet. Pure: no invoke, no React.
import { canonicalAgentId } from './persistence';
import type { ModelPrice, PrivateStatus } from './private-credits';

/** The one agent that runs privately (the backend refuses any other with `not_qwen`). */
export const PRIVATE_AGENT_ID = 'qwen-code';

export const PRIVATE_DRAFT_TEXT = {
  qwenOnly: 'Private sessions run Qwen Code only for now.',
  oneAgent: 'Private sessions run one agent.',
  checking: 'Checking your credits…',
  moved: 'Your credits moved to another Mac.',
  addCredits: 'Add credits to start a private session',
  loadingModels: 'Loading the private models…',
  modelsFailed: "Couldn't load the private models. Try again.",
} as const;

export type PrivateChipKind = 'hidden' | 'off' | 'on' | 'disabled';

export interface PrivateDraftInput {
  /** The agents the draft would start: one, or several for a compare run. */
  agentIds: readonly string[];
  /** The user turned the chip on. */
  on: boolean;
  /** null until the first status read answers. */
  status: PrivateStatus | null;
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

function creditsOf(status: PrivateStatus): number {
  return status.balance?.credits ?? status.lastBalance?.credits ?? 0;
}

/** What keeps an on chip from starting, or undefined once it can. */
function waitingFor(input: PrivateDraftInput): string | undefined {
  const { status, models } = input;
  if (status === null) return PRIVATE_DRAFT_TEXT.checking;
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
  if (canonicalAgentId(agentIds[0]) !== PRIVATE_AGENT_ID) {
    return { chip: 'disabled', reason: PRIVATE_DRAFT_TEXT.qwenOnly, canStart: true };
  }
  if (!input.on) return { chip: 'off', canStart: true };
  const note = waitingFor(input);
  return note === undefined ? { chip: 'on', canStart: true } : { chip: 'on', canStart: false, note };
}
