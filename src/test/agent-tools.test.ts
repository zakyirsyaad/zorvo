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
import { sessionGetsAgentTools } from "../lib/agent-tools";
import { COMMAND_PATH_CONTEXT } from "../lib/agent-tools-context";
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
    .map(([cmd, args]) => [cmd, (args as { agentTools?: unknown }).agentTools]);
}

describe("sessionGetsAgentTools", () => {
  it("gives tools to a plain session and to a fork", () => {
    expect(sessionGetsAgentTools({})).toBe(true);
    expect(sessionGetsAgentTools({ compareRunId: null, delegatedFrom: null })).toBe(true);
  });

  it("gives none to a compare run session", () => {
    expect(sessionGetsAgentTools({ compareRunId: "run-1" })).toBe(false);
  });

  it("gives none to a session an agent opened", () => {
    expect(sessionGetsAgentTools({ openedBy: { sessionId: "s-a", at: 1 } })).toBe(false);
    expect(sessionGetsAgentTools({ openedBy: null })).toBe(true);
  });

  it("gives none to a fork of a session that has none, however long the chain", () => {
    const opened = { id: "s-o", openedBy: { sessionId: "s-a", at: 1 } };
    const delegated = { id: "s-d", delegatedFrom: LINK };
    const fork = { id: "s-f", forkedFrom: "s-o" };
    const forkOfFork = { id: "s-g", forkedFrom: "s-f" };
    const all = [opened, delegated, fork, forkOfFork];

    expect(sessionGetsAgentTools(fork, all)).toBe(false);
    expect(sessionGetsAgentTools(forkOfFork, all)).toBe(false);
    expect(sessionGetsAgentTools({ id: "s-h", forkedFrom: "s-d" }, all)).toBe(false);
    // A fork of a plain session keeps the tools, and so does one whose source is gone.
    expect(sessionGetsAgentTools({ id: "s-i", forkedFrom: "s-plain" }, [...all, { id: "s-plain" }])).toBe(true);
    expect(sessionGetsAgentTools({ id: "s-j", forkedFrom: "s-deleted" }, all)).toBe(true);
    // A hand-edited loop ends.
    const a = { id: "s-x", forkedFrom: "s-y" };
    const b = { id: "s-y", forkedFrom: "s-x" };
    expect(sessionGetsAgentTools(a, [a, b])).toBe(true);
  });

  it("gives none to a delegated session, open or ended", () => {
    expect(sessionGetsAgentTools({ delegatedFrom: LINK })).toBe(false);
    expect(sessionGetsAgentTools({ delegatedFrom: { ...LINK, endedAt: 2 } })).toBe(false);
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
      ["acp_start_session", true],
      ["acp_reopen_session", true],
      ["acp_import_session", true],
      ["acp_fork_session", true],
    ]);
  });

  it("passes false for a compare run session and a delegated one", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const compared: Session = { ...SESSION, id: "s-2", compareRunId: "run-1" };
    const delegated: Session = { ...SESSION, id: "s-3", delegatedFrom: LINK };
    const { result } = renderHook(() =>
      useAcpEngine({
        sessions: [compared, delegated],
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

    await act(async () => {
      await result.current.start(compared);
      await result.current.start(delegated);
    });

    expect(openCalls(spy)).toEqual([
      ["acp_start_session", false],
      ["acp_start_session", false],
    ]);
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

  it("sends nothing extra for an mcp session or a session without tools", async () => {
    for (const path of ["mcp", undefined, "something-else"]) {
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
