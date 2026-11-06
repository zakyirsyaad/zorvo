import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowUp, Paperclip, ShieldAlert, Square } from "lucide-react";
import { DRAFT_CHIP } from "./composer/chip-style";
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
import { MentionMenu } from "./composer/MentionMenu";
import { useMentionMenu, type MentionSource } from "./composer/useMentionMenu";
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

/** Keys that only move the caret; the menu's own keys (Escape, Enter, up and down) are not among them. */
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/** An agent's extra option is open under its config id: `option:fast`. */
type OpenDropdown = "folder" | "branch" | "agent" | "permission" | "model" | "effort" | "more" | `option:${string}` | null;

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

function fitToText(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, MAX_PROMPT_HEIGHT_PX)}px`;
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
   * A short status under the prompt, e.g. while the agent's options load; a slash command's hint wins,
   * except while `sendDisabled`: then the note says why and the Send button points to it.
   */
  note?: string;
  /** The note sits in the control row, after attach, as the canvas draws a compare run's note; else under the prompt. */
  noteInRow?: boolean;
  /** Before a new session starts: the folder it starts in. */
  folder?: FolderControl;
  /** Before a new session starts: the agent it runs. */
  agent?: ComposerControl;
  /** Before a new session starts, in a git repository: the agent chip with a checkbox to tick several; replaces `agent`. */
  agents?: Omit<AgentMultiPickerProps, "isOpen" | "onToggle" | "onClose">;
  /** A running session's agent, named first in the row; drafts name theirs with the `agent`/`agents` chip. */
  sessionAgent?: { profileId: string; name: string };
  /** The workspace whose files `@` lists; mentions are off when absent. */
  mentions?: MentionSource;
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
  folder,
  agent,
  agents,
  sessionAgent,
  mentions,
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
  const onTextChangeRef = useLatest(onTextChange);

  useDismiss(containerRef, openDropdown !== null, () => setOpenDropdown(null));

  useLayoutEffect(() => {
    if (!shouldFitRef.current || !textareaRef.current) return;
    shouldFitRef.current = false;
    fitToText(textareaRef.current);
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

  const mentionMenu = useMentionMenu(mentions);
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

  // The file list, when an @word is typed, takes the keys before the command list.
  const openMenu =
    mentionMenu.files.length > 0
      ? { count: mentionMenu.files.length, pick: (i: number) => pickFile(mentionMenu.files[i]), dismiss: mentionMenu.close }
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

  /** Arrow keys, Enter/Tab and Escape drive the open menu (files or commands). */
  const handleMenuKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!openMenu) return false;
    const last = openMenu.count - 1;
    if (e.key === "ArrowDown") setHighlighted((i) => (i >= last ? 0 : i + 1));
    else if (e.key === "ArrowUp") setHighlighted((i) => (i <= 0 ? last : i - 1));
    else if (e.key === "Enter" || e.key === "Tab") openMenu.pick(Math.min(highlighted, last));
    else if (e.key === "Escape") openMenu.dismiss();
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
                icon={<AgentLogo profileId={agent.selected ?? ""} name="" size={16} />}
                {...dropdownProps("agent", agent)}
              />
            ) : undefined
          }
          isOpen={(name) => openDropdown === name}
          onToggle={toggle}
          onClose={(name) => setOpenDropdown((current) => (current === name ? null : current))}
        />
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
        {mentionMenu.files.length > 0 ? (
          <MentionMenu
            files={mentionMenu.files}
            highlighted={highlighted}
            onPick={pickFile}
            folderName={folderNameOf(mentions?.root ?? "")}
            query={mentionMenu.mention?.query ?? ""}
          />
        ) : (
          menuCommands.length > 0 && (
            <SlashCommandMenu commands={menuCommands} highlighted={highlighted} onPick={pickCommand} agentName={agentName} />
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

            {inlineControls.map((entry) => (
              <OptionDropdown
                key={entry.id}
                label={entry.label}
                align="left"
                trailing={entry.trailing}
                description={entry.description}
                showLabel={entry.showLabel}
                heading={entry.heading}
                {...dropdownProps(entry.id, entry.control)}
              />
            ))}

            {overflowControls.length > 0 && (
              <MoreControls
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
