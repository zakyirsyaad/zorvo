import { useState } from 'react';
import { pickableAgentIds } from '../lib/compare-run';

export interface UseCompareDraftOptions {
  /** The agent a new session would start with when none is ticked. */
  primaryAgentId: string | null | undefined;
  /** Only a git repository can run several agents, each in its own worktree. */
  isRepository: boolean;
}

export interface CompareDraft {
  /** The agents ticked, in the order ticked; the primary one alone until another is ticked. */
  agentIds: string[];
  /** Two or more are ticked. */
  isCompare: boolean;
  /** Ticks or unticks an agent, up to the most a run can hold; the last one ticked stays. */
  toggle: (agentId: string) => void;
  /** Back to the primary agent alone. */
  reset: () => void;
}

/** Which agents the new-session draft has ticked for a compare run. */
export function useCompareDraft({ primaryAgentId, isRepository }: UseCompareDraftOptions): CompareDraft {
  const [ticked, setTicked] = useState<string[]>([]);
  const primary = primaryAgentId ? [primaryAgentId] : [];
  const agentIds = isRepository && ticked.length > 0 ? ticked : primary;

  const toggle = (agentId: string) => {
    if (!isRepository) return;
    const next = pickableAgentIds(agentIds, agentId);
    if (next.length > 0) setTicked(next);
  };

  return { agentIds, isCompare: agentIds.length >= 2, toggle, reset: () => setTicked([]) };
}
