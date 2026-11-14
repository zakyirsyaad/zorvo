import type { ModelPrice } from "../lib/private-credits";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageRow } from "./chat/MessageRow";
import { WorkingIndicator } from "./chat/ReplyExtras";
import { AgentStallNotice } from "./chat/AgentStallNotice";
import { SelectionToolbar } from "./chat/SelectionToolbar";
import type { AgentFailures } from "../lib/agent-stall";
import { useLatest } from "../hooks/useLatest";
import { useReadAloud } from "../hooks/useReadAloud";
import { useStickToBottom } from "../hooks/useStickToBottom";
import { useChatSelection } from "../hooks/useChatSelection";
import { replyQuote } from "../lib/reply-quote";
import { isAwaitingUser } from "../lib/acp-elicitation";
import type { ChatMessage, ElicitationAnswer } from "../types";

export type { ChatMessage, ToolExecution } from "../types";

/** Header label for agent messages when the host does not name the agent. */
const DEFAULT_AGENT_NAME = "Agent";

/** When the running turn began: the time of your newest message, unless it was replayed without one. */
function turnStartedAt(messages: readonly ChatMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") return message.hasKnownTime === false ? undefined : message.timestamp;
  }
  return undefined;
}
const COPIED_FEEDBACK_MS = 2000;

/** An agent reply with no text, reasoning, plan, tools or card is noise, not a message. */
function hasSomethingToShow(msg: ChatMessage): boolean {
  if (msg.role === "user") return true;
  return Boolean(
    msg.content.trim() || msg.thinking || msg.plan?.length || msg.tools?.length || msg.actionCard || msg.elicitation,
  );
}

export interface ChatCanvasProps {
  messages: ChatMessage[];
  /** A message to bring into view; a new `nonce` jumps again. */
  jumpTo?: { messageId: string; nonce: number } | null;
  /** The jump was made: a later mount must not make it again. */
  onJumped?: () => void;
  /** Display name of the agent behind this conversation, e.g. "Claude Code". */
  agentName?: string;
  /** The agent's id, for its logo over each reply. */
  agentProfileId?: string;
  onForkBranch?: (messageId: string) => void;
  /** Answers an ACP permission card with one of the agent's options; `answers` are a question card's typed answers. */
  onChooseOption?: (cardId: string, optionId: string, answers?: Record<string, string>) => void;
  /** Answers an agent's request for input or to open a page. */
  onAnswerElicitation?: (key: string, answer: ElicitationAnswer) => void;
  /** Opens an agent's page again after the user opened it once. */
  onReopenElicitationUrl?: (key: string) => void;
  /** Opens NEAR AI's Verification Center from a private reply's badge. */
  onOpenUrl?: (url: string) => void;
  /** The private model id, for a reply's verification popover. */
  privateModelId?: string;
  /** That model's listed price, for a reply's credits. */
  privateModel?: ModelPrice | null;
  /** True while the agent works on its turn: shown under the last message. */
  isWorking?: boolean;
  /** Failed requests in a row the agent reported while it works. */
  failures?: AgentFailures;
  /** Stops the turn; offered in the notice shown when the agent seems stuck. */
  onStop?: () => void;
  /** Which conversation is shown; switching starts at its newest output. */
  conversationId?: string;
  /** Starts again from before one of your messages; Rewind is offered only when given. */
  onRewind?: (messageId: string) => void;
  /** Shown above the conversation, e.g. the folder and branch the session works in. */
  header?: ReactNode;
  /** Shown under the last message and the turn's status (a failed turn's card). */
  footer?: ReactNode;
  /** Puts a quote of text selected in a message into the message box; Reply is offered only when given. */
  onReply?: (quote: string) => void;
  /** Why the message box cannot take a quote now: Reply shows it and does nothing. */
  replyBlockedReason?: string;
}

export function ChatCanvas({
  messages,
  jumpTo,
  onJumped,
  agentName = DEFAULT_AGENT_NAME,
  agentProfileId,
  onForkBranch,
  onChooseOption,
  onAnswerElicitation,
  onReopenElicitationUrl,
  onOpenUrl,
  privateModelId,
  privateModel,
  isWorking = false,
  failures,
  onStop,
  conversationId,
  onRewind,
  header,
  footer,
  onReply,
  replyBlockedReason,
}: ChatCanvasProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const readAloud = useReadAloud();
  const visibleMessages = useMemo(() => messages.filter(hasSomethingToShow), [messages]);
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  // While a turn runs, its replies (one or more, after the last user message)
  // are still being written: copying or forking them makes no sense yet.
  let lastUserIndex = -1;
  let lastAgentIndex = -1;
  for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
    if (lastUserIndex === -1 && visibleMessages[i].role === "user") lastUserIndex = i;
    if (lastAgentIndex === -1 && visibleMessages[i].role === "agent") lastAgentIndex = i;
    if (lastUserIndex !== -1 && lastAgentIndex !== -1) break;
  }
  // The turn the user is watching is the newest reply (or replies) after their
  // last message. A transcript with no user message has only its newest reply.
  const currentTurnStartsAt = lastUserIndex >= 0 ? lastUserIndex + 1 : Math.max(lastAgentIndex, 0);
  // The turn stays open while the agent works or waits on the user; the
  // working indicator hides in the latter case, but its replies are unfinished.
  const isTurnOpen = isWorking || isAwaitingUser(messages);
  const runningTurnStartsAt = isTurnOpen ? lastUserIndex + 1 : visibleMessages.length;

  // Follow new output to the bottom while the user is there; once they scroll
  // up to read, leave the view alone.
  const stickToBottom = useStickToBottom();
  const { stopFollowing } = stickToBottom;
  const onJumpedRef = useLatest(onJumped);
  useEffect(() => {
    const target = jumpTo ? document.getElementById(`message-${jumpTo.messageId}`) : null;
    if (!target) return;
    stopFollowing();
    target.scrollIntoView({ block: "center" });
    // A press does not count as keyboard focus, so the mark is its own, and it leaves with the focus.
    target.dataset.jumped = "true";
    target.addEventListener("blur", () => delete target.dataset.jumped, { once: true });
    target.focus({ preventScroll: true });
    onJumpedRef.current?.();
  }, [jumpTo, stopFollowing, onJumpedRef]);
  // A message the user just sent, or another conversation opened, always
  // brings the view down to the newest output. The view itself stays mounted,
  // so switching conversations does not stop Read aloud.
  const lastIdRef = useRef(lastMessage?.id);
  const conversationRef = useRef(conversationId);
  useLayoutEffect(() => {
    const isNewUserMessage = lastMessage?.role === "user" && lastMessage.id !== lastIdRef.current;
    const isOtherConversation = conversationId !== conversationRef.current;
    lastIdRef.current = lastMessage?.id;
    conversationRef.current = conversationId;
    if (isNewUserMessage || isOtherConversation) stickToBottom.scrollToBottom();
    else stickToBottom.followNewContent();
    // lastMessage derives from messages, so messages is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isWorking, conversationId, stickToBottom.scrollToBottom, stickToBottom.followNewContent]);

  const onForkRef = useLatest(onForkBranch);
  const onRewindRef = useLatest(onRewind);
  const onChooseOptionRef = useLatest(onChooseOption);
  const onAnswerElicitationRef = useLatest(onAnswerElicitation);
  const onReopenElicitationUrlRef = useLatest(onReopenElicitationUrl);

  const handleCopyMessage = useCallback((id: string, content: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), COPIED_FEEDBACK_MS);
    }
  }, []);
  // These take the message id, so every row gets the same function and an
  // unchanged row is not re-rendered when the host makes a new closure.
  const handleFork = useCallback((id: string) => onForkRef.current?.(id), [onForkRef]);
  const handleRewind = useCallback((id: string) => onRewindRef.current?.(id), [onRewindRef]);
  const handleChooseOption = useCallback(
    (cardId: string, optionId: string, answers?: Record<string, string>) =>
      answers ? onChooseOptionRef.current?.(cardId, optionId, answers) : onChooseOptionRef.current?.(cardId, optionId),
    [onChooseOptionRef],
  );
  const handleAnswerElicitation = useCallback(
    (key: string, answer: ElicitationAnswer) => onAnswerElicitationRef.current?.(key, answer),
    [onAnswerElicitationRef],
  );
  const handleReopenElicitationUrl = useCallback(
    (key: string) => onReopenElicitationUrlRef.current?.(key),
    [onReopenElicitationUrlRef],
  );
  const chatSelection = useChatSelection(onReply !== undefined);
  const replyToSelection = () => {
    const quote = chatSelection.selected ? replyQuote(chatSelection.selected.text, chatSelection.selected.isCode) : "";
    chatSelection.clear();
    if (quote && !replyBlockedReason) onReply?.(quote);
  };

  const { toggle: toggleReadAloud } = readAloud;
  const handleToggleReadAloud = useCallback(
    (id: string, content: string) => toggleReadAloud(id, content),
    [toggleReadAloud],
  );

  // The working line and the stall notice name the agent; a conversation with no known agent says "The agent".
  const shownAgentName = agentName === DEFAULT_AGENT_NAME ? "The agent" : agentName;
  // When the agent started working while this conversation was on screen. Try again sends a
  // failed prompt in place, with no new message, so your message's time alone would be minutes off.
  const [workingSince, setWorkingSince] = useState<number | null>(null);
  const [seenWork, setSeenWork] = useState({ isWorking, conversationId });
  if (seenWork.isWorking !== isWorking || seenWork.conversationId !== conversationId) {
    setSeenWork({ isWorking, conversationId });
    setWorkingSince(isWorking && seenWork.conversationId === conversationId ? Date.now() : null);
  }
  const sentAt = turnStartedAt(visibleMessages);
  const workStartedAt = workingSince !== null && sentAt !== undefined ? Math.max(sentAt, workingSince) : (workingSince ?? sentAt);

  return (
    <div
      ref={stickToBottom.containerRef}
      onScroll={(event) => {
        stickToBottom.onScroll();
        chatSelection.onScroll(event.currentTarget);
      }}
      onMouseUp={(event) => chatSelection.onMouseUp(event.currentTarget)}
      onWheel={stickToBottom.onWheel}
      onKeyDown={stickToBottom.onKeyDown}
      onTouchStart={stickToBottom.onTouchStart}
      onTouchMove={stickToBottom.onTouchMove}
      data-testid="chat-canvas-container"
      className="flex-1 overflow-y-auto pt-8 px-6 pb-4 space-y-6"
    >
      {header && <div className="mx-auto w-full max-w-chat">{header}</div>}
      {visibleMessages.map((msg, index) => (
        <MessageRow
          key={msg.id}
          message={msg}
          agentName={agentName}
          agentProfileId={agentProfileId}
          isLast={msg === lastMessage}
          isCurrentTurn={msg.role === "agent" && index >= currentTurnStartsAt}
          showActions={msg.role !== "user" && index < runningTurnStartsAt}
          copied={copiedMessageId === msg.id}
          speaking={readAloud.speakingMessageId === msg.id}
          readAloudSupported={readAloud.supported}
          onCopy={handleCopyMessage}
          onFork={onForkBranch ? handleFork : undefined}
          onRewind={onRewind ? handleRewind : undefined}
          onToggleReadAloud={handleToggleReadAloud}
          onChooseOption={onChooseOption ? handleChooseOption : undefined}
          onAnswerElicitation={onAnswerElicitation ? handleAnswerElicitation : undefined}
          onReopenElicitationUrl={onReopenElicitationUrl ? handleReopenElicitationUrl : undefined}
          onOpenUrl={onOpenUrl}
          privateModelId={privateModelId}
          privateModel={privateModel}
        />
      ))}
      {isWorking && <WorkingIndicator agentName={shownAgentName} since={workStartedAt} />}
      {isWorking && (
        <AgentStallNotice agentName={shownAgentName} messages={messages} failures={failures} onStop={onStop} />
      )}
      {footer && <div className="mx-auto w-full max-w-chat">{footer}</div>}
      {chatSelection.selected && (
        <SelectionToolbar selection={chatSelection.selected} blockedReason={replyBlockedReason} onReply={replyToSelection} />
      )}
    </div>
  );
}
