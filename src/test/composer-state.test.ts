import { describe, it, expect, vi } from "vitest";
import { COMPOSER_PLACEHOLDERS, composerCommandsFor, composerNote, composerPlaceholder, composerStateFor, type ComposerInputs } from "../lib/composer-state";
import { NO_CHOICES, withRewound, type AgentOptions } from "../lib/acp-draft";
import { TRANSPORT_ACP, type AgentProfile, type Session, type SlashCommand } from "../types";

const IDLE = { isRunning: false, isCreatingWorktree: false, isResumable: false, canStartSession: false };

describe("composerPlaceholder", () => {
  it("shows none in a running session, and says what the next message does otherwise", () => {
    expect(composerPlaceholder({ ...IDLE, isRunning: true, isCreatingWorktree: true })).toBeUndefined();
    expect(composerPlaceholder({ ...IDLE, isCreatingWorktree: true, isResumable: true })).toBe(
      COMPOSER_PLACEHOLDERS.creatingWorktree,
    );
    expect(composerPlaceholder({ ...IDLE, isResumable: true, canStartSession: true })).toBe(COMPOSER_PLACEHOLDERS.resume);
    expect(composerPlaceholder({ ...IDLE, canStartSession: true })).toBe(COMPOSER_PLACEHOLDERS.newSession);
    expect(composerPlaceholder(IDLE)).toBe(COMPOSER_PLACEHOLDERS.noWorkspace);
  });

  it("says an ended session is continued while its agent must be installed, as the note does", () => {
    // Not resumable (its agent is not installed), yet the next message continues the session.
    const ended = { ...IDLE, canStartSession: true, isEndedSession: true };
    expect(composerPlaceholder({ ...ended, isSendBlocked: true })).toBe(COMPOSER_PLACEHOLDERS.resume);
    expect(composerNote({ continuesSession: true, agentToInstall: "Codex" })).toBe("Install Codex to continue this session.");
    // Not blocked: today's wording stays.
    expect(composerPlaceholder(ended)).toBe(COMPOSER_PLACEHOLDERS.newSession);
    // Blocked, but no session is shown: a new one starts.
    expect(composerPlaceholder({ ...IDLE, canStartSession: true, isSendBlocked: true })).toBe(COMPOSER_PLACEHOLDERS.newSession);
  });

  it("is not where a blocked Send is explained: that is the note, which stays while typing", () => {
    // An agent to install or sign in to does not change what the empty box says.
    expect(composerPlaceholder({ ...IDLE, canStartSession: true })).toBe(COMPOSER_PLACEHOLDERS.newSession);
    expect(composerPlaceholder({ ...IDLE, isResumable: true, canStartSession: true })).toBe(COMPOSER_PLACEHOLDERS.resume);
  });
});

describe("composerCommandsFor", () => {
  const live: SlashCommand[] = [{ name: "init", description: "Set up" }];
  const remembered: SlashCommand[] = [{ name: "review", description: "Review" }];
  const acpAgent = { id: "qwen" } as AgentProfile;
  const options = { qwen: { modes: null, configOptions: [], commands: remembered } };

  it("offers a running session's own commands", () => {
    expect(composerCommandsFor({ isRunning: true, liveCommands: live, draftAgent: acpAgent, agentOptions: options })).toBe(live);
  });

  it("offers the commands an ACP agent reported last time before it runs", () => {
    expect(composerCommandsFor({ isRunning: false, liveCommands: undefined, draftAgent: acpAgent, agentOptions: options })).toBe(
      remembered,
    );
    expect(
      composerCommandsFor({ isRunning: false, liveCommands: undefined, draftAgent: { id: "other" } as AgentProfile, agentOptions: options }),
    ).toBeUndefined();
  });
});

describe("withRewound", () => {
  const remembered: Record<string, AgentOptions> = {
    qwen: { modes: null, configOptions: [], preferredConfig: { model: "max" }, commands: [] },
  };
  const rewound = {
    configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "coder", options: [] }],
    preferredConfig: { model: "coder" },
  };

  it("puts a rewound session's own picks and lists in place of the agent's remembered ones", () => {
    const options = withRewound(remembered, "qwen", rewound);

    expect(options?.qwen.preferredConfig).toEqual({ model: "coder" });
    expect(options?.qwen.configOptions).toBe(rewound.configOptions);
    expect(options?.qwen.commands).toEqual([]);
    expect(remembered.qwen.preferredConfig).toEqual({ model: "max" });
  });

  it("leaves the remembered options as they are without a rewound session", () => {
    expect(withRewound(remembered, "qwen", undefined)).toBe(remembered);
    expect(withRewound(remembered, undefined, rewound)).toBe(remembered);
  });

  it("works for an agent with nothing remembered yet", () => {
    expect(withRewound(undefined, "qwen", rewound)?.qwen).toMatchObject({ modes: null, preferredConfig: { model: "coder" } });
  });
});

describe("composerStateFor", () => {
  const info = {
    modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan" }] },
    configOptions: [],
  };
  const setMode = vi.fn();
  const acp = { info: { "s-1": info }, setMode, setConfigOption: vi.fn() } as unknown as ComposerInputs["acp"];
  const running = (transport: string) => ({ id: "s-1", status: "running", transport }) as Session;
  const draftAgent = { id: "qwen" } as AgentProfile;
  const inputs = (overrides: Partial<ComposerInputs>): ComposerInputs => ({
    session: undefined,
    draftAgent: undefined,
    acpChoices: NO_CHOICES,
    setAcpChoices: vi.fn(),
    agentOptions: undefined,
    acp,
    ...overrides,
  });

  it("builds a running ACP session's controls from what its agent reported", () => {
    const state = composerStateFor(inputs({ session: running(TRANSPORT_ACP) }));

    expect(state.controls.permission?.options.map((o) => o.label)).toEqual(["Default", "Plan"]);
    state.controls.permission?.onChange("plan");
    expect(setMode).toHaveBeenCalledWith("s-1", "plan");
  });

  describe("models", () => {
    const models = {
      currentModelId: "auto",
      availableModels: [
        { modelId: "auto", name: "Auto" },
        { modelId: "flash", name: "Flash" },
      ],
    };
    const gemini = { id: "gemini" } as AgentProfile;

    it("switches a running session's model and tells which agent it was for once the agent took it", async () => {
      const setModel = vi.fn().mockResolvedValue(true);
      const onPickModel = vi.fn();
      const live = { info: { "s-1": { modes: null, configOptions: [], models } }, setModel } as unknown as ComposerInputs["acp"];
      const session = { ...running(TRANSPORT_ACP), profileId: "gemini" } as Session;

      const state = composerStateFor(inputs({ session, acp: live, onPickModel }));
      state.controls.model?.onChange("flash");

      expect(setModel).toHaveBeenCalledWith("s-1", "flash");
      await vi.waitFor(() => expect(onPickModel).toHaveBeenCalledWith("gemini", "flash"));
    });

    it("does not remember a model the agent refused", async () => {
      const setModel = vi.fn().mockResolvedValue(false);
      const onPickModel = vi.fn();
      const live = { info: { "s-1": { modes: null, configOptions: [], models } }, setModel } as unknown as ComposerInputs["acp"];
      const session = { ...running(TRANSPORT_ACP), profileId: "gemini" } as Session;

      composerStateFor(inputs({ session, acp: live, onPickModel })).controls.model?.onChange("flash");
      await Promise.resolve();

      expect(setModel).toHaveBeenCalled();
      expect(onPickModel).not.toHaveBeenCalled();
    });

    it("keeps a draft's model pick and remembers it for the agent", () => {
      const setAcpChoices = vi.fn();
      const onPickModel = vi.fn();

      const state = composerStateFor(
        inputs({ draftAgent: gemini, agentOptions: { gemini: { modes: null, configOptions: [], models } }, setAcpChoices, onPickModel }),
      );
      expect(state.controls.model?.selected).toBe("auto");
      state.controls.model?.onChange("flash");

      expect(setAcpChoices).toHaveBeenCalledWith({ config: {}, modelId: "flash" });
      expect(onPickModel).toHaveBeenCalledWith("gemini", "flash");
    });
  });

  it("offers no controls while a running ACP session has reported nothing", () => {
    const state = composerStateFor(inputs({ session: running(TRANSPORT_ACP), acp: { ...acp, info: {} } as ComposerInputs["acp"] }));

    expect(state).toEqual({ controls: {} });
  });

  it("offers no controls without a draft agent", () => {
    expect(composerStateFor(inputs({}))).toEqual({ controls: {} });
  });

  it("builds a draft agent's controls from the options it reported last time", () => {
    const setAcpChoices = vi.fn();
    const state = composerStateFor(
      inputs({ draftAgent, setAcpChoices, agentOptions: { qwen: { modes: info.modes, configOptions: [] } } }),
    );

    expect(state.controls.permission?.selected).toBe("default");
    state.controls.permission?.onChange("plan");
    expect(setAcpChoices).toHaveBeenCalledWith({ config: {}, modeId: "plan" });
  });

  it("offers a draft agent that reported nothing no controls", () => {
    expect(composerStateFor(inputs({ draftAgent, agentOptions: {} }))).toEqual({ controls: {} });
  });
});

describe("composerNote", () => {
  it("says why Send is blocked, in the words of the placeholder", () => {
    expect(composerNote({ continuesSession: false, agentToInstall: "Qwen Code" })).toBe("Install Qwen Code to start a session.");
    expect(composerNote({ continuesSession: true, agentToInstall: "Qwen Code" })).toBe("Install Qwen Code to continue this session.");
    expect(composerNote({ continuesSession: false, agentToSignIn: "Qwen Code" })).toBe("Sign in to Qwen Code to send a message.");
    expect(composerNote({ continuesSession: true, agentToSignIn: "Qwen Code" })).toBe("Sign in to Qwen Code to continue this session.");
  });

  it("puts the install or sign-in reason before the loading line, and the loading line before nothing", () => {
    expect(composerNote({ continuesSession: false, agentToSignIn: "Qwen Code", agentLoading: "Qwen Code" })).toBe(
      "Sign in to Qwen Code to send a message.",
    );
    expect(composerNote({ continuesSession: false, agentToInstall: "Gemini CLI", agentToSignIn: "Qwen Code", agentLoading: "Qwen Code" })).toBe(
      "Install Gemini CLI to start a session.",
    );
    expect(composerNote({ continuesSession: false, agentLoading: "Qwen Code" })).toBe("Loading Qwen Code's models and commands…");
    expect(composerNote({ continuesSession: false })).toBeUndefined();
  });
});
