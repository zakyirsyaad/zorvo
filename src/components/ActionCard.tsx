import { useId, useState } from "react";
import { Check, X, Wrench, AlertTriangle } from "lucide-react";
import { Button, type ButtonVariant } from "./ui/Button";
import { UserQuestionFields } from "./UserQuestionFields";
import { EMPTY_DRAFT, answersOf, usableQuestions, type QuestionDraft } from "../lib/user-questions";
import type { ActionCard as ActionCardType, PermissionChoice } from "../types";

/** The typed answers of Qwen Code's `ask_user_question`: question number to text. */
export type QuestionAnswers = Record<string, string>;

/** A permission request from an agent, answered with one of the agent's own options. */
export interface ActionCardProps {
  card: ActionCardType;
  /** Picks one of the agent's options; `answers` go with an allowing pick on a card that asks questions. */
  onChoose?: (optionId: string, answers?: QuestionAnswers) => void;
  disabled?: boolean;
}

/** Shown on a request that came without options: only stopping the agent ends the wait. */
export const NO_OPTIONS_MESSAGE = "This request has no options to pick. Stop the agent to continue.";

function choiceVariant(kind: string): ButtonVariant {
  if (kind === "allow_once") return "primary";
  return kind.startsWith("allow") ? "outline" : "danger";
}

/** The agent's own answers to its permission request, or the one that was picked. */
function PermissionChoices({
  card,
  disabled,
  onChoose,
  asksQuestions,
  answers,
}: {
  card: ActionCardType;
  disabled: boolean;
  onChoose?: (optionId: string, answers?: QuestionAnswers) => void;
  /** The card shows questions: an allowing pick needs all of them answered, and sends the answers. */
  asksQuestions: boolean;
  answers: QuestionAnswers | undefined;
}) {
  const hintId = useId();
  const options: PermissionChoice[] = card.options ?? [];
  const needsAnswers = asksQuestions && answers === undefined;
  if (card.status !== "pending") {
    const chosen = options.find((o) => o.optionId === card.chosenOptionId);
    return (
      <p className="mt-4 border-t border-border pt-2 text-xs text-fg-muted">
        {chosen ? `You chose: ${chosen.name}` : "This request was not answered."}
      </p>
    );
  }
  if (options.length === 0) {
    return <p className="mt-4 border-t border-border pt-2 text-xs text-fg-muted">{NO_OPTIONS_MESSAGE}</p>;
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-2">
      {needsAnswers && (
        <p id={hintId} className="w-full text-xs text-fg-muted">
          Answer every question to submit.
        </p>
      )}
      {options.map((option) => {
        const isAllow = option.kind.startsWith("allow");
        const waitsForAnswers = isAllow && needsAnswers;
        return (
          <Button
            key={option.optionId}
            variant={choiceVariant(option.kind)}
            disabled={disabled || waitsForAnswers}
            aria-describedby={waitsForAnswers ? hintId : undefined}
            onClick={() =>
              isAllow && answers ? onChoose?.(option.optionId, answers) : onChoose?.(option.optionId)
            }
            icon={isAllow ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          >
            {option.name}
          </Button>
        );
      })}
    </div>
  );
}

export function ActionCard({ card, onChoose, disabled = false }: ActionCardProps) {
  // A form needs a way to send it: a card with questions but no allowing option stays a plain card.
  // The questions come back from the saved transcript, so their shape is checked again.
  const questions = card.options?.some((o) => o.kind.startsWith("allow")) ? usableQuestions(card.questions) : undefined;
  // What is picked or typed lives here, in memory, so an answer that did not go through keeps it. It is never stored.
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const answers = questions ? answersOf(questions, drafts) : undefined;
  const setDraft = (index: number, draft: QuestionDraft) =>
    setDrafts((prev) => (questions ?? []).map((_, i) => (i === index ? draft : (prev[i] ?? EMPTY_DRAFT))));
  return (
    <div
      data-testid={`action-card-${card.id}`}
      className="my-3 rounded-xl border border-attention-border bg-attention-surface p-4 text-left transition-all"
    >
      {/* Header with Title and Tool Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-status-attention shrink-0" />
          <h2 className="text-sm font-semibold tracking-wide text-fg">
            {card.title}
          </h2>
        </div>

        {card.toolName && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 border border-border px-2.5 py-0.5 text-xs font-mono text-fg-muted">
            <Wrench className="h-3 w-3 text-fg-subtle" />
            Tool: {card.toolName}
          </span>
        )}
      </div>

      {/* Description / Prompt */}
      <p className="mt-2 text-xs leading-relaxed text-fg-secondary">
        {card.prompt}
      </p>

      {/* Command Snippet */}
      {card.commandSnippet && (
        <div className="mt-3 rounded-lg border border-border bg-bg p-2.5 font-mono text-xs text-fg-secondary overflow-x-auto">
          <code>{card.commandSnippet}</code>
        </div>
      )}

      {card.status === "pending" && card.modeChanged && (
        <p className="mt-2 text-[11px] text-fg-subtle">
          The permission mode changed after the agent asked. This request was made before the switch, so it still needs an answer.
        </p>
      )}

      {questions && card.status === "pending" && (
        <UserQuestionFields questions={questions} drafts={drafts} onChange={setDraft} disabled={disabled} />
      )}

      <PermissionChoices
        card={card}
        disabled={disabled}
        onChoose={onChoose}
        asksQuestions={questions !== undefined}
        answers={answers}
      />
    </div>
  );
}
