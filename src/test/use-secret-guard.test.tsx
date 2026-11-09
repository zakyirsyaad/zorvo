import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSecretGuard } from "../hooks/useSecretGuard";

const AWS = ["AKIA", "IOSFODNN7EXAMPL", "E"].join("");

describe("useSecretGuard", () => {
  it("queues a second message while the first scan is pending", async () => {
    const onEdit = vi.fn();
    const { result } = renderHook(() =>
      useSecretGuard({ isEnabled: true, root: "/w", agentName: "Qwen Code", onEdit }),
    );
    const first = vi.fn();
    const second = vi.fn();

    act(() => {
      result.current.check({ text: `first ${AWS}` }, first);
      result.current.check({ text: `second ${AWS}` }, second);
    });

    await waitFor(() => expect(result.current.review?.message.text).toBe(`first ${AWS}`));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    act(() => result.current.sendAnyway());

    await waitFor(() => expect(result.current.review?.message.text).toBe(`second ${AWS}`));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    act(() => result.current.sendAnyway());
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("gives the held message's session to Edit", async () => {
    const onEdit = vi.fn();
    const { result } = renderHook(() =>
      useSecretGuard({ isEnabled: true, root: "/w", agentName: "Qwen Code", onEdit }),
    );

    act(() => {
      result.current.check({ text: `key ${AWS}` }, vi.fn(), {
        isEnabled: true,
        root: "/w",
        agentName: "Qwen Code",
        sessionId: "s-1",
      });
    });
    await waitFor(() => expect(result.current.review).not.toBeNull());

    act(() => result.current.edit());

    expect(onEdit).toHaveBeenCalledWith("s-1", { text: `key ${AWS}` });
  });
});