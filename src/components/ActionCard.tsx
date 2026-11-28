import { AlertTriangle } from "lucide-react";
import { formatLineCount, MINUS } from "../lib/diff-stats";
import { PathText } from "./ui/PathText";
import { Button, type ButtonVariant } from "./ui/Button";
import { QuestionsCard } from "./QuestionsCard";
import type { QuestionAnswers } from "./UserQuestionsForm";
import { orderedChoices, permissionTitle, titleHoldsPrompt } from "../lib/permission-copy";
import { usableQuestions } from "../lib/user-questions";
import { settledWords, usableZorvoTool } from "../lib/agent-tool-card";
import { usableComputerUse } from "../lib/computer-use-card";
import { ComputerUseCard } from "./chat/ComputerUseCard";
import type { ActionCard as ActionCardType, PermissionChoice } from "../types";

/** A permission request from an agent, answered with one of the agent's own options. */
export interface ActionCardProps {
  card: ActionCardType;
  /** Picks one of the agent's options; `answers` go with an allowing pick on a card that asks questions. */
  onChoose?: (optionId: string, answers?: QuestionAnswers) => void;
  disabled?: boolean;
  /** Who asks, named in the card's title; "The agent" when unknown. */
  agentName?: string;
  /** The asking agent, for the logo on a question card. */
  agentProfileId?: string;
}

/** Shown on a request that came without options: only stopping the agent ends the wait. */
export const NO_OPTIONS_MESSAGE = "This request has no options to pick. Stop the agent to continue.";

/** Deny is quiet (ghost), Always allow outline, Allow once the primary answer. */
function choiceVariant(kind: string): ButtonVariant {
  if (kind === "allow_once") return "primary";
  return kind.startsWith("allow") ? "outline" : "ghost";
}

/**
 * The files an edit would change, one row each: the path cut at its start so the file's name
 * stays in sight, and only the counts that are known and not zero (a diff too large to keep
 * shows its path alone).
 */
function EditedFiles({ edits }: { edits: NonNullable<ActionCardType["edits"]> }) {
  return (
    // Plain rows on the card itself: a box inside the card would be a second level of borders.
    <ul aria-label="Files to edit" className="flex flex-col gap-1">
      {edits.map((edit, index) => (
        <li
          // A request can carry two diffs for one file, so the path alone is not a key.
          key={`${index}-${edit.path}`}
          className="flex items-center gap-2"
        >
          <PathText path={edit.path} className="flex-1 text-ui-sm text-fg-secondary" />
          {edit.added !== undefined && edit.added > 0 && (
            <span className="shrink-0 font-mono text-caption text-status-running">+{formatLineCount(edit.added)}</span>
          )}
          {edit.removed !== undefined && edit.removed > 0 && (
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
}: {
  card: ActionCardType;
  disabled: boolean;
  onChoose?: (optionId: string) => void;
}) {
  const options: PermissionChoice[] = orderedChoices(card.options ?? []);
  if (card.status !== "pending" && usableZorvoTool(card.zorvoTool)) {
    return <p className="text-ui-sm text-fg-muted">{settledWords(card)}</p>;
  }
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
      {options.map((option) => (
        <Button
          key={option.optionId}
          variant={choiceVariant(option.kind)}
          tone="secondary"
          disabled={disabled}
          onClick={() => onChoose?.(option.optionId)}
        >
          {option.name}
        </Button>
      ))}
    </div>
  );
}

export function ActionCard({ card, onChoose, disabled = false, agentName = "The agent", agentProfileId }: ActionCardProps) {
  // A form needs a way to send it: a card with questions but no allowing option stays a plain card.
  // The questions come back from the saved transcript, so their shape is checked again.
  const questions = card.options?.some((o) => o.kind.startsWith("allow")) ? usableQuestions(card.questions) : undefined;
  if (questions) {
    return (
      <QuestionsCard
        card={card}
        questions={questions}
        agentName={agentName}
        agentProfileId={agentProfileId}
        onChoose={onChoose}
        disabled={disabled}
      />
    );
  }
  // An agent's request to use apps on this Mac: rows to tick, answered with their keys.
  const computerUse = usableComputerUse(card.computerUse);
  if (computerUse) {
    return (
      <ComputerUseCard card={card} request={computerUse} agentName={agentName} onChoose={onChoose} disabled={disabled} />
    );
  }
  // A card Zorvo made for an agent's tool call carries its own title, and its prompt is the task.
  const zorvoTool = usableZorvoTool(card.zorvoTool);
  const title = zorvoTool ? card.title : permissionTitle(agentName, card.prompt);
  const showsPrompt = !zorvoTool && !titleHoldsPrompt(card.prompt);
  return (
    <div
      data-testid={`action-card-${card.id}`}
      // The card's own surface: amber only in the icon and the thin edge, so the request reads calm.
      className="my-3 flex flex-col gap-3 rounded-panel border border-attention-border bg-surface-2 px-4 py-3.5 text-left transition-all"
    >
      {/* One sentence says what the agent wants; the agent's own title follows only when the sentence cannot hold it. */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0 text-status-attention" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 text-ui font-semibold text-fg">{title}</h2>
        {/* Only while the request is open: an answered card says what was chosen instead. */}
        {card.status === "pending" && <span className="shrink-0 text-caption text-fg-muted">Waiting for you</span>}
      </div>

      {showsPrompt && card.prompt.trim() && (
        <p className="text-ui-sm leading-relaxed text-fg-secondary">{card.prompt}</p>
      )}

      {zorvoTool && (
        <>
          <p className="text-ui-sm text-fg-muted">{`In ${zorvoTool.folder}`}</p>
          {/* The task as text, never markdown: what is shown is what the other agent reads. */}
          <pre
            data-testid="zorvo-tool-task"
            className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-ground px-2.5 py-2 font-sans text-ui-sm leading-relaxed text-fg-secondary"
          >
            {card.prompt}
          </pre>
          {zorvoTool.hasOwnWorktree && (
            <p className="text-ui-sm text-fg-muted">It gets a worktree of its own, on a new branch.</p>
          )}
          {card.status === "pending" && (
            <p className="text-caption text-fg-subtle">
              {zorvoTool.tool === "browser"
                ? `${zorvoTool.callerName} can read pages, run scripts, click and fill forms in this session's browser, including signed-in pages. Access lasts until you revoke it or the agent ends.`
                : zorvoTool.isOtherFolder
                ? "This asks every time: a session in another folder is never allowed in advance."
                : `After you allow it, ${zorvoTool.callerName} can give tasks to other agents in this session without asking again.`}
            </p>
          )}
        </>
      )}

      {card.edits && card.edits.length > 0 && <EditedFiles edits={card.edits} />}

      {/* Command Snippet */}
      {card.commandSnippet && (
        <div className="overflow-x-auto rounded-md border border-border bg-ground px-2.5 py-2 font-mono text-ui-sm text-fg-secondary">
          <code>{card.commandSnippet}</code>
        </div>
      )}

      {card.status === "pending" && card.modeChanged && (
        <p className="text-caption text-fg-subtle">
          The permission mode changed after the agent asked. This request was made before the switch, so it still needs an answer.
        </p>
      )}

      <PermissionChoices card={card} disabled={disabled} onChoose={onChoose} />
    </div>
  );
}
