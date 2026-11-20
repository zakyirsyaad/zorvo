import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, callback: Listener) => { listeners.set(name, callback); return Promise.resolve(() => listeners.delete(name)); } }));
import { useBrowserAgentTools } from "../hooks/useBrowserAgentTools";
import { fakeProfiles } from "./fixtures/agents";
import type { Session } from "../types";

const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
const session: Session = { id: "s1", name: "Browser work", profileId: fakeProfiles[0].id, cwd: "/workspace", status: "running", createdAt: 1, transport: "acp" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); listeners.clear(); });

function setup(handler: (command: string, args?: Record<string, unknown>) => Promise<unknown> = async () => ({ ok: true })) {
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(handler);
  const onError = vi.fn();
  const onAttention = vi.fn();
  const hook = renderHook(() => useBrowserAgentTools({ sessions: [session], agents: fakeProfiles, onAttention, onError }));
  const call = async (callId: string, tool = "browser", args: Record<string, unknown> = { operation: "tabs.list" }) => {
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(true));
    await act(async () => listeners.get("agent-tool-call")?.({ payload: { callId, sessionId: "s1", tool, args } }));
  };
  return { ...hook, invoke, call, onError, onAttention };
}

describe("browser agent permission", () => {
  it("grants before allocating a browser and reuses only that session grant", async () => {
    const env = setup();
    await env.call("first");
    expect(env.result.current.request?.kind).toBe("browser");
    expect(env.invoke).not.toHaveBeenCalled();
    await act(async () => { await env.result.current.answer(env.result.current.request!, true); });
    expect(env.invoke.mock.calls.map(([command]) => command)).toEqual(["browser_permission", "browser_agent_execute", "agent_tool_respond"]);
    expect(env.invoke.mock.calls[1][1]).toEqual({ callId: "first" });
    await env.call("second");
    expect(env.result.current.request).toBeNull();
    expect(env.invoke.mock.calls.filter(([command]) => command === "browser_permission")).toHaveLength(1);
    expect(env.invoke.mock.calls.filter(([command]) => command === "browser_agent_execute")).toHaveLength(2);
  });

  it("denial creates no browser and cancellation removes the unanswered request", async () => {
    const env = setup();
    await env.call("deny");
    await act(async () => { await env.result.current.answer(env.result.current.request!, false); });
    expect(env.invoke.mock.calls.some(([command]) => command === "browser_agent_execute")).toBe(false);
    expect(env.invoke).toHaveBeenCalledWith("agent_tool_respond", { callId: "deny", ok: false, text: "The user declined." }, undefined);
    await env.call("cancel");
    await act(async () => listeners.get("agent-tool-call-ended")?.({ payload: { callId: "cancel" } }));
    expect(env.result.current.request).toBeNull();
    expect(env.invoke.mock.calls.filter(([command]) => command === "agent_tool_respond")).toHaveLength(1);
  });

  it("requires a separate one-time approval for the exact upload destination and paths", async () => {
    let approved = false;
    const env = setup(async command => {
      if (command === "browser_file_permission") { approved = true; return null; }
      if (command === "browser_agent_execute") return approved ? { uploaded: true } : { requiresFileApproval: { url: "https://example.com/upload", paths: ["/workspace/report.txt"] } };
      return null;
    });
    await env.call("upload", "browser", { operation: "files.upload", paths: ["/workspace/report.txt"] });
    await act(async () => { await env.result.current.answer(env.result.current.request!, true); });
    expect(env.result.current.request).toMatchObject({ kind: "files", destination: "https://example.com/upload", paths: ["/workspace/report.txt"] });
    expect(env.invoke.mock.calls.some(([command]) => command === "agent_tool_respond")).toBe(false);
    await act(async () => { await env.result.current.answer(env.result.current.request!, true); });
    expect(env.invoke).toHaveBeenCalledWith("browser_file_permission", { callId: "upload", allow: true }, undefined);
    expect(env.invoke).toHaveBeenCalledWith("agent_tool_respond", { callId: "upload", ok: true, text: '{"uploaded":true}' }, undefined);
  });

  it("does not execute a cancelled request after the grant arrives late", async () => {
    let release: (() => void) | undefined;
    const env = setup(async command => {
      if (command === "browser_permission") await new Promise<void>(resolve => { release = resolve; });
      return null;
    });
    await env.call("slow");
    let answered: Promise<void>;
    act(() => { answered = env.result.current.answer(env.result.current.request!, true); });
    await act(async () => listeners.get("agent-tool-call-ended")?.({ payload: { callId: "slow" } }));
    await act(async () => { release?.(); await answered!; });
    expect(env.invoke.mock.calls.some(([command]) => command === "browser_agent_execute")).toBe(false);
  });

  it("answers the guide without granting access and asks again after revocation", async () => {
    const env = setup();
    await env.call("guide", "browser_guide", {});
    expect(env.invoke).toHaveBeenCalledWith("browser_catalog", {}, undefined);
    expect(env.result.current.request).toBeNull();
    await env.call("grant");
    await act(async () => { await env.result.current.answer(env.result.current.request!, true); });
    await act(async () => window.dispatchEvent(new CustomEvent("zorvo:browser-revoked", { detail: { sessionId: "s1" } })));
    await env.call("again");
    expect(env.result.current.request?.callId).toBe("again");
  });
});
