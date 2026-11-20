import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseToolCall, type AgentToolCall } from "../lib/agent-tools";
import { toolsRoleOf } from "../lib/workers";
import type { AgentProfile, Session } from "../types";
import { useLatest } from "./useLatest";

export interface BrowserPermissionRequest {
  callId: string;
  sessionId: string;
  agentName: string;
  sessionName: string;
  kind: "browser" | "files";
  destination?: string;
  paths?: string[];
}

export function useBrowserAgentTools(options: {
  sessions: readonly Session[];
  agents: readonly AgentProfile[];
  onAttention: (sessionId: string, reason: "needs-answer") => void;
  onError: (message: string) => void;
}) {
  const latest = useLatest(options);
  const calls = useRef(new Map<string, AgentToolCall>());
  const inFlight = useRef(new Set<string>());
  const awaitingFile = useRef(new Set<string>());
  const grants = useRef(new Set<string>());
  const [requests, setRequests] = useState<BrowserPermissionRequest[]>([]);
  const [answering, setAnswering] = useState(false);
  const mounted = useRef(true);
  const end = useCallback((callId: string) => {
    calls.current.delete(callId);
    awaitingFile.current.delete(callId);
    setRequests(previous => previous.filter(request => request.callId !== callId));
  }, []);
  const respond = useCallback(async (callId: string, ok: boolean, text: string) => {
    if (!calls.current.has(callId)) return;
    end(callId);
    await invoke("agent_tool_respond", { callId, ok, text });
  }, [end]);
  const ask = useCallback((call: AgentToolCall, kind: "browser" | "files", extra: { destination?: string; paths?: string[] } = {}) => {
    if (!calls.current.has(call.callId)) return;
    const session = latest.current.sessions.find(item => item.id === call.sessionId);
    if (!session) return;
    const request: BrowserPermissionRequest = {
      callId: call.callId, sessionId: session.id, kind,
      agentName: latest.current.agents.find(agent => agent.id === session.profileId)?.name ?? "The agent",
      sessionName: session.name, ...extra,
    };
    setRequests(previous => previous.some(item => item.callId === call.callId) ? previous : [...previous, request]);
    latest.current.onAttention(call.sessionId, "needs-answer");
  }, [latest]);
  const execute = useCallback(async (call: AgentToolCall) => {
    if (!calls.current.has(call.callId) || inFlight.current.has(call.callId)) return;
    inFlight.current.add(call.callId);
    try {
      const result = await invoke<unknown>("browser_agent_execute", { callId: call.callId });
      if (!calls.current.has(call.callId)) return;
      const approval = result && typeof result === "object" ? (result as { requiresFileApproval?: { url?: unknown; paths?: unknown } }).requiresFileApproval : undefined;
      if (approval && typeof approval.url === "string" && Array.isArray(approval.paths) && approval.paths.every(path => typeof path === "string")) {
        awaitingFile.current.add(call.callId);
        ask(call, "files", { destination: approval.url, paths: approval.paths as string[] });
        return;
      }
      await respond(call.callId, true, JSON.stringify(result));
    } catch (error) {
      try { await respond(call.callId, false, String(error)); }
      catch (reason) { latest.current.onError(String(reason)); }
    } finally {
      inFlight.current.delete(call.callId);
    }
  }, [ask, latest, respond]);

  useEffect(() => {
    mounted.current = true;
    const report = (error: unknown) => latest.current.onError(String(error));
    const stopCall = listen<unknown>("agent-tool-call", event => {
      const call = parseToolCall(event.payload);
      if (!mounted.current || !call || !["browser", "browser_guide"].includes(call.tool)) return;
      if (calls.current.has(call.callId)) return;
      calls.current.set(call.callId, call);
      const session = latest.current.sessions.find(item => item.id === call.sessionId);
      if (!session || session.status === "terminated" || toolsRoleOf(session, latest.current.sessions) !== "coordinator") {
        void respond(call.callId, false, "This session cannot use Zorvo's browser.").catch(error => latest.current.onError(String(error)));
      } else if (call.tool === "browser_guide") {
        void invoke("browser_catalog").then(result => respond(call.callId, true, JSON.stringify(result)))
          .catch(error => respond(call.callId, false, String(error))).catch(error => latest.current.onError(String(error)));
      } else if (grants.current.has(call.sessionId)) void execute(call);
      else ask(call, "browser");
    }).catch(error => { report(error); return () => {}; });
    const stopEnded = listen<{ callId: string }>("agent-tool-call-ended", event => { if (mounted.current) end(event.payload.callId); })
      .catch(error => { report(error); return () => {}; });
    const revoke = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId;
      if (typeof sessionId !== "string") return;
      grants.current.delete(sessionId);
      for (const call of calls.current.values()) {
        if (call.sessionId === sessionId && !inFlight.current.has(call.callId)) {
          void respond(call.callId, false, "Browser access was revoked.").catch(report);
        }
      }
    };
    window.addEventListener("zorvo:browser-revoked", revoke);
    return () => {
      mounted.current = false;
      window.removeEventListener("zorvo:browser-revoked", revoke);
      void stopCall.then(stop => stop()).catch(report);
      void stopEnded.then(stop => stop()).catch(report);
    };
  }, [ask, end, execute, latest, respond]);

  useEffect(() => {
    const live = new Set(options.sessions.filter(session => session.status !== "terminated").map(session => session.id));
    for (const sessionId of grants.current) if (!live.has(sessionId)) grants.current.delete(sessionId);
    for (const call of calls.current.values()) if (!live.has(call.sessionId)) end(call.callId);
  }, [options.sessions, end]);

  const answer = async (request: BrowserPermissionRequest, allow: boolean) => {
    if (answering || !calls.current.has(request.callId)) return;
    setAnswering(true);
    try {
      if (request.kind === "files") {
        await invoke("browser_file_permission", { callId: request.callId, allow });
        awaitingFile.current.delete(request.callId);
      } else {
        await invoke("browser_permission", { sessionId: request.sessionId, allow });
        if (allow && calls.current.has(request.callId)) grants.current.add(request.sessionId);
      }
      setRequests(previous => previous.filter(item => item.callId !== request.callId));
      if (!allow) await respond(request.callId, false, "The user declined.");
      else {
        // A first-session grant also unblocks calls already waiting for that same grant.
        const waiting = request.kind === "browser" ? [...calls.current.values()].filter(call => call.sessionId === request.sessionId && call.tool === "browser" && !awaitingFile.current.has(call.callId)) : [calls.current.get(request.callId)].filter((call): call is AgentToolCall => Boolean(call));
        if (request.kind === "browser") setRequests(previous => previous.filter(item => item.kind !== "browser" || item.sessionId !== request.sessionId));
        for (const call of waiting) { if (calls.current.has(call.callId)) await execute(call); }
      }
    } catch (error) { latest.current.onError(String(error)); }
    finally { if (mounted.current) setAnswering(false); }
  };
  return { request: requests[0] ?? null, answering, answer, isWaiting: (sessionId: string) => requests.some(request => request.sessionId === sessionId) };
}
