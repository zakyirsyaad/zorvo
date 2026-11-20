import { useMemo, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../ui/Button";
import type { BrowserEngine } from "../../lib/browser";
import { PdfPreview } from "../files/FilePreview";

const GROUPS = {
  console: ["console"],
  network: ["network.list", "network.get"],
  files: ["files.list", "files.get", "files.upload", "files.drop", "preview"],
  performance: ["trace.start", "trace.stop", "trace.analyze", "cpu.start", "cpu.stop", "cpu.analyze", "heap.snapshot", "heap.summary", "heap.query", "heap.object", "heap.compare", "lighthouse"],
  debug: ["snapshot", "find", "evaluate", "screenshot", "frames", "wait", "click", "hover", "drag", "fill", "fill_form", "select", "check", "press", "scroll", "dialog"],
} as const;
type ToolPanel = keyof typeof GROUPS;
const INITIAL: Record<ToolPanel, string> = { console: "{}", network: "{}", files: "{}", performance: "{}", debug: "{}" };

/** Every action uses the same checked backend as the agent tools, and displays its actual result. */
export function BrowserTools({ panel, sessionId, engine, tabId, execute }: {
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
  const [approval, setApproval] = useState<{ url: string; paths: string[]; approvalId: string } | null>(null);
  const screenshot = output && typeof output === "object" && (output as {mimeType?:unknown}).mimeType === "image/png" && typeof (output as {base64?:unknown}).base64 === "string" ? (output as {base64:string}).base64 : null;
  const preview = output && typeof output === "object" && typeof (output as {mime?:unknown}).mime === "string" && typeof (output as {content?:unknown}).content === "string" ? output as {mime:string;content:string;title?:string} : null;
  const pdfBytes=useMemo(()=>{
    if(preview?.mime!=="application/pdf") return null;
    try {return Uint8Array.from(atob(preview.content), char=>char.charCodeAt(0));} catch {return null;}
  },[preview?.mime,preview?.content]);
  const run = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      const args: unknown = JSON.parse(input);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object.");
      const result = await execute({ ...args, operation, tabId });
      const permission = result && typeof result === "object" ? (result as { requiresFileApproval?: typeof approval }).requiresFileApproval : null;
      if (permission && typeof permission.url === "string" && typeof permission.approvalId === "string" && Array.isArray(permission.paths) && permission.paths.every(path => typeof path === "string")) setApproval(permission);
      else setOutput(result);
    } catch (error) { setFailure(String(error)); }
    finally { setBusy(false); }
  };
  const approve = async (allow: boolean) => {
    if (!approval || busy) return;
    setBusy(true);
    const permission = approval;
    setApproval(null);
    try { setOutput(await invoke("browser_manual_file_permission", { sessionId, approvalId: permission.approvalId, allow })); }
    catch (error) { setFailure(String(error)); }
    finally { setBusy(false); }
  };
  const runtime = async (install: boolean) => {
    setBusy(true);
    setFailure(null);
    try { setOutput(install ? await invoke("browser_runtime_install") : await invoke("browser_runtime_status")); }
    catch (error) { setFailure(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    {(panel === "network" || panel === "performance" || panel === "files") && engine === "webkit" && <p className="text-ui-sm text-fg-muted">Full network, file and performance tools use Chromium debug. Select that engine to inspect its separate window.</p>}
    {panel === "performance" && <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void runtime(false)}>Check audit tools</Button><Button disabled={busy} onClick={() => void runtime(true)}>Install audit tools</Button></div>}
    {approval && <div role="group" aria-label="File transfer permission" className="space-y-2 rounded-lg border border-attention-border bg-attention-surface p-3 text-ui-sm text-fg-secondary"><p>Send these files to this page?</p><p className="break-all font-mono">{approval.url}</p><ul>{approval.paths.map(path => <li key={path} className="break-all font-mono">{path}</li>)}</ul><div className="flex gap-2"><Button disabled={busy} onClick={() => void approve(false)}>Deny</Button><Button disabled={busy} onClick={() => void approve(true)}>Allow once</Button></div></div>}
    <form onSubmit={event => void run(event)} className="flex shrink-0 flex-col gap-2">
      <label className="text-ui-sm text-fg-secondary">Action
        <select aria-label="Browser tool action" value={operation} onChange={event => setOperation(event.target.value)} className="mt-1 h-8 w-full rounded-lg border border-border-strong bg-surface-2 px-2 font-mono text-ui-sm text-fg focus-ring">
          {GROUPS[panel].map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      <label className="text-ui-sm text-fg-secondary">Arguments
        <textarea aria-label="Browser tool arguments" value={input} onChange={event => setInput(event.target.value)} rows={3} spellCheck={false} className="mt-1 w-full resize-y rounded-lg border border-border-strong bg-surface-2 p-2 font-mono text-ui-sm text-fg focus-ring" />
      </label>
      <Button type="submit" disabled={busy || !tabId || approval !== null} className="self-start">{busy ? "Running…" : "Run"}</Button>
    </form>
    {failure && <p role="alert" className="whitespace-pre-wrap text-ui-sm text-danger">{failure}</p>}
    {screenshot && <img alt="Browser page screenshot" src={`data:image/png;base64,${screenshot}`} className="h-auto max-w-full rounded-lg border border-border" />}
    {preview?.mime.startsWith("image/") && <img alt={preview.title ?? "File preview"} src={`data:${preview.mime};base64,${preview.content}`} className="h-auto max-w-full rounded-lg border border-border" />}
    {pdfBytes && <div className="flex min-h-80 flex-col"><PdfPreview bytes={pdfBytes} name={preview?.title ?? "Browser PDF"} size={pdfBytes.byteLength} /></div>}
    {output !== null && <pre aria-label="Browser tool result" className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ground p-2 font-mono text-code text-fg-secondary">{typeof output === "string" ? output : JSON.stringify(screenshot ? {...output as object,base64:"Displayed above"} : output, null, 2)}</pre>}
  </div>;
}
