import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui/Button";
import { exportLine } from "../lib/acp-auth";

/** How long Copy reads Copied. */
const COPIED_MS = 2000;

/**
 * The line a key method needs in the user's shell, with Copy. It holds a placeholder, never a key:
 * Zorvo never asks for or stores one.
 */
export function ExportLine({ variable }: { variable: string }) {
  const line = exportLine(variable);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const copy = () => {
    // WKWebView has the clipboard API; a refusal leaves the line on screen to copy by hand.
    navigator.clipboard?.writeText(line).then(
      () => setIsCopied(true),
      () => {},
    );
  };

  return (
    <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-ground pl-2.5 pr-1">
      <code className="min-w-0 flex-1 truncate font-mono text-ui-sm text-fg-secondary">{line}</code>
      <Button
        variant="ghost"
        tone="secondary"
        size="sm"
        aria-label={`Copy the line that sets ${variable}`}
        icon={isCopied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        onClick={copy}
      >
        {isCopied ? "Copied" : "Copy"}
      </Button>
      <span role="status" className="sr-only">
        {isCopied ? "Copied." : ""}
      </span>
    </div>
  );
}
