/** What the user reads about a failed turn: a plain summary, one hint, and the agent's own words on request. */
export interface TurnErrorExplanation {
  summary: string;
  /** What the user can do about it; absent for an error Zorvo does not know. */
  hint?: string;
  /** The agent's raw error, shown behind "Details"; absent when the summary already holds it. */
  details?: string;
}

const NETWORK_FAILURE = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i;

/**
 * Explains a raw turn error from an agent. The list of known errors is closed:
 * anything else keeps its raw text, as the agent worded it.
 */
export function explainTurnError(agentName: string | undefined, error: string): TurnErrorExplanation {
  const raw = error.trim();
  if (!raw) return { summary: "The agent's turn failed." };
  if (NETWORK_FAILURE.test(raw)) {
    return {
      summary: `${agentName ?? "The agent"} could not reach the network.`,
      hint: "Check your connection or proxy, then try again.",
      details: error,
    };
  }
  return { summary: `The agent's turn failed: ${error}` };
}
