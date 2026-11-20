import { useId, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "../ui/Button";
import { PathText } from "../ui/PathText";
import {
  COMPUTER_USE_ALLOW,
  COMPUTER_USE_CARD_COPY,
  COMPUTER_USE_DENY,
  canTick,
  settledComputerUseWords,
  ticksAsAnswers,
} from "../../lib/computer-use-card";
import type { ActionCard, ComputerUseApp, ComputerUseRequest } from "../../types";

export interface ComputerUseCardProps {
  card: ActionCard;
  request: ComputerUseRequest;
  agentName: string;
  /** The answer, with the ticked rows as `{ [key]: "on" }`. */
  onChoose?: (optionId: string, answers?: Record<string, string>) => void;
  disabled?: boolean;
}

/** The app's own icon when Zorvo could read one, else its first letter. */
function AppIcon({ app }: { app: ComputerUseApp }) {
  if (app.icon) return <img src={app.icon} alt="" width={32} height={32} className="size-8 shrink-0" />;
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-md text-ui font-semibold ${
        app.installed ? "bg-chip text-fg-secondary" : "border border-dashed border-border-strong text-fg-subtle"
      }`}
    >
      {app.installed ? app.name.slice(0, 1).toUpperCase() : "?"}
    </span>
  );
}

function AppRow({
  app,
  isTicked,
  isOpen,
  disabled,
  onToggle,
}: {
  app: ComputerUseApp;
  isTicked: boolean;
  isOpen: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const warningId = useId();
  const tickable = canTick(app);
  return (
    <li className="flex flex-col gap-1.5 border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <AppIcon app={app} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={`shrink-0 text-ui font-medium text-fg ${app.installed ? "" : "font-mono"}`}>{app.name}</span>
            {app.signer && <span className="truncate text-ui-sm text-fg-muted">{app.signer}</span>}
          </span>
          {app.path && <PathText path={app.path} className="text-caption text-fg-subtle" />}
        </span>
        <span className={`shrink-0 text-ui-sm ${tickable ? "text-fg-secondary" : "text-fg-muted"}`}>{app.label}</span>
        {isOpen && (
          <button
            type="button"
            role="checkbox"
            aria-checked={isTicked}
            aria-label={app.name}
            aria-describedby={app.warning ? warningId : undefined}
            disabled={disabled || !tickable}
            onClick={onToggle}
            className={`focus-ring flex size-4 shrink-0 items-center justify-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-50 ${
              isTicked ? "border-primary bg-primary text-on-primary" : "border-border-strong hover:border-fg-muted"
            }`}
          >
            {isTicked && <Check className="size-3" aria-hidden="true" />}
          </button>
        )}
      </div>
      {app.warning && (
        <p id={warningId} className="ml-11 flex items-center gap-1.5 text-ui-sm text-fg-secondary">
          <AlertTriangle className="size-3 shrink-0 text-status-attention" aria-hidden="true" />
          {app.warning}
        </p>
      )}
    </li>
  );
}

/**
 * An agent asks to use apps on this Mac. Every row comes from the app on
 * disk, not from the agent; the user ticks the apps it may use.
 */
export function ComputerUseCard({ card, request, agentName, onChoose, disabled = false }: ComputerUseCardProps) {
  const isOpen = card.status === "pending";
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(request.apps.filter(canTick).map((app) => app.key)),
  );
  const hintId = useId();
  const toggle = (key: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const hasTicks = ticked.size > 0;
  return (
    <div
      data-testid={`action-card-${card.id}`}
      className="my-3 flex flex-col gap-3 rounded-panel border border-attention-border bg-surface-2 px-4 py-3.5 text-left"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0 text-status-attention" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 text-ui font-semibold text-fg">{card.title}</h2>
        {isOpen && <span className="shrink-0 text-caption text-fg-muted">Waiting for you</span>}
      </div>

      {/* The agent's reason as text, never markdown. */}
      {request.reason && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-ground px-2.5 py-2 font-sans text-ui-sm leading-relaxed text-fg-secondary">
          {request.reason}
        </pre>
      )}

      <ul aria-label={`Apps ${agentName} asks for`} className="flex flex-col">
        {request.apps.map((app) => (
          <AppRow
            key={app.key}
            app={app}
            isTicked={ticked.has(app.key)}
            isOpen={isOpen}
            disabled={disabled}
            onToggle={() => toggle(app.key)}
          />
        ))}
      </ul>

      {isOpen ? (
        <>
          <p className="text-ui-sm text-fg-muted">{COMPUTER_USE_CARD_COPY.data(agentName)}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p id={hintId} role="status" className="mr-auto text-ui-sm text-fg-muted">
              {hasTicks ? "" : COMPUTER_USE_CARD_COPY.noneTicked}
            </p>
            <Button variant="ghost" tone="secondary" disabled={disabled} onClick={() => onChoose?.(COMPUTER_USE_DENY)}>
              {COMPUTER_USE_CARD_COPY.deny}
            </Button>
            <Button
              variant="primary"
              tone="secondary"
              disabled={disabled || !hasTicks}
              aria-describedby={hintId}
              onClick={() => onChoose?.(COMPUTER_USE_ALLOW, ticksAsAnswers([...ticked]))}
            >
              {COMPUTER_USE_CARD_COPY.allow}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-ui-sm text-fg-muted">{settledComputerUseWords(card)}</p>
      )}
    </div>
  );
}
