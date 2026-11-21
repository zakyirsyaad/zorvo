import type { AgentName } from "./agent-logos";

export interface StripAgent {
  /** The agent's id in the registry Zorvo reads. */
  id: string;
  /** The name the site uses, which for a few agents is shorter than the registry's. */
  name: string;
  /** One of the four agents the site has a colour logo for. */
  logo?: AgentName;
}

/**
 * The agents the landing page's strip names. Every one is in the registry Zorvo reads (a test checks
 * the ids against the copy bundled with the app), and the icons come from that copy too: see
 * scripts/build-agent-icons.mjs.
 */
export const STRIP_AGENTS: readonly StripAgent[] = [
  { id: "claude-acp", name: "Claude Code", logo: "Claude Code" },
  { id: "codex-acp", name: "Codex", logo: "Codex" },
  { id: "qwen-code", name: "Qwen Code", logo: "Qwen Code" },
  { id: "antigravity-acp", name: "Antigravity", logo: "Antigravity" },
  { id: "cursor", name: "Cursor" },
  { id: "github-copilot-cli", name: "GitHub Copilot" },
  { id: "opencode", name: "OpenCode" },
  { id: "goose", name: "goose" },
  { id: "cline", name: "Cline" },
  { id: "amp-acp", name: "Amp" },
  { id: "junie", name: "Junie" },
  { id: "kimi", name: "Kimi CLI" },
  { id: "mistral-vibe", name: "Mistral Vibe" },
  { id: "devin", name: "Devin" },
  { id: "factory-droid", name: "Factory Droid" },
  { id: "pi-acp", name: "Pi" },
  { id: "kilo", name: "Kilo" },
  { id: "auggie", name: "Auggie CLI" },
];
