import { useState } from 'react';
import { pickableAgentIds } from '../lib/compare-run';

export interface UseCompareDraftOptions {
  /** The agent a new session would start with when none is ticked. */
  primaryAgentId: string | null | undefined;
  /** Only a git repository can run several agents, each in its own worktree. */
  isRepository: boolean;
  /**
   * Whether an agent may be part of a compare run: in use, installed and not asking for a sign-in.
   * An agent ticked earlier that stops being tickable drops out of the ticked set; every agent
   * is tickable when absent.
   */
  isTickable?: (agentId: string) => boolean;
  /** Called with the agent a draft is left with once one remains (or the first ticked, on leaving a repository), so the picked agent follows. */
  onSingle?: (agentId: string) => void;
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
export function useCompareDraft({
  primaryAgentId,
  isRepository,
  isTickable = () => true,
  onSingle,
}: UseCompareDraftOptions): CompareDraft {
  const [ticked, setTicked] = useState<string[]>([]);
  // A draft that leaves a repository drops its ticks (they come back neither on return nor silently): the first stays picked.
  if (!isRepository && ticked.length > 0) {
    setTicked([]);
    const first = ticked.find(isTickable);
    if (first) onSingle?.(first);
  }
  const primary = primaryAgentId ? [primaryAgentId] : [];
  const stillTicked = ticked.filter(isTickable);
  const agentIds = isRepository && stillTicked.length > 0 ? stillTicked : primary;

  const toggle = (agentId: string) => {
    if (!isRepository) return;
    // The only agent cannot start yet (install or sign-in): that panel comes first, so no second is added.
    if (agentIds.length === 1 && !isTickable(agentIds[0])) return;
    if (!agentIds.includes(agentId) && !isTickable(agentId)) return;
    const next = pickableAgentIds(agentIds, agentId);
    if (next.length === 0) return;
    if (next.length === 1) {
      setTicked([]);
      onSingle?.(next[0]);
    } else {
      setTicked(next);
    }
  };

  return { agentIds, isCompare: agentIds.length >= 2, toggle, reset: () => setTicked([]) };
}
