import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVisualSweep } from "../hooks/useVisualSweep";
import { fakeTauriInvoke } from "./setup";
import type { ChatMessage } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const A = "v-000000000000000a";
const B = "v-000000000000000b";
const reply = (id: string, visuals: string[]): ChatMessage => ({
  id,
  role: "agent",
  content: "",
  timestamp: 1,
  parts: visuals.map((visual) => ({ kind: "visual", id: visual, title: "T", visualKind: "svg" })),
});

function setup(sweep: () => unknown | Promise<unknown> = () => 1) {
  const spy = vi.spyOn(internals(), "invoke");
  spy.mockClear();
  spy.mockImplementation((cmd, args) => (cmd === "visual_sweep" ? Promise.resolve().then(sweep) : fakeTauriInvoke(cmd, args)));
  const sweeps = () => spy.mock.calls.filter(([cmd]) => cmd === "visual_sweep").map(([, args]) => args);
  const hook = renderHook(({ sessionId, messages }: { sessionId: string | null; messages: readonly ChatMessage[] | null }) => useVisualSweep(sessionId, messages), {
    initialProps: { sessionId: "s-1" as string | null, messages: [reply("m-1", [A]), reply("m-2", [B])] as readonly ChatMessage[] | null },
  });
  return { sweeps, rerender: hook.rerender };
}

describe("useVisualSweep", () => {
  it("does nothing when a transcript first loads", () => {
    expect(setup().sweeps()).toEqual([]);
  });

  it("sweeps with what is left when a message with a visual goes", async () => {
    const env = setup();
    env.rerender({ sessionId: "s-1", messages: [reply("m-1", [A])] });
    await waitFor(() => expect(env.sweeps()).toEqual([{ sessionId: "s-1", keep: [A] }]));
  });

  it("does nothing when visuals are added", () => {
    const env = setup();
    env.rerender({ sessionId: "s-1", messages: [reply("m-1", [A]), reply("m-2", [B]), reply("m-3", ["v-000000000000000c"])] });
    expect(env.sweeps()).toEqual([]);
  });

  it("does nothing on a switch to another session, whatever it holds", () => {
    const env = setup();
    env.rerender({ sessionId: "s-2", messages: [] });
    env.rerender({ sessionId: "s-1", messages: [reply("m-1", [A]), reply("m-2", [B])] });
    expect(env.sweeps()).toEqual([]);
  });

  it("never sweeps a transcript that is not loaded", () => {
    const env = setup();
    env.rerender({ sessionId: "s-1", messages: null });
    env.rerender({ sessionId: null, messages: null });
    expect(env.sweeps()).toEqual([]);
  });

  it("stays quiet when the sweep fails", async () => {
    const env = setup(() => Promise.reject("EIO"));
    env.rerender({ sessionId: "s-1", messages: [] });
    await waitFor(() => expect(env.sweeps()).toHaveLength(1));
  });
});
