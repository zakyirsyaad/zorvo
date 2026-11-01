import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Plus, CornerDownLeft, Shield, ShieldAlert, Sparkles, Gauge, SlidersHorizontal, Square, Bot } from "lucide-react";
import { IconButton } from "./ui/IconButton";
import { OptionDropdown } from "./composer/OptionDropdown";
import { AgentMultiPicker, type AgentMultiPickerProps } from "./composer/AgentMultiPicker";
import { FolderPicker, type FolderControl } from "./composer/FolderPicker";
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
import type { ContextUsage, SlashCommand } from "../types";

const MAX_PROMPT_HEIGHT_PX = 180;
const PLACEHOLDER = "Prompt the agent...";
const PLACEHOLDER_WITH_COMMANDS = "Type / for commands, or prompt the agent...";

/** Keys that only move the caret; the menu's own keys (Escape, Enter, up and down) are not among them. */
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/** An agent's extra option is open under its config id: `option:fast`. */
type OpenDropdown = "folder" | "agent" | "permission" | "model" | "effort" | `option:${string}` | null;

/** What other parts of the window can do to the composer. */
export interface ComposerHandle {
  /** Adds paths to the prompt (quoted when needed) and focuses it. */
  insertPaths: (paths: readonly string[]) => void;
  /** Puts a message in the prompt in place of what is there (a rewound message, to edit and send again). */
  restore: (text: string, attachments?: readonly string[]) => void;
  /**
   * Returns a message that did not reach the agent, so it need not be typed again. Anything typed or
   * attached meanwhile stays, after the returned message.
   */
  giveBack: (text: string, attachments?: readonly string[]) => void;
  /**
   * True while the prompt and attachments are exactly what the last `restore` left: nothing typed, sent or
   * cleared since. With `message`, only when that is this message: one composer serves every session.
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
  /** Opens a file picker and resolves with the chosen paths; hidden when absent. */
  onAttach?: () => Promise<string[]>;
  handleRef?: Ref<ComposerHandle>;
  /** The agent's slash commands; typing `/` lists them. */
  commands?: SlashCommand[];
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
  /** Before a new session starts: the folder it starts in. */
  folder?: FolderControl;
  /** Before a new session starts: the agent it runs. */
  agent?: ComposerControl;
  /** Before a new session starts, in a git repository: the agent chip with a checkbox to tick several; replaces `agent`. */
  agents?: Omit<AgentMultiPickerProps, "isOpen" | "onToggle">;
  /** The workspace whose files `@` lists; mentions are off when absent. */
  mentions?: MentionSource;
}

export function ComposerDock({
  controls = {},
  isThinking = false,
  onStop,
  placeholder,
  disabled = false,
  sendDisabled = false,
  onSendMessage,
  onAttach,
  handleRef,
  commands = [],
  attachAsFiles = false,
  contextUsage,
  note,
  folder,
  agent,
  agents,
  mentions,
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

  useDismiss(containerRef, openDropdown !== null, () => setOpenDropdown(null));

  const toggle = (name: Exclude<OpenDropdown, null>) =>
    setOpenDropdown((current) => (current === name ? null : name));
  const dropdownProps = (name: Exclude<OpenDropdown, null>, control: ComposerControl) => ({
    options: control.options,
    selected: control.selected,
    isOpen: openDropdown === name,
    onToggle: () => toggle(name),
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
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, MAX_PROMPT_HEIGHT_PX)}px`;
  };

  const insertPaths = (paths: readonly string[]) => {
    if (attachAsFiles) setAttachments((current) => withAttachments(current, paths));
    else setText((current) => appendAttachments(current, paths));
    textareaRef.current?.focus();
  };

  useImperativeHandle(handleRef, () => ({
    insertPaths,
    restore: (restoredText, restoredAttachments = []) => {
      setText(restoredText);
      mentionMenu.close();
      if (attachAsFiles) setAttachments([...restoredAttachments]);
      restoredRef.current = { text: restoredText, attachments: attachAsFiles ? [...restoredAttachments] : attachments };
      textareaRef.current?.focus();
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

  return (
    <footer ref={containerRef} className="w-full max-w-3xl flex flex-col items-center px-4 select-none">
      <div
        className="relative w-full rounded-xl border border-border bg-surface-2 p-3 shadow-popover transition-all focus-within:border-border-strong"
      >
        {attachments.length > 0 && (
          <div className="mb-2">
            <AttachmentChips
              paths={attachments}
              onRemove={(path) => setAttachments((current) => current.filter((p) => p !== path))}
            />
          </div>
        )}
        {mentionMenu.files.length > 0 ? (
          <MentionMenu files={mentionMenu.files} highlighted={highlighted} onPick={pickFile} />
        ) : (
          menuCommands.length > 0 && (
            <SlashCommandMenu commands={menuCommands} highlighted={highlighted} onPick={pickCommand} />
          )
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleTextChange}
          onKeyUp={(e) => {
            if (CARET_KEYS.has(e.key)) followCaret(e.currentTarget);
          }}
          onClick={(e) => followCaret(e.currentTarget)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? (commands.length > 0 ? PLACEHOLDER_WITH_COMMANDS : PLACEHOLDER)}
          aria-label="Prompt"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full bg-transparent text-sm text-fg-secondary placeholder-fg-subtle outline-none resize-none leading-relaxed min-h-[26px] max-h-[180px]"
        />

        {shownNote && (
          <p id={noteId} className="mt-1 text-[11px] text-fg-subtle">
            {shownNote}
          </p>
        )}

        {/* Wraps instead of overflowing: a draft can show folder, agent, mode, model and effort at once. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border pt-2 text-xs">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {onAttach && (
              <IconButton
                label="Add attachment"
                title="Attach files"
                onClick={() => void handleAttach()}
                disabled={disabled}
              >
                <Plus size={15} />
              </IconButton>
            )}

            {folder && (
              <FolderPicker {...folder} isOpen={openDropdown === "folder"} onToggle={() => toggle("folder")} />
            )}

            {agents && (
              <AgentMultiPicker
                {...agents}
                isOpen={openDropdown === "agent"}
                onToggle={() => toggle("agent")}
                onPick={(agentId) => {
                  agents.onPick(agentId);
                  setOpenDropdown(null);
                }}
              />
            )}

            {!agents && agent && (
              <OptionDropdown
                label="Agent"
                align="left"
                icon={<Bot size={12} className="text-fg-muted" />}
                {...dropdownProps("agent", agent)}
              />
            )}

            {permission && (
              <OptionDropdown
                label="Permission mode"
                align="left"
                icon={
                  isRiskyPermission ? (
                    <ShieldAlert size={13} className="text-danger" data-testid="risky-permission-icon" />
                  ) : (
                    <Shield size={13} className="text-status-running" />
                  )
                }
                {...dropdownProps("permission", permission)}
              />
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {contextUsage && <ContextMeter {...contextUsage} />}

            {model && (
              <OptionDropdown
                label="Model"
                icon={<Sparkles size={12} className="text-fg-muted" />}
                {...dropdownProps("model", model)}
              />
            )}

            {effort && (
              <OptionDropdown
                label="Effort"
                icon={<Gauge size={12} className="text-fg-muted" />}
                {...dropdownProps("effort", effort)}
              />
            )}

            {extras.map((extra) => (
              <OptionDropdown
                key={extra.id}
                label={extra.label}
                description={extra.description}
                showLabel
                icon={<SlidersHorizontal size={12} className="text-fg-muted" />}
                {...dropdownProps(`option:${extra.id}`, extra)}
              />
            ))}

            {isThinking && onStop ? (
              <IconButton
                variant="primary"
                label="Stop agent"
                title="Stop the agent's current turn"
                onClick={onStop}
              >
                <Square size={12} fill="currentColor" />
              </IconButton>
            ) : (
              <IconButton
                variant="primary"
                label="Send message"
                aria-describedby={sendDisabled && note ? noteId : undefined}
                onClick={handleSend}
                disabled={(!text.trim() && attachments.length === 0) || !canSend}
              >
                <CornerDownLeft size={14} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
