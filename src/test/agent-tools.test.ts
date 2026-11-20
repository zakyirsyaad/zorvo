import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAcpEngine } from "../hooks/session-engine/useAcpEngine";
import { toolsRoleOf } from "../lib/workers";
import { COMMAND_PATH_CONTEXT, MCP_PATH_CONTEXT, workerContext } from "../lib/agent-tools-context";
import { NO_CHOICES } from "../lib/acp-draft";
import { fakeProfiles } from "./fixtures/agents";
import type { Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const SESSION: Session = {
  id: "s-1",
  name: "Plain",
  profileId: "qwen",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
  acpSessionId: "acp-s-1",
};

const LINK = { sessionId: "a", task: "t", startedAt: 1 };

const OPENING = ["acp_start_session", "acp_reopen_session", "acp_import_session", "acp_fork_session"];

function openCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .filter(([cmd]) => OPENING.includes(cmd as string))
    .map(([cmd, args]) => [cmd, (args as { agentTools?: unknown }).agentTools, (args as { workerTools?: unknown }).workerTools]);
}

describe("toolsRoleOf, the null fields of a stored session", () => {
  it("reads null links and run ids as absent", () => {
    expect(toolsRoleOf({})).toBe("coordinator");
    expect(toolsRoleOf({ compareRunId: null, delegatedFrom: null, openedBy: null })).toBe("coordinator");
  });
});

describe("useAcpEngine and agentTools", () => {
  afterEach(() => vi.restoreAllMocks());

  const engine = (session: Session) =>
    renderHook(() =>
      useAcpEngine({
        sessions: [session],
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

  it("passes agentTools when a session starts, reopens, imports and forks", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);

    await act(async () => {
      await result.current.start(SESSION);
      await result.current.resume(SESSION, "acp-s-1");
      await result.current.importSession(SESSION, NO_CHOICES, () => {});
      await result.current.fork("s-0", SESSION);
    });

    expect(openCalls(spy)).toEqual([
      ["acp_start_session", true, false],
      ["acp_reopen_session", true, false],
      ["acp_import_session", true, undefined],
      ["acp_fork_session", true, undefined],
    ]);
  });

  it("passes the role: a worker gets the worker tools, a coordinator the coordinator's", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const worker: Session = { ...SESSION, id: "s-3", delegatedFrom: LINK };
    const coordinator: Session = { ...SESSION, id: "a" };
    const { result } = renderHook(() =>
      useAcpEngine({
        sessions: [coordinator, worker],
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

    await act(async () => {
      await result.current.start(worker);
      await result.current.resume(worker, "acp-s-3");
      await result.current.start(coordinator);
    });

    expect(openCalls(spy)).toEqual([
      ["acp_start_session", true, true],
      ["acp_reopen_session", true, true],
      ["acp_start_session", true, false],
    ]);
  });

  it("passes no tools for a compare run session, a handoff session, an ended worker and a private one", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const compared: Session = { ...SESSION, id: "s-2", compareRunId: "run-1" };
    const opened: Session = { ...SESSION, id: "s-4", openedBy: { sessionId: "a", at: 1 } };
    const ended: Session = { ...SESSION, id: "s-5", delegatedFrom: { ...LINK, endedAt: 2 } };
    const priv: Session = { ...SESSION, id: "s-6", privateMode: { modelId: "m" } };
    const { result } = renderHook(() =>
      useAcpEngine({
        sessions: [compared, opened, ended, priv],
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

    await act(async () => {
      for (const session of [compared, opened, ended, priv]) await result.current.start(session);
    });

    expect(openCalls(spy)).toEqual([
      ["acp_start_session", false, false],
      ["acp_start_session", false, false],
      ["acp_start_session", false, false],
      ["acp_start_session", false, false],
    ]);
  });

  it("starts a fork of a worker with no tools", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const worker: Session = { ...SESSION, id: "w", delegatedFrom: LINK };
    const fork: Session = { ...SESSION, id: "f", forkedFrom: "w" };
    const { result } = renderHook(() =>
      useAcpEngine({
        sessions: [worker, fork],
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

    await act(async () => {
      await result.current.fork("w", fork);
    });

    expect(openCalls(spy)).toEqual([["acp_fork_session", false, undefined]]);
  });
});

describe("useAcpEngine and the command path context", () => {
  type FakeWindow = { __FAKE_TOOLS_PATH__?: string };
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as FakeWindow).__FAKE_TOOLS_PATH__;
  });

  const withPath = (path: string | undefined) => {
    (window as unknown as FakeWindow).__FAKE_TOOLS_PATH__ = path;
  };

  const engine = (session: Session, messages: { current: unknown[] } = { current: [] }) =>
    renderHook(() =>
      useAcpEngine({
        sessions: [session],
        agents: fakeProfiles,
        updateMessages: (_id, update) => {
          messages.current = (update as (prev: unknown[]) => unknown[])(messages.current);
        },
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

  const promptTexts = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([cmd]) => cmd === "acp_prompt").map(([, args]) => (args as { text: string }).text);

  it("sends the context with the first message of a command-path session", async () => {
    withPath("command");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);
    await act(async () => {
      await result.current.start(SESSION, { text: "ask Qwen to review it" });
    });
    expect(promptTexts(spy)).toEqual([`${COMMAND_PATH_CONTEXT}\n\nask Qwen to review it`]);
  });

  it("sends it once: the second message goes out bare", async () => {
    withPath("command");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);
    await act(async () => {
      await result.current.start(SESSION, { text: "first" });
      await result.current.send(SESSION.id, "second");
    });
    expect(promptTexts(spy)).toEqual([`${COMMAND_PATH_CONTEXT}\n\nfirst`, "second"]);
  });

  it("sends it with the first message typed after a start that had none", async () => {
    withPath("command");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);
    await act(async () => {
      await result.current.start(SESSION);
      await result.current.send(SESSION.id, "hello");
    });
    expect(promptTexts(spy)).toEqual([`${COMMAND_PATH_CONTEXT}\n\nhello`]);
  });

  it("sends it again after a reopen", async () => {
    withPath("command");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);
    await act(async () => {
      await result.current.start(SESSION, { text: "first" });
      await result.current.resume(SESSION, "acp-s-1", { text: "back again" });
    });
    expect(promptTexts(spy)[1]).toBe(`${COMMAND_PATH_CONTEXT}\n\nback again`);
  });

  it("keeps both contexts when the first message carries its own", async () => {
    withPath("command");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);
    await act(async () => {
      await result.current.start(SESSION, { text: "do the task", context: "Read the handoff." });
    });
    expect(promptTexts(spy)).toEqual([`${COMMAND_PATH_CONTEXT}\n\nRead the handoff.\n\ndo the task`]);
  });

  it("sends it with the next message when the first prompt was refused", async () => {
    withPath("command");
    const real = tauriInternals().invoke.bind(tauriInternals());
    let refuse = true;
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "acp_prompt" && refuse) {
        refuse = false;
        return Promise.reject(new Error("busy"));
      }
      return real(cmd, args);
    });
    const { result } = engine(SESSION);
    await act(async () => {
      await result.current.start(SESSION, { text: "first" });
      await result.current.send(SESSION.id, "again");
    });
    expect(promptTexts(spy)).toEqual([
      `${COMMAND_PATH_CONTEXT}\n\nfirst`,
      `${COMMAND_PATH_CONTEXT}\n\nagain`,
    ]);
  });

  it("tells an mcp session with the agent tools when to show a page, with its first message", async () => {
    withPath("mcp");
    (window as unknown as { __FAKE_AGENT_TOOLS__?: boolean }).__FAKE_AGENT_TOOLS__ = true;
    try {
      const spy = vi.spyOn(tauriInternals(), "invoke");
      const { result } = engine(SESSION);
      await act(async () => {
        await result.current.start(SESSION, { text: "plain" });
      });
      expect(promptTexts(spy)).toEqual([`${MCP_PATH_CONTEXT}\n\nplain`]);
    } finally {
      delete (window as unknown as { __FAKE_AGENT_TOOLS__?: boolean }).__FAKE_AGENT_TOOLS__;
    }
  });

  it("tells an mcp session with computer use alone nothing about pages, which it cannot show", async () => {
    withPath("mcp");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);
    await act(async () => {
      await result.current.start(SESSION, { text: "plain" });
    });
    expect(promptTexts(spy)).toEqual(["plain"]);
  });

  it("sends nothing extra for a session without tools", async () => {
    for (const path of [undefined, "something-else"]) {
      withPath(path);
      const spy = vi.spyOn(tauriInternals(), "invoke");
      const { result, unmount } = engine(SESSION);
      await act(async () => {
        await result.current.start(SESSION, { text: "plain" });
      });
      expect(promptTexts(spy)).toEqual(["plain"]);
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("does not show the context in the chat", async () => {
    withPath("command");
    const messages = { current: [] as unknown[] };
    const { result } = engine(SESSION, messages);
    await act(async () => {
      await result.current.start(SESSION, { text: "ask Qwen to review it" });
    });
    const shown = messages.current as { role: string; content: string }[];
    expect(shown.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["ask Qwen to review it"]);
  });
});

describe("useAcpEngine and a worker's note", () => {
  type FakeWindow = { __FAKE_TOOLS_PATH__?: string; __FAKE_AGENT_TOOLS__?: boolean };
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as FakeWindow).__FAKE_TOOLS_PATH__;
    delete (window as unknown as FakeWindow).__FAKE_AGENT_TOOLS__;
  });

  const coordinator: Session = { ...SESSION, id: "a", profileId: "claude-acp" };
  const worker: Session = { ...SESSION, id: "w", delegatedFrom: { ...LINK, sessionId: "a" } };
  const coordinatorName = "Claude Code";

  const engine = (sessions: Session[]) =>
    renderHook(() =>
      useAcpEngine({
        sessions,
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

  const promptTexts = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([cmd]) => cmd === "acp_prompt").map(([, args]) => (args as { text: string }).text);

  const open = (path: string | undefined) => {
    (window as unknown as FakeWindow).__FAKE_TOOLS_PATH__ = path;
    // The backend says true for a worker too: the note must follow the role, not this flag.
    (window as unknown as FakeWindow).__FAKE_AGENT_TOOLS__ = true;
  };

  it("gives a worker its own note and never the coordinator's", async () => {
    open("mcp");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine([coordinator, worker]);
    await act(async () => {
      await result.current.start(worker, { text: "do the task" });
    });
    expect(promptTexts(spy)).toEqual([`${workerContext("mcp", coordinatorName)}\n\ndo the task`]);
    expect(promptTexts(spy)[0]).not.toContain(MCP_PATH_CONTEXT);
    expect(promptTexts(spy)[0]).not.toContain(COMMAND_PATH_CONTEXT);
  });

  it("gives a command-path worker the command form", async () => {
    open("command");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine([coordinator, worker]);
    await act(async () => {
      await result.current.start(worker, { text: "do the task" });
    });
    expect(promptTexts(spy)).toEqual([`${workerContext("command", coordinatorName)}\n\ndo the task`]);
  });

  it("names a coordinator that is gone as Another agent", async () => {
    open("mcp");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine([worker]);
    await act(async () => {
      await result.current.start(worker, { text: "do the task" });
    });
    expect(promptTexts(spy)[0]).toContain("Another agent, in another Zorvo session");
  });

  it("gives a reopened worker the note again", async () => {
    open("mcp");
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine([coordinator, worker]);
    await act(async () => {
      await result.current.resume(worker, "acp-w", { text: "carry on" });
    });
    expect(promptTexts(spy)).toEqual([`${workerContext("mcp", coordinatorName)}\n\ncarry on`]);
  });

  it("gives a worker with no tools path no note", async () => {
    open(undefined);
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine([coordinator, worker]);
    await act(async () => {
      await result.current.start(worker, { text: "do the task" });
    });
    expect(promptTexts(spy)).toEqual(["do the task"]);
  });
});
