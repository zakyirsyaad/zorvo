import claudeCodeLogo from "../../src/assets/agents/claude-code.svg";
import codexLogo from "../../src/assets/agents/codex.svg";
import geminiLogo from "../../src/assets/agents/gemini.svg";
import qwenLogo from "../../src/assets/agents/qwen.svg";

// Next imports an image as { src }, Vite (the app's tests render this page) as a URL string.
type LogoImport = string | { src: string };

const logoUrl = (logo: LogoImport): string => (typeof logo === "string" ? logo : logo.src);

export type AgentName = "Claude Code" | "Codex" | "Qwen Code" | "Gemini CLI";

/** The same logo files the app shows (see src/assets/agents/README.md for their source and licence). */
export const AGENT_LOGOS: Readonly<Record<AgentName, string>> = {
  "Claude Code": logoUrl(claudeCodeLogo),
  Codex: logoUrl(codexLogo),
  "Qwen Code": logoUrl(qwenLogo),
  "Gemini CLI": logoUrl(geminiLogo),
};
