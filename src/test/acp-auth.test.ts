import { describe, it, expect } from "vitest";
import { authCopy, parseAuthRequired, signInButtonLabel, type AuthMethod } from "../lib/acp-auth";

const codexMethods = [
  { id: "api-key", name: "API Key", description: "Use an API key to authenticate", _meta: { "api-key": { provider: "openai" } } },
  { id: "chat-gpt", name: "ChatGPT", description: "Use ChatGPT to authenticate" },
];

describe("parseAuthRequired", () => {
  it("reads the agent's sign-in methods from an auth-required error", () => {
    const methods = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(codexMethods)}`);

    expect(methods).toEqual([
      { id: "api-key", name: "API Key", description: "Use an API key to authenticate", kind: "explain" },
      { id: "chat-gpt", name: "ChatGPT", description: "Use ChatGPT to authenticate", kind: "agent" },
    ]);
  });

  it("explains methods the user must set up in a terminal through _meta", () => {
    const qwen = [{ id: "openai", name: "Use OpenAI API key", _meta: { type: "terminal", args: ["--auth-type=openai"] } }];

    expect(parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(qwen)}`)?.[0].kind).toBe("explain");
  });

  it("marks a type terminal method as a terminal sign-in", () => {
    const claude = [
      { id: "claude-ai-login", name: "Claude Subscription", type: "terminal", args: ["--cli", "auth", "login", "--claudeai"] },
    ];

    expect(parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(claude)}`)).toEqual([
      { id: "claude-ai-login", name: "Claude Subscription", kind: "terminal" },
    ]);
  });

  it("explains a method of a type the app does not run, such as env_var", () => {
    const envVar = [{ id: "gemini-key", name: "Gemini API key", type: "env_var", varName: "GEMINI_API_KEY" }];

    expect(parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(envVar)}`)?.[0].kind).toBe("explain");
  });

  it("returns null for any other error, and no methods for a malformed list", () => {
    expect(parseAuthRequired("session/new failed: boom")).toBeNull();
    expect(parseAuthRequired(new Error("x"))).toBeNull();
    expect(parseAuthRequired("ACP_AUTH_REQUIRED:not json")).toEqual([]);
  });
});

describe("method descriptions", () => {
  it("drops the backticks around a variable name", () => {
    const qwen = [
      {
        id: "openai",
        name: "Use OpenAI API key",
        description: "Requires setting the `OPENAI_API_KEY` environment variable",
        _meta: { type: "terminal", args: ["--auth-type=openai"] },
      },
    ];

    expect(parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(qwen)}`)?.[0].description).toBe(
      "Requires setting the OPENAI_API_KEY environment variable",
    );
  });
});

describe("signInButtonLabel", () => {
  const method = (name: string): AuthMethod => ({ id: "m", name, kind: "agent" });

  it("uses the method's name whole when it already starts with a verb", () => {
    expect(signInButtonLabel(method("Log in with Google"))).toBe("Log in with Google");
    expect(signInButtonLabel(method("Sign in with Qwen"))).toBe("Sign in with Qwen");
    expect(signInButtonLabel(method("Use ChatGPT"))).toBe("Use ChatGPT");
  });

  it("puts Sign in with before a name that is only a noun", () => {
    expect(signInButtonLabel(method("Claude Subscription"))).toBe("Sign in with Claude Subscription");
    expect(signInButtonLabel(method("ChatGPT (device code)"))).toBe("Sign in with ChatGPT (device code)");
  });
});

describe("authCopy", () => {
  const key: AuthMethod = { id: "api-key", name: "API Key", kind: "explain" };
  const login: AuthMethod = { id: "chat-gpt", name: "ChatGPT", kind: "agent" };

  it("asks for a sign-in when the agent offers one", () => {
    expect(authCopy("Codex", [key, login])).toMatchObject({ lead: "Codex needs you to sign in before it can start.", cliHint: null });
  });

  it("does not ask an agent whose only method is a key to sign in", () => {
    const copy = authCopy("Qwen Code", [key]);

    expect(copy.lead).toBe("Qwen Code needs an API key or another account setting before it can start.");
    expect(copy.cliHint).toBeNull();
    expect(copy.keysNote).toMatch(/^Zorvo never stores keys\./);
  });

  it("points to the command line tool when the agent listed no method", () => {
    expect(authCopy("Codex", []).cliHint).toBe("Sign in with Codex's own command line tool, then check again.");
  });
});
