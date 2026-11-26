import { memo } from "react";
import { ActionCard } from "../ActionCard";
import { AgentTile } from "../ui/AgentTile";
import { ElicitationCard } from "./ElicitationCard";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { MessageActionBar } from "../MessageActionBar";
import type { RewindOptions } from "../../hooks/useSessionRewind";
import { isValidCheckpoint } from "../../lib/turn-checkpoints";
import { UserMessageBar } from "./UserMessageBar";
import { AttachmentChips } from "../composer/AttachmentChips";
import { ToolsPart } from "./ToolsPart";
import { VisualBlock } from "./VisualBlock";
import { ToolDetails } from "./ToolDetails";
import { shownTools, stepsOf } from "../../lib/task-view";
import { PlanUpdatedRow, ThinkingBlock } from "./ReplyExtras";
import { VerificationBadge } from "../private/VerificationBadge";
import type { ModelPrice } from "../../lib/private-credits";
import { partsOf } from "../../lib/acp-events";
import { escapeVisible } from "../../lib/visible-text";
import { workerStateWord } from "../../lib/workers";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ChatMessage, ElicitationAnswer, ToolExecution } from "../../types";
import { SELECTABLE_TEXT_ATTRIBUTE } from "../../hooks/useChatSelection";

/** No label for a message replayed from the agent's history, which gives no per-message time. */
function timeLabelOf(message: ChatMessage): string | undefined {
  return message.hasKnownTime === false ? undefined : formatRelativeTime(message.timestamp);
}
import { ArtifactCardRow } from "./ArtifactCardRow";
import type { ArtifactCard } from "../../types";
import { cardIdOf } from "../../lib/artifacts";
import { NextStepBox, type NextStepView } from "./NextStepBox";

/** A message or card that arrives on screen fades in once (the appear token); streamed text does not move. */
const APPEAR = "motion-safe:animate-appear";

export interface MessageRowProps {
  message: ChatMessage;
  agentName: string;
  /** The agent's id, for its logo in the reply's header. */
  agentProfileId?: string;
  /** True for the newest visible message: its reasoning is not done yet. */
  isLast: boolean;
  /** True for the turn the user is watching: its diffs open themselves. */
  isCurrentTurn: boolean;
  /** True once the agent's turn has ended: only then are its actions offered. */
  showActions: boolean;
  copied: boolean;
  speaking: boolean;
  readAloudSupported: boolean;
  onCopy: (messageId: string, content: string) => void;
  onFork?: (messageId: string) => void;
  onRewind?: (messageId: string, options?: RewindOptions) => void;
  onToggleReadAloud: (messageId: string, content: string) => void;
  onChooseOption?: (cardId: string, optionId: string, answers?: Record<string, string>) => void;
  onAnswerElicitation?: (key: string, answer: ElicitationAnswer) => void;
  onReopenElicitationUrl?: (key: string) => void;
  /** The ids of the session's artifacts: a card whose artifact is not among them reads Removed. Absent where they are unknown. */
  artifactIds?: ReadonlySet<string>;
  /** Shows an artifact card's version in the Artifacts tab. */
  onOpenArtifact?: (card: ArtifactCard) => void;
  /** Opens NEAR AI's Verification Center from a private reply's badge. */
  onOpenUrl?: (url: string) => void;
  /** The private model id, for the badge's popover. */
  privateModelId?: string;
  /** That model's listed price, for a reply's credits. */
  privateModel?: ModelPrice | null;
  /** A window with no overview card (a popout) shows a subagent's steps under the reply's tools. */
  showSubagentSteps?: boolean;
  /** True when the message arrived while its chat was on screen: it fades in once. */
  /** The session whose inline visuals this row may read. Absent in a popout, which shows their titles only. */
  visualSessionId?: string;
  appears?: boolean;
  /** True when its permission or input card arrived on screen after the message itself: the card fades in once. */
  cardAppears?: boolean;
  /** The active next-step box (drawn under the reply it names), null when none is active, undefined in a popout. */
  nextStep?: NextStepView | null;
}

/** A subagent's steps in the reply itself, for a window that has no inspector to open them in. */
function SubagentSteps({ tool, message, isTurnOver }: { tool: ToolExecution; message: ChatMessage; isTurnOver: boolean }) {
  const { parts, tools } = stepsOf(tool, message);
  const byId = new Map(tools.map((child) => [child.id, child]));
  return (
    <div className="ml-[7px] flex flex-col gap-2 border-l border-border pl-3">
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <MarkdownRenderer key={index} content={part.text} />
        ) : part.kind === "tools" ? (
          <ToolsPart key={index} tools={part.toolIds.flatMap((id) => byId.get(id) ?? [])} isCurrentTurn={false} isTurnOver={isTurnOver} />
        ) : null,
      )}
      {/* What its own tool call returned, which the task tab shows as its result. */}
      {tool.details && tool.details.length > 0 && <ToolDetails details={tool.details} />}
    </div>
  );
}

/**
 * One message and its controls. Memoized so a streamed chunk re-renders only
 * the reply it belongs to, not every row above it in a long conversation.
 * Every prop is stable for a message that did not change: the message object,
 * booleans, and callbacks that take the message id.
 */
export const MessageRow = memo(function MessageRow({
  message,
  agentName,
  agentProfileId,
  isLast,
  isCurrentTurn,
  showActions,
  copied,
  speaking,
  readAloudSupported,
  onCopy,
  onFork,
  onRewind,
  onToggleReadAloud,
  onChooseOption,
  onAnswerElicitation,
  onReopenElicitationUrl,
  artifactIds,
  onOpenArtifact,
  onOpenUrl,
  privateModelId,
  privateModel,
  showSubagentSteps = false,
  visualSessionId,
  appears = false,
  cardAppears = false,
  nextStep,
}: MessageRowProps) {
  const isUser = message.role === "user";
  const timeLabel = timeLabelOf(message);
  const toolsById = new Map((message.tools ?? []).map((tool) => [tool.id, tool]));
  // Older transcripts have no parts; render them with the same tool rows as a
  // reply saved with parts, without rewriting the saved data.
  const parts = partsOf(message);

  // Your message sits in a bubble on the right; the agent's reply sits on the background.
  // Only the text can be selected, to copy or to reply to; its buttons cannot.
  const text = (
    <div
      {...{ [SELECTABLE_TEXT_ATTRIBUTE]: "" }}
      // Your message's time is its tooltip: the canvas draws no time under the bubble.
      title={isUser ? timeLabel : undefined}
      className={`text-left select-text [&_button]:select-none ${
        isUser
          ? // A soft fill with no edge and a 14px corner, so your message never reads as a card.
            "ml-auto max-w-[80%] rounded-[14px] bg-chip px-3.5 py-2.5 text-body text-fg"
          : "w-full text-body text-fg-secondary"
      }`}
    >
      {message.thinking && (
        // A reply is done once its turn ended or anything came after it.
        <ThinkingBlock text={message.thinking} isDone={Boolean(message.isComplete) || !isLast} />
      )}
      {message.plan && message.plan.length > 0 && <PlanUpdatedRow entries={message.plan} />}
      {message.attachments && message.attachments.length > 0 && (
        <div className={parts.length > 0 ? "mb-2" : undefined}>
          <AttachmentChips paths={message.attachments} />
        </div>
      )}
      {parts.length > 0 && (
        <div className="space-y-4">
          {parts.map((part, index) => {
            if (part.kind === "text") return <MarkdownRenderer key={index} content={part.text} />;
            if (part.kind === "visual") {
              return <VisualBlock key={part.id} sessionId={visualSessionId} part={part} agentName={agentName} isArriving={isCurrentTurn && !message.isComplete} />;
            }
            const listed = shownTools(part.toolIds.flatMap((id) => toolsById.get(id) ?? []));
            if (listed.length === 0) return null;
            // Every tool, a subagent included, is a plain row here, so what it returned can still be read in
            // place; the overview card lists the subagents and opens their tabs. A popout has no card, so a
            // subagent's steps show under the list.
            const subagents = showSubagentSteps ? listed.filter((tool) => tool.steps !== undefined) : [];
            return (
              <div key={index} className="flex flex-col gap-2">
                <ToolsPart tools={listed} isCurrentTurn={isCurrentTurn} isTurnOver={showActions} />
                {subagents.map((tool) => (
                  <SubagentSteps key={tool.id} tool={tool} message={message} isTurnOver={showActions} />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* The agent's permission request, answered with one of its options */}
      {message.actionCard && (
        <div className={cardAppears ? APPEAR : undefined}>
          <ActionCard
            card={message.actionCard}
            agentName={agentName}
            agentProfileId={agentProfileId}
            onChoose={
              onChooseOption
                ? (optionId, answers) =>
                    answers
                      ? onChooseOption(message.actionCard!.id, optionId, answers)
                      : onChooseOption(message.actionCard!.id, optionId)
                : undefined
            }
          />
        </div>
      )}

      {/* The agent's request for input or to open a page; keyed so typed values never move between cards */}
      {message.elicitation && (
        <div className={cardAppears ? APPEAR : undefined}>
          <ElicitationCard
            key={message.elicitation.key}
            card={message.elicitation}
            agentName={agentName}
            agentProfileId={agentProfileId}
            onAnswer={onAnswerElicitation}
            onReopen={onReopenElicitationUrl}
          />
        </div>
      )}

      {/* Where the agent showed a page */}
      {message.artifactCard && (
        <ArtifactCardRow
          card={message.artifactCard}
          state={artifactIds === undefined || artifactIds.has(cardIdOf(message.artifactCard)) ? "open" : "removed"}
          onOpen={onOpenArtifact}
        />
      )}

      {/* What happens next, under a turn that ended on its own */}
      {message.role === "agent" && message.endedNormally && (nextStep?.messageId === message.id || message.nextStep) && (
        <NextStepBox
          step={message.nextStep}
          agentName={agentName}
          view={nextStep === undefined ? undefined : nextStep?.messageId === message.id ? nextStep : null}
        />
      )}
    </div>
  );

  return (
    <div
      id={`message-${message.id}`}
      tabIndex={-1}
      data-testid={`chat-message-${message.id}`}
      className={`group focus-ring data-[jumped]:outline data-[jumped]:outline-1 data-[jumped]:outline-offset-1 data-[jumped]:outline-focus-ring flex flex-col ${isUser ? "items-end" : "items-start"} w-full max-w-chat mx-auto ${appears ? APPEAR : ""}`}
    >
      {isUser ? (
        <>
          {(message.delegationReport ?? message.delegationTask) && (
            // A report from a delegated session, or a task given to one, keeps its bubble,
            // headed like a reply, saying whose it is.
            <div data-delegation-header="" className="mb-2 flex min-w-0 max-w-full items-center gap-2">
              <AgentTile
                profileId={(message.delegationReport ?? message.delegationTask)?.agentId ?? ""}
                name=""
                size={22}
              />
              <span className="min-w-0 truncate text-ui-sm font-medium text-fg">
                {message.delegationReport
                  ? `From ${message.delegationReport.agentName}${
                      message.delegationReport.handle !== undefined
                        ? ` (${escapeVisible(message.delegationReport.handle)})`
                        : ""
                    }`
                  : `Task from ${message.delegationTask?.agentName ?? ""}`}
              </span>
            </div>
          )}
          {message.workerReport && (
            // One message about several workers: who they are and how each turn ended, as words.
            <div data-worker-report="" className="mb-2 flex min-w-0 max-w-full flex-col gap-1">
              <span className="text-ui-sm font-medium text-fg">Worker reports</span>
              <ul className="flex flex-col gap-0.5">
                {message.workerReport.workers.map((worker, index) => {
                  const word = workerStateWord(worker.state);
                  if (word === "") return null;
                  return (
                    <li key={`${worker.handle}-${index}`} className="flex min-w-0 items-center gap-2 text-ui-sm text-fg-muted">
                      <span className="min-w-0 truncate text-fg">{escapeVisible(worker.handle)}</span>
                      <span className="min-w-0 truncate">{escapeVisible(worker.agentName)}</span>
                      <span className="shrink-0">{word}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {text}
          <UserMessageBar
            copied={copied}
            onCopy={() => onCopy(message.id, message.content)}
            canRestoreFiles={isValidCheckpoint(message.checkpoint)}
            onRewind={onRewind ? (options) => (options ? onRewind(message.id, options) : onRewind(message.id)) : undefined}
          />
        </>
      ) : (
        // The reply sits on the chat itself: no box and no fill under the pointer. Its actions show
        // on hover or focus, through opacity alone, so nothing under the text changes.
        <div data-message-body="" className="self-stretch">
          {/* The agent's reply is headed by its tile, name and time; your own message only when a delegate wrote it. */}
          <div data-message-header="" className="mb-2 flex min-w-0 max-w-full items-center gap-2">
            <AgentTile profileId={agentProfileId ?? ""} name="" size={22} />
            <span className="min-w-0 truncate text-ui-sm font-medium text-fg">{agentName}</span>
            {timeLabel && <span className="shrink-0 text-caption text-fg-subtle">{timeLabel}</span>}
          </div>
          {text}
          {message.verification && (
            <VerificationBadge
              verification={message.verification}
              modelId={privateModelId}
              model={privateModel}
              onOpenUrl={onOpenUrl}
            />
          )}
          {/* The reply's actions, once its turn has ended */}
          {showActions && (
            <MessageActionBar
              copied={copied}
              onCopy={() => onCopy(message.id, message.content)}
              onFork={onFork ? () => onFork(message.id) : undefined}
              readAloud={
                readAloudSupported
                  ? { speaking, onToggle: () => onToggleReadAloud(message.id, message.content) }
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
});
