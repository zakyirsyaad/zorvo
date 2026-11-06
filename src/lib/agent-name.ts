/**
 * An agent's name for copy ("This is Claude Code's own report…"). A removed agent is still listed, so it keeps its
 * name; an id Zorvo no longer knows at all reads "the agent", never the raw id ("gone-acp").
 */
export function agentNameOr(agents: readonly { id: string; name: string }[], profileId: string): string {
  return agents.find((agent) => agent.id === profileId)?.name ?? "the agent";
}
