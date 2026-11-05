import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatLineCount, MINUS } from "../lib/diff-stats";
import { Button, type ButtonVariant } from "./ui/Button";
import { UserQuestionFields } from "./UserQuestionFields";
import { orderedChoices, permissionTitle, questionsTitle, titleHoldsPrompt } from "../lib/permission-copy";
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
  /** Who asks, named in the card's title; "The agent" when unknown. */
  agentName?: string;
}

/** Shown on a request that came without options: only stopping the agent ends the wait. */
export const NO_OPTIONS_MESSAGE = "This request has no options to pick. Stop the agent to continue.";

/** Deny is quiet (ghost), Always allow outline, Allow once the primary answer. */
function choiceVariant(kind: string): ButtonVariant {
  if (kind === "allow_once") return "primary";
  return kind.startsWith("allow") ? "outline" : "ghost";
}

/** The files an edit would change, one row each, with only the counts that are not zero. */
function EditedFiles({ edits }: { edits: NonNullable<ActionCardType["edits"]> }) {
  return (
    <ul aria-label="Files to edit" className="rounded-md border border-border bg-bg">
      {edits.map((edit) => (
        <li
          key={edit.path}
          className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-fg-secondary" title={edit.path}>
            {edit.path}
          </span>
          {edit.added > 0 && (
            <span className="shrink-0 font-mono text-caption text-status-running">+{formatLineCount(edit.added)}</span>
          )}
          {edit.removed > 0 && (
            <span className="shrink-0 font-mono text-caption text-danger">
              {MINUS}
              {formatLineCount(edit.removed)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
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
  const options: PermissionChoice[] = orderedChoices(card.options ?? []);
  const needsAnswers = asksQuestions && answers === undefined;
  if (card.status !== "pending") {
    const chosen = options.find((o) => o.optionId === card.chosenOptionId);
    return (
      <p className="text-ui-sm text-fg-muted">
        {chosen ? `You chose: ${chosen.name}` : "This request was not answered."}
      </p>
    );
  }
  if (options.length === 0) {
    return <p className="text-ui-sm text-fg-muted">{NO_OPTIONS_MESSAGE}</p>;
  }
  // Right-aligned plain buttons, with no rule above them, as the canvas draws them.
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {needsAnswers && (
        <p id={hintId} className="w-full text-right text-ui-sm text-fg-muted">
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
          >
            {option.name}
          </Button>
        );
      })}
    </div>
  );
}

export function ActionCard({ card, onChoose, disabled = false, agentName = "The agent" }: ActionCardProps) {
  // A form needs a way to send it: a card with questions but no allowing option stays a plain card.
  // The questions come back from the saved transcript, so their shape is checked again.
  const questions = card.options?.some((o) => o.kind.startsWith("allow")) ? usableQuestions(card.questions) : undefined;
  const title = questions ? questionsTitle(agentName, questions.length) : permissionTitle(agentName, card.prompt);
  const showsPrompt = questions !== undefined || !titleHoldsPrompt(card.prompt);
  // What is picked or typed lives here, in memory, so an answer that did not go through keeps it. It is never stored.
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const answers = questions ? answersOf(questions, drafts) : undefined;
  const setDraft = (index: number, draft: QuestionDraft) =>
    setDrafts((prev) => (questions ?? []).map((_, i) => (i === index ? draft : (prev[i] ?? EMPTY_DRAFT))));
  return (
    <div
      data-testid={`action-card-${card.id}`}
      className="my-3 flex flex-col gap-3 rounded-xl border border-attention-border bg-attention-surface p-4 text-left transition-all"
    >
      {/* One sentence says what the agent wants; the agent's own title follows only when the sentence cannot hold it. */}
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-attention" aria-hidden="true" />
        <h2 className="text-ui font-semibold text-fg">{title}</h2>
      </div>

      {showsPrompt && card.prompt.trim() && (
        <p className="text-ui-sm leading-relaxed text-fg-secondary">{card.prompt}</p>
      )}

      {card.edits && card.edits.length > 0 && <EditedFiles edits={card.edits} />}

      {/* Command Snippet */}
      {card.commandSnippet && (
        <div className="overflow-x-auto rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-ui-sm text-fg-secondary">
          <code>{card.commandSnippet}</code>
        </div>
      )}

      {card.status === "pending" && card.modeChanged && (
        <p className="text-caption text-fg-subtle">
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
