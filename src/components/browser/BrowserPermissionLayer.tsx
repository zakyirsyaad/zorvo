import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { BrowserPermissionRequest } from "../../hooks/useBrowserAgentTools";
import { Button } from "../ui/Button";

export function BrowserPermissionLayer({ request, busy, answer }: {
  request: BrowserPermissionRequest | null;
  busy: boolean;
  answer: (request: BrowserPermissionRequest, allow: boolean) => Promise<void>;
}) {
  if (!request) return null;
  return createPortal(<Permission key={`${request.callId}/${request.kind}`} request={request} busy={busy} answer={answer} />, document.body);
}

function Permission({ request, busy, answer }: { request: BrowserPermissionRequest; busy: boolean; answer: (request: BrowserPermissionRequest, allow: boolean) => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(ref);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div data-overlay="" className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-5">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} className="w-full max-w-lg space-y-3 rounded-xl border border-attention-border bg-attention-surface p-5 shadow-dialog focus-ring">
      <h2 id={titleId} className="text-heading font-semibold text-fg">{request.kind === "files" ? `${request.agentName} wants to send files` : `${request.agentName} wants to use the browser`}</h2>
      <p className="text-ui-sm text-fg-muted">{request.sessionName}</p>
      <p id={descriptionId} className="text-ui text-fg-secondary">{request.kind === "files" ? "Allow these files to be attached to this page once?" : "Allow this agent to open pages, read content and interact with sites for this session? Pages may receive text the agent enters."}</p>
      {request.kind === "files" && <div className="space-y-2 rounded-lg bg-surface-2 p-3 font-mono text-ui-sm text-fg-secondary"><p className="break-all">{request.destination}</p><ul>{request.paths?.map(path => <li key={path} className="break-all">{path}</li>)}</ul></div>}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={() => void answer(request, false)}>Deny</Button>
        <Button variant="primary" disabled={busy} onClick={() => void answer(request, true)}>{request.kind === "files" ? "Allow once" : "Allow for this session"}</Button>
      </div>
    </div>
  </div>;
}
