import { X } from "lucide-react";
import { AgentTile } from "../ui/AgentTile";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ElicitationFields } from "./ElicitationFields";
import { canSubmit } from "../../lib/elicitation-form";
import { useElicitationForm } from "../../hooks/useElicitationForm";
import type {
  ElicitationAnswer,
  ElicitationCard as ElicitationCardData,
  ElicitationStatus,
} from "../../types";

export interface ElicitationCardProps {
  card: ElicitationCardData;
  agentName: string;
  /** The agent's id, for its logo before the card's title. */
  agentProfileId?: string;
  onAnswer?: (key: string, answer: ElicitationAnswer) => void;
  /** Opens a URL request again after it was opened once. */
  onReopen?: (key: string) => void;
  disabled?: boolean;
}

export const CANNOT_SHOW_MESSAGE = "This form has a field Zorvo cannot show. You can decline or dismiss it.";

const WARNINGS = {
  punycode: "This address uses look-alike characters.",
  "ip-address": "This address is a bare IP address.",
  "user-info": "This address hides a name before the @.",
} as const;

const SUMMARIES: Record<Exclude<ElicitationStatus, "pending">, string> = {
  submitted: "You sent the form.",
  declined: "You declined.",
  dismissed: "You dismissed this request.",
  opened: "Opened in your browser.",
  completed: "Finished in your browser.",
  unanswered: "This request was not answered.",
};

/**
 * An agent's request for details or to open a page: its logo and what it needs, the agent's
 * message, the fields, then Decline and the answer on the right. Dismiss sits at the top right.
 */
export function ElicitationCard({ card, agentName, agentProfileId, onAnswer, onReopen, disabled = false }: ElicitationCardProps) {
  const answer = (a: ElicitationAnswer) => onAnswer?.(card.key, a);
  const form = useElicitationForm(card, answer);
  const summary = card.status === "pending" ? null : SUMMARIES[card.status];
  const isForm = card.mode === "form";

  return (
    <div
      data-testid={`elicitation-card-${card.key}`}
      className="my-3 flex flex-col gap-3.5 rounded-xl border border-border-strong bg-surface-2 p-4 text-left transition-all"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <AgentTile profileId={agentProfileId ?? ""} name="" size={22} />
          <h2 className="min-w-0 flex-1 text-ui font-semibold text-fg">
            {isForm ? `${agentName} needs a few details` : `${agentName} wants to open a page`}
          </h2>
          {summary === null && (
            <IconButton label="Dismiss" size="sm" disabled={disabled} onClick={() => answer({ action: "cancel" })}>
              <X size={12} />
            </IconButton>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-ui text-fg-muted">{card.message}</p>
      </div>

      {isForm && summary === null && <FormRequest form={form} disabled={disabled} onAnswer={answer} />}
      {!isForm && summary === null && <UrlRequest card={card} disabled={disabled} onAnswer={answer} />}

      {summary !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-ui-sm text-fg-muted">{summary}</p>
          {card.status === "opened" && onReopen && !disabled && (
            <Button onClick={() => onReopen(card.key)}>
              Open again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function FormRequest({
  form,
  disabled,
  onAnswer,
}: {
  form: ReturnType<typeof useElicitationForm>;
  disabled: boolean;
  onAnswer: (a: ElicitationAnswer) => void;
}) {
  const sendable = canSubmit(form.fields);
  return (
    <form
      noValidate
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (sendable && !disabled) form.submit();
      }}
    >
      <ElicitationFields fields={form.fields} values={form.values} errors={form.errors} onChange={form.change} disabled={disabled} />
      {!sendable && <p className="text-ui-sm text-fg-muted">{CANNOT_SHOW_MESSAGE}</p>}
      <Actions>
        <DeclineButton disabled={disabled} onAnswer={onAnswer} />
        {sendable && (
          <Button type="submit" variant="primary" disabled={disabled}>
            Submit
          </Button>
        )}
      </Actions>
    </form>
  );
}

/** The answers, right-aligned with no rule above them, as the canvas draws them. */
function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

function DeclineButton({ disabled, onAnswer }: { disabled: boolean; onAnswer: (a: ElicitationAnswer) => void }) {
  return (
    <Button variant="ghost" disabled={disabled} onClick={() => onAnswer({ action: "decline" })}>
      Decline
    </Button>
  );
}

function UrlRequest({ card, disabled, onAnswer }: { card: ElicitationCardData; disabled: boolean; onAnswer: (a: ElicitationAnswer) => void }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-md border border-border bg-ground px-2.5 py-2 font-mono text-ui-sm text-fg-secondary">
        <p>
          Host: <strong className="text-fg">{card.host}</strong>
        </p>
        <p className="mt-1 break-all">{card.url}</p>
      </div>
      {card.warnings?.map((warning) => (
        <p key={warning} className="text-ui-sm text-status-attention">
          {WARNINGS[warning]}
        </p>
      ))}
      {card.blocked && <p className="text-ui-sm text-danger">{card.blocked}</p>}
      <Actions>
        <DeclineButton disabled={disabled} onAnswer={onAnswer} />
        {!card.blocked && (
          <Button variant="primary" disabled={disabled} onClick={() => onAnswer({ action: "accept" })}>
            Open in browser
          </Button>
        )}
      </Actions>
    </div>
  );
}
