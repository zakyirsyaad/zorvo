import type { SlashCommand } from '../types';

/** The text typed after `/` while the user is still choosing a command, or null. */
export function slashQuery(text: string): string | null {
  return /^\/\S*$/.test(text) ? text.slice(1).toLowerCase() : null;
}

/** 0 for a name that starts with the query, 1 for a later `:`- or `-` segment that does, else null. */
function matchRank(name: string, query: string): number | null {
  const lower = name.toLowerCase();
  if (lower.startsWith(query)) return 0;
  return lower.split(/[:-]/).some((segment) => segment.startsWith(query)) ? 1 : null;
}

export function matchingCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  return commands
    .flatMap((command) => {
      const rank = matchRank(command.name, needle);
      return rank === null ? [] : [{ command, rank }];
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ command }) => command);
}

/**
 * Whether a message is a command for the agent: a slash and a name, then white space or the end. The
 * agent's list is not asked, since it can arrive after a session's first message and need not name
 * every command. A path has a second slash, so it is text.
 */
export function isSlashCommand(text: string): boolean {
  return /^\/[^\s/]+(?:\s|$)/.test(text);
}

/** The hint of the command the prompt starts with, while its input is still empty. */
export function pendingHint(commands: readonly SlashCommand[], text: string): string | undefined {
  const match = /^\/(\S+) $/.exec(text);
  return match ? commands.find((c) => c.name === match[1])?.hint : undefined;
}
