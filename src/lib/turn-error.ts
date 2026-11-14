/** What the user reads about a failed turn: a plain summary, one hint, and the agent's own words on request. */
export interface TurnErrorExplanation {
  /** The notice's title: what happened, in a few words. */
  title: string;
  /** The sentence under the title: the hint, or the agent's own words; absent when the title says it all. */
  body?: string;
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
  if (!raw) return { title: "The agent's turn failed.", summary: "The agent's turn failed." };
  if (NETWORK_FAILURE.test(raw)) {
    const summary = `${agentName ?? "The agent"} could not reach the network.`;
    const hint = "Check your connection or proxy, then try again.";
    return { title: summary, body: hint, summary, hint, details: error };
  }
  // The agent's words are the body as they came: they may hold any punctuation, so nothing is split.
  return { title: "The agent's turn failed", body: error, summary: `The agent's turn failed: ${error}` };
}
