import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnreadMarks } from "../hooks/useUnreadMarks";
import type { Session } from "../types";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: "Fix the login",
    profileId: "claude-acp",
    cwd: "/w",
    status: "running",
    createdAt: 1,
    transport: "acp",
    ...overrides,
  };
}

interface Props {
  sessions: Session[];
  activeSessionId: string;
  busy: string[];
  openRunMemberIds?: string[];
}

function setup(initial: Props) {
  const patchSession = vi.fn();
  const hook = renderHook(
    (props: Props) =>
      useUnreadMarks(props.sessions, props.activeSessionId, (id) => props.busy.includes(id), patchSession, props.openRunMemberIds),
    { initialProps: initial },
  );
  return { patchSession, ...hook };
}

describe("useUnreadMarks", () => {
  it("marks a session unread when its turn ends while another session is open", () => {
    const sessions = [session("a"), session("b")];
    const { patchSession, rerender } = setup({ sessions, activeSessionId: "a", busy: ["b"] });

    rerender({ sessions, activeSessionId: "a", busy: [] });

    expect(patchSession).toHaveBeenCalledWith("b", { hasUnread: true });
  });

  it("sets no mark when a member finishes while its run's panel is open", () => {
    const sessions = [session("a", { compareRunId: "run-1" }), session("b", { compareRunId: "run-1" })];
    const open = ["a", "b"];
    const { patchSession, rerender } = setup({ sessions, activeSessionId: "", busy: ["a", "b"], openRunMemberIds: open });

    rerender({ sessions, activeSessionId: "", busy: [], openRunMemberIds: open });

    expect(patchSession).not.toHaveBeenCalled();
  });

  it("clears its members' marks when a run's panel is open", () => {
    const sessions = [
      session("a", { compareRunId: "run-1", hasUnread: true }),
      session("b", { compareRunId: "run-1", hasUnread: true }),
      session("other", { hasUnread: true }),
    ];
    const { patchSession, rerender } = setup({ sessions, activeSessionId: "", busy: [] });
    expect(patchSession).not.toHaveBeenCalled();

    rerender({ sessions, activeSessionId: "", busy: [], openRunMemberIds: ["a", "b"] });

    expect(patchSession).toHaveBeenCalledWith("a", { hasUnread: false });
    expect(patchSession).toHaveBeenCalledWith("b", { hasUnread: false });
    expect(patchSession).not.toHaveBeenCalledWith("other", expect.anything());
  });

  it("still marks a run's member when the run's panel is not open", () => {
    const sessions = [session("a", { compareRunId: "run-1" }), session("b", { compareRunId: "run-1" })];
    const { patchSession, rerender } = setup({ sessions, activeSessionId: "other", busy: ["a"] });

    rerender({ sessions, activeSessionId: "other", busy: [] });

    expect(patchSession).toHaveBeenCalledWith("a", { hasUnread: true });
  });
});
