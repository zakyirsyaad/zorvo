import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ComposerHandle } from "../components/ComposerDock";
import { useUnsentMessages } from "../hooks/useUnsentMessages";

function fakeComposer() {
  const giveBack = vi.fn();
  return { restore: giveBack, handle: { giveBack } as unknown as ComposerHandle };
}

interface Props {
  activeSessionId: string;
  sessionIds: readonly string[];
  composer: ComposerHandle | null;
}

function setup(initial: Props) {
  return renderHook(
    (props: Props) =>
      useUnsentMessages({ composerRef: { current: props.composer }, activeSessionId: props.activeSessionId, sessionIds: props.sessionIds }),
    { initialProps: initial },
  );
}

describe("useUnsentMessages", () => {
  it("puts a message back at once when its session is on screen", () => {
    const { restore, handle } = fakeComposer();
    const { result } = setup({ activeSessionId: "a", sessionIds: ["a", "b"], composer: handle });

    act(() => result.current.giveBack("a", "hello", ["/f.ts"]));

    expect(restore).toHaveBeenCalledExactlyOnceWith("hello", ["/f.ts"]);
  });

  it("keeps a message for a session that is not on screen, and gives it back once that session is", () => {
    const { restore, handle } = fakeComposer();
    const { result, rerender } = setup({ activeSessionId: "b", sessionIds: ["a", "b"], composer: handle });

    act(() => result.current.giveBack("a", "hello"));
    expect(restore).not.toHaveBeenCalled();

    rerender({ activeSessionId: "a", sessionIds: ["a", "b"], composer: handle });
    expect(restore).toHaveBeenCalledExactlyOnceWith("hello", []);

    rerender({ activeSessionId: "b", sessionIds: ["a", "b"], composer: handle });
    rerender({ activeSessionId: "a", sessionIds: ["a", "b"], composer: handle });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("waits for a composer when its session is on screen without one", () => {
    const { restore, handle } = fakeComposer();
    const { result, rerender } = setup({ activeSessionId: "a", sessionIds: ["a"], composer: null });

    act(() => result.current.giveBack("a", "hello"));
    expect(restore).not.toHaveBeenCalled();

    rerender({ activeSessionId: "a", sessionIds: ["a"], composer: handle });
    expect(restore).toHaveBeenCalledExactlyOnceWith("hello", []);
  });

  it("gives several messages for one session back together, in the order they were written", () => {
    const { restore, handle } = fakeComposer();
    const { result, rerender } = setup({ activeSessionId: "b", sessionIds: ["a", "b"], composer: handle });

    act(() => {
      result.current.giveBack("a", "first", ["/x.ts", "/y.ts"]);
      result.current.giveBack("a", "second", ["/y.ts", "/z.ts"]);
    });
    rerender({ activeSessionId: "a", sessionIds: ["a", "b"], composer: handle });

    expect(restore).toHaveBeenCalledExactlyOnceWith("first\n\nsecond", ["/x.ts", "/y.ts", "/z.ts"]);
  });

  it("forgets the messages of a session that was deleted", () => {
    const { restore, handle } = fakeComposer();
    const { result, rerender } = setup({ activeSessionId: "b", sessionIds: ["a", "b"], composer: handle });
    act(() => result.current.giveBack("a", "hello"));

    rerender({ activeSessionId: "b", sessionIds: ["b"], composer: handle });
    rerender({ activeSessionId: "a", sessionIds: ["a", "b"], composer: handle });

    expect(restore).not.toHaveBeenCalled();
  });
});
