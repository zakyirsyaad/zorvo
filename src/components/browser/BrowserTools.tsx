import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import type { BrowserEngine } from "../../lib/browser";

const GROUPS = {
  console: ["console"],
  debug: ["snapshot", "find", "evaluate", "screenshot", "wait", "click", "fill", "select", "check", "scroll"],
} as const;
type ToolPanel = keyof typeof GROUPS;
const INITIAL: Record<ToolPanel, string> = { console: "{}", debug: "{}" };

/** Every action uses the same checked backend as the agent tools, and displays its actual result. */
export function BrowserTools({ panel, tabId, execute }: {
  panel: ToolPanel;
  sessionId: string;
  engine: BrowserEngine;
  tabId?: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}) {
  const [operation, setOperation] = useState<string>(GROUPS[panel][0]);
  const [input, setInput] = useState(INITIAL[panel]);
  const [output, setOutput] = useState<unknown>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const screenshot = output && typeof output === "object" && (output as {mimeType?:unknown}).mimeType === "image/png" && typeof (output as {base64?:unknown}).base64 === "string" ? (output as {base64:string}).base64 : null;
  const run = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      const args: unknown = JSON.parse(input);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object.");
      const result = await execute({ ...args, operation, tabId });
      setOutput(result);
    } catch (error) { setFailure(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <form onSubmit={event => void run(event)} className="flex shrink-0 flex-col gap-2">
      <label className="text-ui-sm text-fg-secondary">Action
        <select aria-label="Browser tool action" value={operation} onChange={event => setOperation(event.target.value)} className="mt-1 h-8 w-full rounded-lg border border-border-strong bg-surface-2 px-2 font-mono text-ui-sm text-fg focus-ring">
          {GROUPS[panel].map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      <label className="text-ui-sm text-fg-secondary">Arguments
        <textarea aria-label="Browser tool arguments" value={input} onChange={event => setInput(event.target.value)} rows={3} spellCheck={false} className="mt-1 w-full resize-y rounded-lg border border-border-strong bg-surface-2 p-2 font-mono text-ui-sm text-fg focus-ring" />
      </label>
      <Button type="submit" disabled={busy || !tabId} className="self-start">{busy ? "Running…" : "Run"}</Button>
    </form>
    {failure && <p role="alert" className="whitespace-pre-wrap text-ui-sm text-danger">{failure}</p>}
    {screenshot && <img alt="Browser page screenshot" src={`data:image/png;base64,${screenshot}`} className="h-auto max-w-full rounded-lg border border-border" />}
    {output !== null && <pre aria-label="Browser tool result" className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ground p-2 font-mono text-code text-fg-secondary">{typeof output === "string" ? output : JSON.stringify(screenshot ? {...output as object,base64:"Displayed above"} : output, null, 2)}</pre>}
  </div>;
}
