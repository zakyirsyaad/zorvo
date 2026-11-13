import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { NOT_READY, type AgentToolCall } from '../lib/agent-tools';

/**
 * Answers the tool calls agents make to Zorvo's tool server. Until the tools
 * are built every call is answered as not ready. Main window only: a popout
 * would answer the same call a second time.
 */
export function useAgentTools(): void {
  useEffect(() => {
    let isMounted = true;
    const unlistenCall = listen<AgentToolCall>('agent-tool-call', (event) => {
      if (!isMounted) return;
      // An agent whose answer never arrives gets the backend's own timeout.
      void invoke('agent_tool_respond', { callId: event.payload.callId, ok: false, text: NOT_READY }).catch(() => undefined);
    }).catch(() => null);
    // A call that ended without our answer (timeout, cancel, session stop): nothing is waiting on a reply.
    const unlistenEnded = listen<{ callId: string }>('agent-tool-call-ended', () => undefined).catch(() => null);
    return () => {
      isMounted = false;
      void unlistenCall.then((stop) => stop?.());
      void unlistenEnded.then((stop) => stop?.());
    };
  }, []);
}
