import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "./ui/Button";
import { ExportLine } from "./ExportLine";
import { methodButtonLabel, splitMethods, type AuthMethod } from "../lib/acp-auth";

/** The line under a method's name: the agent's own description, else what pressing it does. */
export function methodHint(method: AuthMethod): string | null {
  if (method.description) return method.description;
  if (method.kind === "terminal") return "Opens a sign-in terminal.";
  if (method.kind === "explain") {
    return method.variables?.length ? "Add this line to ~/.zshrc and paste your key after the =. Zorvo reads your shell again when you come back." : "Set it up in your shell, then check again.";
  }
  return null;
}

interface MethodsProps {
  methods: readonly AuthMethod[];
  isBusy: boolean;
  onSignIn: (methodId: string) => void;
}

/** A key or setting Zorvo never handles: the lines to add to the shell, or words only. */
function KeyMethod({ method }: { method: AuthMethod }) {
  const variables = method.variables ?? [];
  return (
    <li className="flex flex-col gap-2 border-t border-border py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-ui text-fg-secondary">{method.name}</span>
          {methodHint(method) && <span className="text-ui-sm text-fg-subtle">{methodHint(method)}</span>}
        </span>
        {/* Never a field: the app never asks for or stores a key. */}
        {variables.length === 0 && <span className="shrink-0 text-caption text-fg-subtle">In your shell</span>}
      </div>
      {variables.map((variable) => (
        <ExportLine key={variable} variable={variable} />
      ))}
    </li>
  );
}

/** Another method Zorvo can run, under the fold. */
function RunnableMethod({ method, isBusy, onSignIn }: { method: AuthMethod } & Omit<MethodsProps, "methods">) {
  const hint = methodHint(method);
  return (
    <li className="flex items-center gap-3 border-t border-border py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui text-fg-secondary">{method.name}</span>
        {hint && <span className="text-ui-sm text-fg-subtle">{hint}</span>}
      </span>
      <Button disabled={isBusy} onClick={() => onSignIn(method.id)} className="shrink-0">
        <span className="text-fg">{methodButtonLabel(method)}</span>
      </Button>
    </li>
  );
}

/**
 * An agent's sign-in methods: the first one Zorvo can run as the one primary button, and the other ways
 * folded under it. With nothing Zorvo can run (keys only), the key methods show at once.
 */
export function SignInMethods({ methods, isBusy, onSignIn }: MethodsProps) {
  const { first, others } = splitMethods(methods);
  const [isOpen, setIsOpen] = useState(false);
  // With nothing Zorvo can run there is no fold: the key methods show at once.
  const isListShown = first === null || isOpen;
  const listId = useId();
  const firstHint = first ? methodHint(first) : null;

  const otherRows = others.map((method) =>
    method.kind === "explain" ? (
      <KeyMethod key={method.id} method={method} />
    ) : (
      <RunnableMethod key={method.id} method={method} isBusy={isBusy} onSignIn={onSignIn} />
    ),
  );

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {first && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-ground px-3 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-ui text-fg">{first.name}</span>
            {firstHint && <span className="text-ui-sm text-fg-subtle">{firstHint}</span>}
          </span>
          <Button variant="primary" disabled={isBusy} onClick={() => onSignIn(first.id)} className="shrink-0">
            {methodButtonLabel(first)}
          </Button>
        </div>
      )}
      {others.length > 0 && first && (
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => setIsOpen((open) => !open)}
          className="-ml-1.5 flex h-6.5 items-center gap-1.5 self-start rounded-md px-1.5 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover focus-ring"
        >
          {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          Other ways to sign in ({others.length})
        </button>
      )}
      {others.length > 0 && isListShown && (
        <ul id={listId} aria-label={first ? "Other ways to sign in" : "Sign-in methods"} className="flex flex-col [&>li:first-child]:border-t-0 [&>li:first-child]:pt-0">
          {otherRows}
        </ul>
      )}
    </div>
  );
}
