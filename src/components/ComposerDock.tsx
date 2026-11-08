import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowUp, Paperclip, ShieldAlert, Square } from "lucide-react";
import { DRAFT_CHIP } from "./composer/chip-style";
import { CompareModelStatus } from "./composer/CompareModelStatus";
import type { CompareModelControl } from "../lib/compare-models";
import { AgentLogo } from "./AgentLogo";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { OptionDropdown } from "./composer/OptionDropdown";
import { MoreControls } from "./composer/MoreControls";
import { splitControls } from "../lib/composer-overflow";
import type { AgentMultiPickerProps } from "./composer/AgentMultiPicker";
import type { FolderControl } from "./composer/FolderPicker";
import { DraftChips } from "./composer/DraftChips";
import { appendAttachments, formatAttachmentPath, withAttachments } from "../lib/attachments";
import { joinWorkspacePath } from "../lib/files";
import { MentionMenu, isPickableAgent, type MentionAgent } from "./composer/MentionMenu";
import { useMentionMenu, type MentionSource } from "./composer/useMentionMenu";
import { delegationMentionOf } from "../lib/delegation";
import { AttachmentChips } from "./composer/AttachmentChips";
import { ContextMeter } from "./composer/ContextMeter";
import { isRiskyMode, type ComposerControl, type ComposerControls } from "../lib/composer-controls";
import { matchingCommands, pendingHint, slashQuery } from "../lib/slash-commands";
import { SlashCommandMenu } from "./composer/SlashCommandMenu";
import { useDismiss } from "../hooks/useDismiss";
import { useLatest } from "../hooks/useLatest";
import type { ContextUsage, SlashCommand } from "../types";

const MAX_PROMPT_HEIGHT_PX = 180;
/** What an empty composer says when the parent gives no placeholder: a running session or a popout. */
const replyPlaceholder = (agentName: string | undefined) => `Reply to ${agentName ?? "the agent"}`;

/** The skeletons' widths while a draft's chips load: about a model's, a mode's and an effort's. */
const SKELETON_CHIP_WIDTHS = ["w-18", "w-24", "w-14"] as const;

/** Keys that only move the caret; the menu's own keys (Escape, Enter, up and down) are not among them. */
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/** An agent's extra option is open under its config id: `option:fast`. */
type OpenDropdown =
  | "folder"
  | "branch"
  | "agent"
  | "permission"
  | "model"
  | "effort"
  | "more"
  | `option:${string}`
  // A compare draft's model chip, by agent.
  | `model:${string}`
  | null;

/** The one choice a compare chip shows before its agent's models are known. */
const DEFAULT_MODEL_OPTIONS = [{ value: undefined, label: "Default" }];

/** One of the agent's controls: a chip in the row, or a group in the ⋯ menu when it does not fit. */
interface ControlEntry {
  id: "model" | "permission" | "effort" | `option:${string}`;
  label: string;
  control: ComposerControl;
  /** After the value on the chip: a risky mode's shield. */
  trailing?: ReactNode;
  description?: string;
  showLabel?: boolean;
  /** A visible heading over the open menu: the mode menu reads "Mode". */
  heading?: string;
}

/** A folder's own name, the last part of its path: "/w/agent-desktop/" gives "agent-desktop". */
function folderNameOf(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

/**
 * Grows the prompt to its text. It is measured at `height: auto`, and in a column that scrolls (a draft in a short
 * window) that brief shrink lets the browser clamp the column's scroll position; setting the height back does not
 * undo it, so each edit would carry Send out of view. The scrolled ancestors' offsets are put back.
 */
function fitToText(field: HTMLTextAreaElement) {
  const scrolled: [HTMLElement, number][] = [];
  for (let node = field.parentElement; node; node = node.parentElement) {
    if (node.scrollTop > 0) scrolled.push([node, node.scrollTop]);
  }
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, MAX_PROMPT_HEIGHT_PX)}px`;
  for (const [node, top] of scrolled) node.scrollTop = top;
}

/** What other parts of the window can do to the composer. */
export interface ComposerHandle {
  /** Adds paths to the prompt (quoted when needed) and focuses it. */
  insertPaths: (paths: readonly string[]) => void;
  /** Adds text after what is there, past a blank line, grows the box to fit, and focuses it. */
  insertText: (text: string) => void;
  /** Puts a message in the prompt in place of what is there (a rewound message, to edit and send again). */
  restore: (text: string, attachments?: readonly string[]) => void;
  /**
   * Returns a message that did not reach the agent, so it need not be typed again. Anything typed or
   * attached meanwhile stays, after the returned message.
   */
  giveBack: (text: string, attachments?: readonly string[]) => void;
  /**
   * True while the prompt and attachments are exactly what the last `restore` or `giveBack` left: nothing typed,
   * sent or cleared since. With `message`, only when that is this message: one composer serves every session.
   */
  holdsRestored: (message?: { text: string; attachments?: readonly string[] }) => boolean;
  /** Empties the prompt and its attachments. */
  clear: () => void;
  /** Puts the cursor in the prompt. */
  focus: () => void;
}

export interface ComposerDockProps {
  /** Dropdowns to show; each is omitted when the agent offers no real choice. */
  controls?: ComposerControls;
  /** True while the agent is working on a turn. */
  isThinking?: boolean;
  /** Interrupts the agent's current turn; shown in place of Send while it works. */
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** True when only sending must wait (e.g. for the agent's install): the prompt can still be written. */
  sendDisabled?: boolean;
  /** `attachments` are file paths, given only when `attachAsFiles` is set. */
  onSendMessage: (message: string, attachments?: string[]) => void;
  /** Words the Send button ("Start 2 sessions") in place of its icon; it sends and is blocked the same way. */
  sendLabel?: string;
  /** Opens a file picker and resolves with the chosen paths; hidden when absent. */
  onAttach?: () => Promise<string[]>;
  handleRef?: Ref<ComposerHandle>;
  /** The agent's slash commands; typing `/` lists them. */
  commands?: SlashCommand[];
  /** The agent's name, for the header of its `/` commands. */
  agentName?: string;
  /**
   * True when the agent takes files with the message (ACP): attached files
   * show as chips and are sent apart from the text. Otherwise their paths
   * are typed into the prompt.
   */
  attachAsFiles?: boolean;
  /** How much of the agent's context window is used; the meter shows once the agent reports it. */
  contextUsage?: ContextUsage;
  /**
   * A short line under the prompt, e.g. why Send is blocked; a slash command's hint wins, except while
   * `sendDisabled`: then the note says why and the Send button points to it.
   */
  note?: string;
  /** The note sits in the control row, after attach, as the canvas draws a compare run's note; else under the prompt. */
  noteInRow?: boolean;
  /** A draft is asking its agent what it offers: its chips show as skeletons in the row until they arrive. */
  isLoadingControls?: boolean;
  /**
   * A draft's slot between its chips and its card, for the panels that hold it back, so they read in order under
   * the chips. The parent portals each panel into its own place: install above sign-in, whichever showed first
   * (two portals into one node would keep the order they mounted in). The slot takes no room while both are empty.
   */
  aboveCardSlots?: { install: Ref<HTMLDivElement>; signIn: Ref<HTMLDivElement> };
  /** Before a new session starts: the folder it starts in. */
  folder?: FolderControl;
  /** Before a new session starts: the agent it runs. */
  agent?: ComposerControl;
  /** Before a new session starts, in a git repository: the agent chip with a checkbox to tick several; replaces `agent`. */
  agents?: Omit<AgentMultiPickerProps, "isOpen" | "onToggle" | "onClose">;
  /** A running session's agent, named first in the row; drafts name theirs with the `agent`/`agents` chip. */
  sessionAgent?: { profileId: string; name: string };
  /** In a compare draft: one model chip per ticked agent, in the run's order. */
  compareModels?: CompareModelControl[];
  /** A compare chip whose agent's models are unknown was opened (or its Try again pressed): ask that agent. */
  onOpenCompareModel?: (profileId: string) => void;
  /** The workspace whose files `@` lists; mentions are off when absent. */
  mentions?: MentionSource;
  /**
   * The agents an `@` at the very start of the message can delegate to; absent turns the group off
   * (drafts, delegated sessions, popouts and compare runs).
   */
  delegationAgents?: readonly MentionAgent[];
  /** The delegation the text asks for, after every change; null when it asks for none. Send clears it. */
  onDelegationMentionChange?: (mention: { agentId: string; task: string } | null) => void;
  /** What the named agent starts on, in the note's place, with Change; a blocking note wins while one is set. */
  delegationSummary?: { text: string; onChange: () => void };
  /**
   * The prompt's text, after every change and once on mount: `clear`, `restore` and Send too, since the
   * parent does not redraw on typing. A mount reports empty, because a composer that went away took its text along.
   */
  onTextChange?: (text: string) => void;
  /** Every time `restore` runs, even with the text already there. */
  onRestored?: (text: string) => void;
  /** Every time `giveBack` runs, with the message returned, not the text it joined. */
  onGivenBack?: (returnedText: string) => void;
}

export function ComposerDock({
  controls = {},
  isThinking = false,
  onStop,
  placeholder,
  disabled = false,
  sendDisabled = false,
  sendLabel,
  onSendMessage,
  onAttach,
  handleRef,
  commands = [],
  agentName,
  attachAsFiles = false,
  contextUsage,
  note,
  noteInRow = false,
  isLoadingControls = false,
  aboveCardSlots,
  folder,
  agent,
  agents,
  sessionAgent,
  compareModels,
  onOpenCompareModel,
  mentions,
  delegationAgents,
  onDelegationMentionChange,
  delegationSummary,
  onTextChange,
  onRestored,
  onGivenBack,
}: ComposerDockProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [isMenuDismissed, setIsMenuDismissed] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<OpenDropdown>(null);
  const containerRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // What the last restore left in the composer, until the user sends or clears it.
  const restoredRef = useRef<{ text: string; attachments: readonly string[] } | null>(null);
  // Set by `insertText`: the box can only be measured once the text is in it.
  const shouldFitRef = useRef(false);
  // Set by a pick: where the caret goes once the new text is in the box.
  const pendingCaretRef = useRef<number | null>(null);
  // The delegation the last report gave, so an unchanged parse is not reported again.
  const lastDelegationKeyRef = useRef("");
  const onTextChangeRef = useLatest(onTextChange);
  const onDelegationMentionChangeRef = useLatest(onDelegationMentionChange);

  useDismiss(containerRef, openDropdown !== null, () => setOpenDropdown(null));

  useLayoutEffect(() => {
    if (!shouldFitRef.current || !textareaRef.current) return;
    shouldFitRef.current = false;
    fitToText(textareaRef.current);
  }, [text]);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null || !textareaRef.current) return;
    pendingCaretRef.current = null;
    textareaRef.current.setSelectionRange(caret, caret);
    textareaRef.current.focus();
  }, [text]);

  useEffect(() => {
    onTextChangeRef.current?.(text);
  }, [text, onTextChangeRef]);

  const toggle = (name: Exclude<OpenDropdown, null>) =>
    setOpenDropdown((current) => (current === name ? null : name));
  const dropdownProps = (name: Exclude<OpenDropdown, null>, control: ComposerControl) => ({
    options: control.options,
    selected: control.selected,
    isOpen: openDropdown === name,
    onToggle: () => toggle(name),
    // A close, not a toggle: this composer's own dismiss runs on the same click or Escape.
    onClose: () => setOpenDropdown((current) => (current === name ? null : current)),
    onSelect: (value: string | undefined) => {
      control.onChange(value);
      setOpenDropdown(null);
    },
  });

  // While the agent works, Stop takes Send's place; the draft waits for the turn to end.
  const canSend = !disabled && !sendDisabled && !(isThinking && onStop);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || !canSend) return;
    if (attachAsFiles) onSendMessage(trimmed, attachments);
    else onSendMessage(trimmed);
    restoredRef.current = null;
    setText("");
    setAttachments([]);
    setOpenDropdown(null);
    mentionMenu.close();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const mentionMenu = useMentionMenu(mentions, delegationAgents);
  // Reports the delegation as the text changes; an unchanged parse stays unreported.
  useEffect(() => {
    const mention = delegationAgents ? delegationMentionOf(text, delegationAgents) : null;
    const key = mention ? `${mention.agentId}\u0000${mention.task}` : "";
    if (key === lastDelegationKeyRef.current) return;
    lastDelegationKeyRef.current = key;
    onDelegationMentionChangeRef.current?.(mention);
  }, [text, delegationAgents, onDelegationMentionChangeRef]);
  /** The @-mention list follows the caret: moving it off the @word closes the list. */
  const followCaret = (field: HTMLTextAreaElement) =>
    mentionMenu.update(field.value, field.selectionStart ?? field.value.length);
  const query = slashQuery(text);
  const menuCommands = query === null || isMenuDismissed ? [] : matchingCommands(commands, query);

  /** Replaces the @word with the file: a chip for an agent that takes files, its path otherwise. */
  const pickFile = (relativePath: string) => {
    const { mention } = mentionMenu;
    if (!mention || !mentions) return;
    const path = joinWorkspacePath(mentions.root, relativePath);
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.end);
    if (attachAsFiles) {
      setText(before + after.replace(/^ /, ""));
      setAttachments((current) => withAttachments(current, [path]));
    } else {
      setText(`${before}${formatAttachmentPath(path)} ${after.replace(/^ /, "")}`);
    }
    mentionMenu.close();
    textareaRef.current?.focus();
  };

  /** Replaces the @word with `@Agent name ` and puts the caret after the space. */
  const pickAgent = (agent: MentionAgent) => {
    const { mention } = mentionMenu;
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.end).replace(/^ /, "");
    const next = `${before}@${agent.name} ${after}`;
    const caret = before.length + agent.name.length + 2;
    pendingCaretRef.current = caret;
    setText(next);
    mentionMenu.close();
    if (next === text) {
      // React keeps the text, so the change effect does not run: put the caret where the pick asked now.
      pendingCaretRef.current = null;
      textareaRef.current?.setSelectionRange(caret, caret);
    }
    textareaRef.current?.focus();
  };

  // One keyboard list: the pickable agents first, then the files; the command list only when no @word is open.
  const pickableMentionAgents = mentionMenu.agents.filter(isPickableAgent);
  const pickMention = (index: number) => {
    const agent = pickableMentionAgents[index];
    if (agent !== undefined) {
      pickAgent(agent);
      return;
    }
    const path = mentionMenu.files[index - pickableMentionAgents.length];
    if (path !== undefined) pickFile(path);
  };
  const mentionCount = pickableMentionAgents.length + mentionMenu.files.length;
  // A visible list of only unpickable agents still takes the keys: Return must not send past it.
  const hasMentionList = mentionMenu.agents.length > 0 || mentionMenu.files.length > 0;
  const openMenu =
    hasMentionList
      ? { count: mentionCount, pick: pickMention, dismiss: mentionMenu.close }
      : menuCommands.length > 0
        ? { count: menuCommands.length, pick: (i: number) => pickCommand(menuCommands[i]), dismiss: () => setIsMenuDismissed(true) }
        : null;
  const hint = pendingHint(commands, text);
  // The reason a blocked Send gives outranks a slash command's hint.
  const shownNote = sendDisabled && note ? note : (hint ?? note);
  const noteId = useId();
  // A blocked Send points at the note that says why.
  const sendBlockedNoteId = sendDisabled && note ? noteId : undefined;
  const isSendEmpty = !text.trim() && attachments.length === 0;

  const pickCommand = (command: SlashCommand) => {
    setText(`/${command.name} `);
    mentionMenu.close();
    textareaRef.current?.focus();
  };

  /** Arrow keys, Enter/Tab and Escape drive the open menu (agents and files, or commands). */
  const handleMenuKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!openMenu) return false;
    const last = openMenu.count - 1;
    if (e.key === "ArrowDown") setHighlighted((i) => (last < 0 || i >= last ? 0 : i + 1));
    else if (e.key === "ArrowUp") setHighlighted((i) => (last < 0 || i <= 0 ? Math.max(last, 0) : i - 1));
    else if (e.key === "Enter" || e.key === "Tab") {
      // Nothing can be picked: the list stays open and Return does not send the message past it.
      if (last < 0) {
        e.preventDefault();
        return true;
      }
      openMenu.pick(Math.min(highlighted, last));
    } else if (e.key === "Escape") openMenu.dismiss();
    else return false;
    e.preventDefault();
    return true;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleMenuKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setHighlighted(0);
    setIsMenuDismissed(false);
    mentionMenu.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
    fitToText(e.target);
  };

  const insertPaths = (paths: readonly string[]) => {
    if (attachAsFiles) setAttachments((current) => withAttachments(current, paths));
    else setText((current) => appendAttachments(current, paths));
    textareaRef.current?.focus();
  };

  useImperativeHandle(handleRef, () => ({
    insertPaths,
    insertText: (inserted) => {
      shouldFitRef.current = true;
      setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${inserted}` : inserted));
      mentionMenu.close();
      textareaRef.current?.focus();
    },
    restore: (restoredText, restoredAttachments = []) => {
      setText(restoredText);
      mentionMenu.close();
      if (attachAsFiles) setAttachments([...restoredAttachments]);
      restoredRef.current = { text: restoredText, attachments: attachAsFiles ? [...restoredAttachments] : attachments };
      textareaRef.current?.focus();
      onRestored?.(restoredText);
    },
    giveBack: (returnedText, returnedAttachments = []) => {
      // What the user typed since stays, after the returned message: a failed send never wipes a new draft.
      const isTyped = text.trim() !== "" && text !== returnedText;
      // A message of files only has no text to put the draft after.
      const nextText = !isTyped ? returnedText : returnedText === "" ? text : `${returnedText}\n\n${text}`;
      const nextAttachments = attachAsFiles ? withAttachments(returnedAttachments, attachments) : attachments;
      setText(nextText);
      mentionMenu.close();
      if (attachAsFiles) setAttachments(nextAttachments);
      restoredRef.current = { text: nextText, attachments: nextAttachments };
      textareaRef.current?.focus();
      onGivenBack?.(returnedText);
    },
    holdsRestored: (message) => {
      const restored = restoredRef.current;
      const holds = (expected: readonly string[]) =>
        expected.length === attachments.length && expected.every((path, index) => path === attachments[index]);
      return (
        restored !== null &&
        restored.text === text &&
        holds(restored.attachments) &&
        (message === undefined || (message.text === text && holds(message.attachments ?? [])))
      );
    },
    clear: () => {
      restoredRef.current = null;
      setText("");
      setAttachments([]);
      mentionMenu.close();
    },
    focus: () => textareaRef.current?.focus(),
  }));

  const handleAttach = async () => {
    if (!onAttach) return;
    insertPaths(await onAttach());
  };

  const { permission, model, effort, extras = [] } = controls;
  const selectedPermission = permission?.options.find((o) => o.value === permission.selected);
  const isRiskyPermission = selectedPermission?.risky ?? isRiskyMode(permission?.selected);
  // The agent's controls in the row's order; those past the first few go into the ⋯ menu.
  // The canvas draws the chips without leading icons; only a risky mode keeps a mark, after its name.
  const agentControls: ControlEntry[] = [
    ...(model ? [{ id: "model", label: "Model", control: model } as const] : []),
    ...(permission
      ? [
          {
            id: "permission",
            label: "Permission mode",
            heading: "Mode",
            control: permission,
            trailing: isRiskyPermission ? (
              <ShieldAlert size={12} aria-hidden="true" className="shrink-0 text-status-attention" data-testid="risky-permission-icon" />
            ) : undefined,
          } as const,
        ]
      : []),
    ...(effort ? [{ id: "effort", label: "Effort", control: effort } as const] : []),
    ...extras.map(
      (extra): ControlEntry => ({
        id: `option:${extra.id}`,
        label: extra.label,
        control: extra,
        description: extra.description,
        showLabel: true,
      }),
    ),
  ];
  const { inline: inlineControls, overflow: overflowControls } = splitControls(agentControls);
  const isShowingSkeletons = Boolean(isLoadingControls) && agentControls.length === 0;
  // A draft's composer sits near the top of its column with room below; a session's sits at the window's bottom.
  const isDraft = Boolean(folder || agent || agents);
  const menuSide = isDraft ? "bottom" : "top";

  return (
    <footer ref={containerRef} className="w-full max-w-chat flex flex-col items-center select-none">
      {(folder || agents || agent) && (
        <DraftChips
          folder={folder}
          agents={agents}
          agentChip={
            !agents && agent ? (
              <OptionDropdown
                label="Agent"
                align="left"
                chipClassName={DRAFT_CHIP}
                side="bottom"
                icon={<AgentLogo profileId={agent.selected ?? ""} name="" size={16} />}
                renderIcon={(option) => <AgentLogo profileId={option.value ?? ""} name="" size={16} />}
                {...dropdownProps("agent", agent)}
              />
            ) : undefined
          }
          isOpen={(name) => openDropdown === name}
          onToggle={toggle}
          onClose={(name) => setOpenDropdown((current) => (current === name ? null : current))}
        />
      )}
      {aboveCardSlots && (
        // Hidden while neither place holds a panel; `empty:` no longer applies, since the two places are always there.
        <div data-above-card="" className="mb-3 flex w-full flex-col gap-3 [&:not(:has(>:not(:empty)))]:hidden">
          <div ref={aboveCardSlots.install} data-slot="install" className="empty:hidden" />
          <div ref={aboveCardSlots.signIn} data-slot="sign-in" className="empty:hidden" />
        </div>
      )}
      <div
        data-composer-card=""
        className="relative flex w-full flex-col gap-2.5 rounded-xl border border-border bg-surface-2 p-3 shadow-popover transition-all focus-within:border-border-strong"
      >
        {attachments.length > 0 && (
          <AttachmentChips
            paths={attachments}
            onRemove={(path) => setAttachments((current) => current.filter((p) => p !== path))}
          />
        )}
        {mentionMenu.agents.length > 0 || mentionMenu.files.length > 0 ? (
          <MentionMenu
            files={mentionMenu.files}
            agents={mentionMenu.agents}
            highlighted={highlighted}
            onPick={pickFile}
            onPickAgent={pickAgent}
            folderName={folderNameOf(mentions?.root ?? "")}
            query={mentionMenu.mention?.query ?? ""}
            side={menuSide}
          />
        ) : (
          menuCommands.length > 0 && (
            <SlashCommandMenu
              commands={menuCommands}
              highlighted={highlighted}
              onPick={pickCommand}
              agentName={agentName}
              side={menuSide}
            />
          )
        )}
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          onChange={handleTextChange}
          onKeyUp={(e) => {
            if (CARET_KEYS.has(e.key)) followCaret(e.currentTarget);
          }}
          onClick={(e) => followCaret(e.currentTarget)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? replyPlaceholder(agentName)}
          aria-label="Prompt"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          // Two lines tall to start (44px), as the canvas draws it, growing with the text.
          className="w-full resize-none bg-transparent px-1 text-body text-fg placeholder-fg-subtle outline-none min-h-11 max-h-[180px]"
        />

        {shownNote && !noteInRow && (
          <p id={noteId} className="text-caption text-fg-muted">
            {shownNote}
          </p>
        )}

        {!shownNote && !noteInRow && delegationSummary && (
          <p className="text-caption text-fg-muted">
            <span>{delegationSummary.text}</span>{" "}
            <button
              type="button"
              onClick={delegationSummary.onChange}
              className="rounded-sm text-fg-secondary underline underline-offset-2 focus-ring"
            >
              Change
            </button>
          </p>
        )}

        {/* Wraps instead of overflowing: a draft can show folder, agent, mode, model and effort at once. */}
        <div data-composer-row="" className="flex flex-wrap items-center gap-1 text-ui-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {onAttach && (
              <IconButton
                label="Add attachment"
                title="Attach files"
                onClick={() => void handleAttach()}
                disabled={disabled}
              >
                <Paperclip size={14} />
              </IconButton>
            )}

            {sessionAgent && !agent && !agents && (
              // A running session's agent, named first: a label, since a session cannot change its agent.
              <span data-agent-chip="" className="inline-flex h-7 min-w-0 items-center gap-1.5 px-2 text-ui-sm text-fg-secondary">
                <AgentLogo profileId={sessionAgent.profileId} name="" size={16} />
                <span className="truncate">{sessionAgent.name}</span>
              </span>
            )}

            {/* Always mounted: a live region inserted with its text is often not read out. A probe while the
                chips are already there (a sign-in re-check) loads nothing the user waits for, so it stays empty. */}
            <span role="status" className="sr-only">
              {isShowingSkeletons ? `Loading ${agentName ?? "the agent"}'s models and commands…` : ""}
            </span>
            {/* Where the agent's chips will land, so nothing moves when they arrive. */}
            {isShowingSkeletons &&
              SKELETON_CHIP_WIDTHS.map((width) => (
                <span
                  key={width}
                  data-skeleton-chip=""
                  aria-hidden="true"
                  className={`h-7 ${width} rounded-md bg-surface-hover motion-safe:animate-pulse`}
                />
              ))}

            {compareModels?.map((entry) => {
              const key = `model:${entry.profileId}` as const;
              const shared = {
                label: `${entry.name} model`,
                align: "left" as const,
                side: "bottom" as const,
                icon: <AgentLogo profileId={entry.profileId} name="" size={16} />,
              };
              if (entry.state === "known" && entry.control) {
                return <OptionDropdown key={key} {...shared} {...dropdownProps(key, entry.control)} />;
              }
              // Its models are not known yet: opening it asks the agent, and the menu says so meanwhile.
              const ask = () => onOpenCompareModel?.(entry.profileId);
              return (
                <OptionDropdown
                  key={key}
                  {...shared}
                  options={DEFAULT_MODEL_OPTIONS}
                  selected={undefined}
                  isOpen={openDropdown === key}
                  onToggle={() => toggle(key)}
                  onClose={() => setOpenDropdown((current) => (current === key ? null : current))}
                  onSelect={() => setOpenDropdown(null)}
                  onOpen={ask}
                  // Not yet asked: the plain "Default" row, until the ask this opening starts shows its skeleton.
                  status={
                    entry.state === "unknown" ? undefined : <CompareModelStatus name={entry.name} state={entry.state} onRetry={ask} />
                  }
                />
              );
            })}

            {inlineControls.map((entry) => (
              <OptionDropdown
                key={entry.id}
                label={entry.label}
                align="left"
                trailing={entry.trailing}
                description={entry.description}
                showLabel={entry.showLabel}
                heading={entry.heading}
                side={menuSide}
                {...dropdownProps(entry.id, entry.control)}
              />
            ))}

            {overflowControls.length > 0 && (
              <MoreControls
                side={menuSide}
                controls={overflowControls}
                isOpen={openDropdown === "more"}
                onToggle={() => toggle("more")}
                onClose={() => setOpenDropdown((current) => (current === "more" ? null : current))}
                onPicked={() => setOpenDropdown(null)}
              />
            )}

            {shownNote && noteInRow && (
              <p id={noteId} className="pl-1 text-caption text-fg-subtle">
                {shownNote}
              </p>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {contextUsage && <ContextMeter {...contextUsage} />}

            {isThinking && onStop ? (
              <IconButton
                variant="outline"
                label="Stop agent"
                title="Stop the agent's current turn"
                onClick={onStop}
              >
                <Square size={11} />
              </IconButton>
            ) : sendLabel ? (
              <Button
                variant="primary"
                aria-describedby={sendBlockedNoteId}
                onClick={handleSend}
                disabled={isSendEmpty || !canSend}
              >
                {sendLabel}
                <ArrowUp size={12} aria-hidden="true" />
              </Button>
            ) : (
              <IconButton
                variant="primary"
                label="Send message"
                aria-describedby={sendBlockedNoteId}
                onClick={handleSend}
                disabled={isSendEmpty || !canSend}
              >
                <ArrowUp size={14} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
