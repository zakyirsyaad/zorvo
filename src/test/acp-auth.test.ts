import { describe, it, expect } from "vitest";
import { authCopy, isSetupOnly, parseAuthRequired, signInButtonLabel, type AuthMethod } from "../lib/acp-auth";

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

  it("reads Qwen Code's older terminal method as the agent's own setup", () => {
    // Qwen Code 0.26.6's only method, as its `initialize` reports it.
    const qwen = [
      {
        id: "openai",
        name: "Use OpenAI API key",
        description: "Requires setting the `OPENAI_API_KEY` environment variable",
        _meta: { type: "terminal", args: ["--auth-type=openai"] },
      },
    ];

    const methods = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(qwen)}`);

    expect(methods).toHaveLength(1);
    expect(methods?.[0]).toMatchObject({ id: "openai", kind: "setup" });
  });

  it("still explains a method that needs a key, even with other _meta", () => {
    const methods = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(codexMethods)}`);

    expect(methods?.[0].kind).toBe("explain");
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
    expect(authCopy("Codex", [key, login])).toMatchObject({ lead: "Pick how Codex signs in. It uses its own tool; Zorvo never sees your password or key.", cliHint: null });
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

describe("GLM Agent's methods", () => {
  // As glm-acp-agent 1.15.0 reports them in `initialize`: one with no type, one `env_var`.
  const glm = [
    {
      id: "z-ai-api-key",
      name: "Z.AI API key",
      description: "Set Z_AI_API_KEY in the environment, or run `glm-acp-agent --setup` once to store the key on disk.",
    },
    {
      type: "env_var",
      id: "z_ai_api_key",
      name: "Z.AI API key",
      description: "API key for the Z.AI / Zhipu AI service.",
      link: "https://z.ai/manage-apikey/apikey-list",
      vars: [{ name: "Z_AI_API_KEY", label: "Z.AI API key", secret: true, optional: false }],
    },
  ];

  it("explains both, so the panel shows no button and no key field", () => {
    const methods = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(glm)}`);

    expect(methods?.map((method) => method.kind)).toEqual(["explain", "explain"]);
    expect(methods?.[0].description).toBe("Set Z_AI_API_KEY in the environment, or run glm-acp-agent --setup once to store the key on disk.");
  });

  it("leads with the key it needs and says Zorvo never stores it", () => {
    const methods = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(glm)}`) ?? [];

    const copy = authCopy("GLM Agent", methods);

    expect(copy.lead).toBe("GLM Agent needs an API key or another account setting before it can start.");
    expect(copy.keysNote).toMatch(/^Zorvo never stores keys\./);
  });
});

describe("an agent's own setup", () => {
  const setup: AuthMethod = { id: "openai", name: "Use OpenAI API key", kind: "setup" };
  const agent: AuthMethod = { id: "browser", name: "Sign in", kind: "agent" };

  it("isSetupOnly is true only when every method is the agent's setup", () => {
    expect(isSetupOnly([])).toBe(false);
    expect(isSetupOnly([setup])).toBe(true);
    expect(isSetupOnly([setup, agent])).toBe(false);
  });

  it("leads a setup-only agent with its setup, with no keys note or command line hint", () => {
    expect(authCopy("Qwen Code", [setup])).toEqual({
      lead: "Qwen Code needs its own setup before it can start.",
      cliHint: null,
      keysNote: null,
    });
  });

  it("counts the setup among the ways in, not among the keys", () => {
    expect(authCopy("Qwen Code", [setup, agent]).lead).toBe("Pick how Qwen Code signs in. It uses its own tool; Zorvo never sees your password or key.");
    expect(authCopy("Qwen Code", [setup, agent]).keysNote).toBeNull();
  });
});

describe("text an agent writes about its methods", () => {
  it("is cut to a length the UI can show, and the verb rule still applies to the name", () => {
    const long = [{ id: "m", name: `Log in with ${"x".repeat(200)}`, description: "d".repeat(1000) }];

    const [method] = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(long)}`) ?? [];

    expect(method.name).toHaveLength(80);
    expect(method.name.endsWith("…")).toBe(true);
    expect(method.description).toHaveLength(300);
    expect(signInButtonLabel(method)).toBe(method.name);
  });

  it("keeps a short name and description whole", () => {
    const short = [{ id: "m", name: "ChatGPT", description: "Use ChatGPT" }];

    expect(parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(short)}`)?.[0]).toMatchObject({
      name: "ChatGPT",
      description: "Use ChatGPT",
    });
  });
});
