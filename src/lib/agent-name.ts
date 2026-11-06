/**
 * An agent's name for copy ("This is Claude Code's own report…"), from the agent App already looked up for the
 * session. A removed agent is still listed, so it keeps its name; an id Zorvo no longer knows at all reads "the agent",
 * never the raw id ("gone-acp").
 */
export function agentNameOr(agent: { name: string } | undefined): string {
  return agent?.name ?? "the agent";
}
