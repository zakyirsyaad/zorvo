import { useRef, useState } from 'react';
import { failureReportOf, isNewsUpdate, nextFailures, STALL_MIN_FAILURES, type AgentFailures } from '../lib/agent-stall';

function sameFailures(a: AgentFailures | undefined, b: AgentFailures | undefined): boolean {
  return a === b || (!!a && !!b && a.count === b.count && a.source === b.source && a.model === b.model && a.detail === b.detail);
}

/**
 * Each session's failed requests in a row, as its agent reported them. State
 * changes only when the value does, so a stream of updates does not re-render.
 */
export function useAgentFailures() {
  const [failures, setFailures] = useState<Readonly<Record<string, AgentFailures>>>({});
  const current = useRef(failures);

  const set = (sessionId: string, next: AgentFailures | undefined) => {
    if (sameFailures(current.current[sessionId], next)) return;
    const { [sessionId]: _dropped, ...rest } = current.current;
    current.current = next ? { ...rest, [sessionId]: next } : rest;
    setFailures(current.current);
  };

  /**
   * Folds a live (not replayed) update in; true when it reports a failed Qwen
   * Code request the notice shows, so its error is worth reading from Qwen's log.
   */
  const observe = (sessionId: string, update: unknown): boolean => {
    const report = failureReportOf(update);
    if (report) {
      const next = nextFailures(current.current[sessionId], report);
      set(sessionId, next);
      return report.kind === 'failed' && report.source === 'qwen-lifecycle' && (next?.count ?? 0) >= STALL_MIN_FAILURES;
    }
    if (isNewsUpdate(update)) set(sessionId, undefined);
    return false;
  };

  /** Adds the error text read afterwards, if the failures are still going on. */
  const addDetail = (sessionId: string, detail: string) => {
    const prev = current.current[sessionId];
    if (prev && prev.count > 0) set(sessionId, { ...prev, detail });
  };

  const clear = (sessionId: string) => set(sessionId, undefined);

  return { failures, observe, addDetail, clear };
}
