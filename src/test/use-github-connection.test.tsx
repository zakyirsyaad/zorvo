import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
}));

import { useGithubConnection } from "../hooks/useGithubConnection";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined];

function internals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function callsTo(spy: { mock: { calls: unknown[][] } }, cmd: string) {
  return (spy.mock.calls as unknown as InvokeCall[]).filter(([name]) => name === cmd);
}

/** Answers `github_status` from `answers` in turn (the last one repeats), and the other commands as the fake backend does. */
function mockGithub(answers: unknown[], start: () => Promise<unknown> = () => Promise.resolve()) {
  const real = internals().invoke;
  let read = 0;
  return vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "github_status") return Promise.resolve(answers[Math.min(read++, answers.length - 1)]);
    if (cmd === "github_start_sign_in") return start();
    return real(cmd, args);
  });
}

async function githubEvent(payload: Record<string, unknown>) {
  await act(async () => {
    listeners.get("github-sign-in-terminal")?.({ payload });
  });
}

const SIGNED_OUT = { state: "signed-out", login: null, name: null, message: null };
const SIGNED_IN = { state: "signed-in", login: "octocat", name: "The Octocat", message: null };
const NOT_INSTALLED = { state: "not-installed", login: null, name: null, message: null };

afterEach(() => {
  listeners.clear();
  vi.restoreAllMocks();
});

describe("useGithubConnection", () => {
  it("reads the connection at start", async () => {
    const spy = mockGithub([SIGNED_IN]);

    const { result } = renderHook(() => useGithubConnection());
    expect(result.current.status).toBeNull();

    await waitFor(() => expect(result.current.status).toMatchObject({ state: "signed-in", login: "octocat" }));
    expect(result.current.isChecking).toBe(false);
    expect(callsTo(spy, "github_status").length).toBeGreaterThan(0);
  });

  it("reads an answer it cannot understand as unknown, never as signed in", async () => {
    mockGithub([undefined]);

    const { result } = renderHook(() => useGithubConnection());

    await waitFor(() => expect(result.current.status?.state).toBe("unknown"));
  });

  it("reads a failed command as unknown", async () => {
    const real = internals().invoke;
    vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "github_status" ? Promise.reject("boom") : real(cmd, args),
    );

    const { result } = renderHook(() => useGithubConnection());

    await waitFor(() =>
      expect(result.current.status).toMatchObject({ state: "unknown", message: "Could not check GitHub." }),
    );
  });

  it("checks again on request", async () => {
    mockGithub([SIGNED_OUT, SIGNED_IN]);
    const { result } = renderHook(() => useGithubConnection());
    await waitFor(() => expect(result.current.status?.state).toBe("signed-out"));

    await act(async () => {
      await result.current.check();
    });

    expect(result.current.status).toMatchObject({ state: "signed-in", login: "octocat" });
  });

  describe("when the window regains focus", () => {
    it("checks again while not connected, so gh installed or signed in elsewhere is noticed", async () => {
      const spy = mockGithub([NOT_INSTALLED, SIGNED_IN]);
      const { result } = renderHook(() => useGithubConnection());
      await waitFor(() => expect(result.current.status?.state).toBe("not-installed"));
      const readsBefore = callsTo(spy, "github_status").length;

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => expect(result.current.status).toMatchObject({ state: "signed-in", login: "octocat" }));
      expect(callsTo(spy, "github_status").length).toBe(readsBefore + 1);
    });

    it("does not ask GitHub again while connected", async () => {
      const spy = mockGithub([SIGNED_IN]);
      const { result } = renderHook(() => useGithubConnection());
      await waitFor(() => expect(result.current.status?.state).toBe("signed-in"));
      const readsBefore = callsTo(spy, "github_status").length;

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(callsTo(spy, "github_status").length).toBe(readsBefore);
    });

    it("does not start a check while one is still running, however often the window is focused", async () => {
      // The second check never answers, as on a stalled network.
      const real = internals().invoke;
      let release!: (answer: unknown) => void;
      let reads = 0;
      vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
        if (cmd !== "github_status") return real(cmd, args);
        reads += 1;
        // The start-up read answers not installed; the next one stalls until released.
        return reads === 1
          ? Promise.resolve(NOT_INSTALLED)
          : new Promise((resolve) => {
              release = resolve;
            });
      });
      const { result } = renderHook(() => useGithubConnection());
      await waitFor(() => expect(result.current.status?.state).toBe("not-installed"));

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("focus"));
      });

      expect(reads).toBe(2);
      await act(async () => release(SIGNED_IN));
      await waitFor(() => expect(result.current.status?.state).toBe("signed-in"));
    });

    it("shows no progress for a check nobody asked for, so buttons do not flicker and nothing is announced", async () => {
      const real = internals().invoke;
      let release!: (answer: unknown) => void;
      let reads = 0;
      vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
        if (cmd !== "github_status") return real(cmd, args);
        reads += 1;
        return reads === 1
          ? Promise.resolve(NOT_INSTALLED)
          : new Promise((resolve) => {
              release = resolve;
            });
      });
      const { result } = renderHook(() => useGithubConnection());
      await waitFor(() => expect(result.current.status?.state).toBe("not-installed"));

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(reads).toBe(2);
      expect(result.current.isChecking).toBe(false);
      await act(async () => release(SIGNED_IN));
      await waitFor(() => expect(result.current.status?.state).toBe("signed-in"));
    });

    it("shows progress for a check the user asked for", async () => {
      const real = internals().invoke;
      let release!: (answer: unknown) => void;
      let reads = 0;
      vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
        if (cmd !== "github_status") return real(cmd, args);
        reads += 1;
        return reads === 1
          ? Promise.resolve(NOT_INSTALLED)
          : new Promise((resolve) => {
              release = resolve;
            });
      });
      const { result } = renderHook(() => useGithubConnection());
      await waitFor(() => expect(result.current.status?.state).toBe("not-installed"));

      act(() => void result.current.check());

      expect(result.current.isChecking).toBe(true);
      await act(async () => release(SIGNED_IN));
      await waitFor(() => expect(result.current.isChecking).toBe(false));
    });

    it("checks again on focus once the earlier check has answered", async () => {
      const spy = mockGithub([NOT_INSTALLED, NOT_INSTALLED, SIGNED_IN]);
      const { result } = renderHook(() => useGithubConnection());
      await waitFor(() => expect(result.current.status?.state).toBe("not-installed"));

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(result.current.isChecking).toBe(false));
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => expect(result.current.status?.state).toBe("signed-in"));
      expect(callsTo(spy, "github_status").length).toBeGreaterThanOrEqual(3);
    });

    it("leaves a running sign-in to its own exit", async () => {
      const spy = mockGithub([SIGNED_OUT]);
      const { result } = renderHook(() => useGithubConnection());
      await waitFor(() => expect(result.current.status?.state).toBe("signed-out"));
      await act(async () => result.current.connect());
      const readsBefore = callsTo(spy, "github_status").length;

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(callsTo(spy, "github_status").length).toBe(readsBefore);
    });
  });

  describe("connect", () => {
    async function startSignIn(answers: unknown[], start?: () => Promise<unknown>) {
      const spy = mockGithub(answers, start);
      const view = renderHook(() => useGithubConnection());
      await waitFor(() => expect(view.result.current.status).not.toBeNull());
      await act(async () => view.result.current.connect());
      const [[, args]] = callsTo(spy, "github_start_sign_in");
      return { ...view, spy, terminalId: args?.terminalId as string };
    }

    it("starts the login in a terminal of its own, sending only its id", async () => {
      const { result, spy, terminalId } = await startSignIn([SIGNED_OUT]);

      expect(terminalId).toMatch(/^ghlogin-[a-z0-9-]+$/);
      expect(callsTo(spy, "github_start_sign_in")[0][1]).toEqual({ terminalId });
      expect(result.current.dialog).toMatchObject({
        terminalId,
        agentName: "GitHub",
        methodName: "GitHub CLI",
        phase: "running",
      });
    });

    it("checks the connection when the login exits, and closes the dialog once signed in", async () => {
      const { result, spy, terminalId } = await startSignIn([SIGNED_OUT, SIGNED_IN]);
      const readsBefore = callsTo(spy, "github_status").length;

      await githubEvent({ terminalId, kind: "exit", exitCode: 0 });

      await waitFor(() => expect(result.current.dialog).toBeNull());
      expect(callsTo(spy, "github_status").length).toBe(readsBefore + 1);
      expect(result.current.status).toMatchObject({ state: "signed-in", login: "octocat" });
    });

    it("keeps the dialog, failed, when GitHub still says signed out", async () => {
      const { result, terminalId } = await startSignIn([SIGNED_OUT, SIGNED_OUT]);

      await githubEvent({ terminalId, kind: "exit", exitCode: 0 });

      await waitFor(() => expect(result.current.dialog?.phase).toBe("failed"));
      expect(result.current.dialog?.error).toBe("GitHub still says you are signed out");
    });

    it("checks even when the login exits with an error, and shows the exit code when nothing took", async () => {
      const { result, spy, terminalId } = await startSignIn([SIGNED_OUT, SIGNED_OUT]);
      const readsBefore = callsTo(spy, "github_status").length;

      await githubEvent({ terminalId, kind: "exit", exitCode: 1 });

      await waitFor(() => expect(result.current.dialog?.phase).toBe("failed"));
      expect(result.current.dialog).toMatchObject({ error: "The sign-in ended with code 1" });
      expect(callsTo(spy, "github_status").length).toBe(readsBefore + 1);
    });

    it("says the login was stopped when it ended without an exit code", async () => {
      const { result, terminalId } = await startSignIn([SIGNED_OUT, SIGNED_OUT]);

      await githubEvent({ terminalId, kind: "exit", exitCode: null });

      await waitFor(() => expect(result.current.dialog?.phase).toBe("failed"));
      expect(result.current.dialog?.error).toBe("The sign-in was stopped");
    });

    it("closes the dialog when a login that exited with an error had stored its credentials", async () => {
      const { result, terminalId } = await startSignIn([SIGNED_OUT, SIGNED_IN]);

      await githubEvent({ terminalId, kind: "exit", exitCode: 1 });

      await waitFor(() => expect(result.current.dialog).toBeNull());
      expect(result.current.status).toMatchObject({ state: "signed-in", login: "octocat" });
    });

    it("tells the user what to expect in the terminal: gh asks a few questions", async () => {
      const { result } = await startSignIn([SIGNED_OUT]);

      expect(result.current.dialog?.note).toMatch(/gh asks a few questions/);
    });

    it("shows the start error as text", async () => {
      const { result } = await startSignIn([SIGNED_OUT], () => Promise.reject("The GitHub CLI (gh) is not installed"));

      expect(result.current.dialog).toMatchObject({
        phase: "failed",
        error: "The GitHub CLI (gh) is not installed",
      });
    });

    it("feeds its terminal's output to the store and ignores another terminal's", async () => {
      const { result, terminalId } = await startSignIn([SIGNED_OUT]);
      const seen: string[] = [];
      result.current.output.subscribe(terminalId, (data) => seen.push(data));

      await githubEvent({ terminalId, kind: "output", data: "! First copy your one-time code: ABCD-1234" });
      await githubEvent({ terminalId: "ghlogin-other", kind: "output", data: "not mine" });

      expect(seen.join("")).toContain("ABCD-1234");
      expect(seen.join("")).not.toContain("not mine");
    });

    it("cancelling a running login terminates it", async () => {
      const { result, spy, terminalId } = await startSignIn([SIGNED_OUT]);

      await act(async () => result.current.closeDialog());

      expect(callsTo(spy, "terminate_session")[0][1]).toEqual({ sessionId: terminalId });
      expect(result.current.dialog).toBeNull();
    });

    it("checks again when the dialog is closed, for someone who finished in the browser first", async () => {
      const { result, spy } = await startSignIn([SIGNED_OUT, SIGNED_IN]);
      const readsBefore = callsTo(spy, "github_status").length;

      await act(async () => result.current.closeDialog());

      await waitFor(() => expect(result.current.status).toMatchObject({ state: "signed-in", login: "octocat" }));
      expect(callsTo(spy, "github_status").length).toBe(readsBefore + 1);
    });

    it("ignores the exit of a login that was cancelled", async () => {
      const { result, spy, terminalId } = await startSignIn([SIGNED_OUT, SIGNED_IN]);
      await act(async () => result.current.closeDialog());
      await waitFor(() => expect(result.current.isChecking).toBe(false));
      const readsBefore = callsTo(spy, "github_status").length;

      await githubEvent({ terminalId, kind: "exit", exitCode: 0 });

      expect(callsTo(spy, "github_status").length).toBe(readsBefore);
      expect(result.current.dialog).toBeNull();
    });

    it("terminates a login that came up after it was cancelled", async () => {
      let finishStart!: () => void;
      const { result, spy } = await startSignIn(
        [SIGNED_OUT],
        () => new Promise<void>((resolve) => (finishStart = resolve)),
      );
      expect(result.current.dialog?.phase).toBe("starting");

      await act(async () => result.current.closeDialog());
      expect(callsTo(spy, "terminate_session")).toHaveLength(0);
      await act(async () => finishStart());

      expect(callsTo(spy, "terminate_session")).toHaveLength(1);
    });

    it("lets a second Connect replace a failed login", async () => {
      const { result, spy, terminalId } = await startSignIn([SIGNED_OUT]);
      await githubEvent({ terminalId, kind: "exit", exitCode: 1 });

      await act(async () => result.current.connect());

      const starts = callsTo(spy, "github_start_sign_in");
      expect(starts).toHaveLength(2);
      expect(starts[1][1]?.terminalId).not.toBe(terminalId);
      expect(result.current.dialog).toMatchObject({ phase: "running" });
    });
  });
});
