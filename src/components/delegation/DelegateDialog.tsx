import { useEffect, useId, useRef, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { AcpChoices } from "../../lib/acp-draft";
import { isRiskyMode, type ComposerControl, type ComposerControls } from "../../lib/composer-controls";
import type { AgentProfile } from "../../types";
import { AgentLogo } from "../AgentLogo";
import { CompareModelStatus } from "../composer/CompareModelStatus";
import { OptionDropdown } from "../composer/OptionDropdown";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

/** Why an agent can or cannot start a delegation, as the dialog's rows word it. */
export type DelegateAgentStatus = "ready" | "not-checked" | "needs-sign-in" | "not-installed";

/** One agent the dialog offers: its profile and what is known of it. */
export interface DelegateAgentChoice {
  profile: AgentProfile;
  status: DelegateAgentStatus;
}

/** What the picked agent's chips are made from, as a draft of that agent makes its own. */
export interface DraftControls {
  /** The picked agent's plain name, for the "starts on" label. */
  agentName: string;
  /** `acpControls` over the agent's reported options; undefined when none are known. */
  controls?: ComposerControls;
  /**
   * Where the agent's permission mode lives: its `modes` list, or a `mode` config
   * option. A config pick travels through the control's `onChange` (and so the
   * caller's accumulator), never as a `modeId`.
   */
  modeKind?: "modes" | "config";
  /** Called when a chip's menu opens: asks an unknown agent for its options (never on mount). */
  onOpen?: () => void;
  /** What the chip's menu shows while asking, or after a failed ask. */
  status?: "asking" | "failed";
}

export interface DelegateDialogProps {
  /** The agents in use that can start; `not-installed` cannot be picked. */
  agents: readonly DelegateAgentChoice[];
  /** A's agent, which the hint names and whose own agent the first pick skips. */
  sourceAgentName: string;
  /** A's agent is running: its reports reach it rather than waiting in its composer. */
  isSourceRunning: boolean;
  /** From Change: the agent picked when the dialog opens. */
  initialAgentId?: string;
  /** From Change: the task filled in when the dialog opens. */
  initialTask?: string;
  controlsFor: (agentId: string) => DraftControls;
  onDelegate: (agentId: string, task: string, choices: AcpChoices) => void;
  onCancel: () => void;
}

const STATUS_TEXT: Readonly<Record<DelegateAgentStatus, string>> = {
  ready: "Ready",
  "not-checked": "Not checked",
  "needs-sign-in": "Needs sign-in",
  "not-installed": "Not installed",
};

const STATUS_CLASS: Readonly<Record<DelegateAgentStatus, string>> = {
  ready: "text-fg-muted",
  "not-checked": "text-fg-subtle",
  "needs-sign-in": "text-status-attention",
  "not-installed": "text-fg-subtle",
};

function isPickable(agent: DelegateAgentChoice): boolean {
  return agent.status !== "not-installed";
}

/**
 * Whether the agent reported anything to show. `acpControls` returns an empty
 * object before an agent says its options, and that is still unknown: the
 * dialog shows one Default chip until a real control appears.
 */
function hasControls(controls: ComposerControls | undefined): controls is ComposerControls {
  return (
    controls !== undefined &&
    (controls.model !== undefined || controls.effort !== undefined || controls.permission !== undefined)
  );
}

/** The agent picked when the dialog opens: Change's, else the first pickable one other than A's. */
function initialAgentPick(
  agents: readonly DelegateAgentChoice[],
  sourceAgentName: string,
  initialAgentId: string | undefined,
): string | null {
  const requested = agents.find((agent) => agent.profile.id === initialAgentId && isPickable(agent));
  if (requested) return requested.profile.id;
  const other = agents.find((agent) => isPickable(agent) && agent.profile.name !== sourceAgentName);
  return (other ?? agents.find(isPickable))?.profile.id ?? null;
}

/** A chip's current value: the dialog's pick when it has one, else what the control reports. */
function selectedOf(
  picks: Readonly<Record<string, string | undefined>>,
  id: string,
  control: ComposerControl,
): string | undefined {
  return Object.hasOwn(picks, id) ? picks[id] : control.selected;
}

/**
 * The picks as a start's choices: the mode and model have their own keys. A
 * mode `modeId` is sent only for an agent whose modes are its own list, and
 * only when the user picked one: a config-mode agent's pick travels through
 * the control's `onChange` (the effort's config id is not named by
 * `ComposerControls` either), and its reported value sent as a `modeId` would
 * say a mode was picked, so `changesToApply` would skip the safe mode.
 */
function choicesOf(
  controls: ComposerControls | undefined,
  picks: Readonly<Record<string, string | undefined>>,
  modeKind: DraftControls["modeKind"],
): AcpChoices {
  const modeId =
    controls?.permission && modeKind === "modes" && Object.hasOwn(picks, "permission")
      ? selectedOf(picks, "permission", controls.permission)
      : undefined;
  const modelId = controls?.model ? selectedOf(picks, "model", controls.model) : undefined;
  return {
    ...(modeId !== undefined ? { modeId } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    config: {},
  };
}

/**
 * Picks the agent a task is delegated to, writes the task, and shows what that
 * agent starts on. Opening it starts no agent: an unknown agent is asked only
 * when its chip's menu opens.
 */
export function DelegateDialog({
  agents,
  sourceAgentName,
  isSourceRunning,
  initialAgentId,
  initialTask,
  controlsFor,
  onDelegate,
  onCancel,
}: DelegateDialogProps) {
  const titleId = useId();
  const statusIdPrefix = useId();
  const taskId = useId();
  const errorId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const [agentId, setAgentId] = useState<string | null>(() =>
    initialAgentPick(agents, sourceAgentName, initialAgentId),
  );
  const [task, setTask] = useState(initialTask ?? "");
  const [isTaskMissing, setIsTaskMissing] = useState(false);
  const [picks, setPicks] = useState<Readonly<Record<string, string | undefined>>>({});
  const [openChip, setOpenChip] = useState<string | null>(null);

  // Focus moves into the dialog when it opens; useFocusTrap gives it back on close.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An open chip's menu closes on the same keypress; only a second Escape discards the dialog.
      if (openChip !== null) {
        setOpenChip(null);
        return;
      }
      onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, openChip]);

  const picked = agents.find((agent) => agent.profile.id === agentId);
  const draft = picked ? controlsFor(picked.profile.id) : undefined;
  const agentName = draft?.agentName ?? picked?.profile.name ?? "The agent";

  const pickAgent = (id: string) => {
    setAgentId(id);
    // The picks belong to the agent they were made for.
    setPicks({});
    setOpenChip(null);
  };

  const handleSelect = (id: string, control: ComposerControl, value: string | undefined) => {
    setPicks((current) => ({ ...current, [id]: value }));
    control.onChange(value);
    setOpenChip(null);
  };

  const renderChip = (id: string, label: string, control: ComposerControl, heading?: string) => {
    const selected = selectedOf(picks, id, control);
    const current = control.options.find((option) => option.value === selected) ?? control.options[0];
    const isRisky =
      id === "permission" && (current?.risky ?? isRiskyMode(selected, current?.label));
    return (
      <OptionDropdown
        key={id}
        label={label}
        heading={heading}
        options={control.options}
        selected={selected}
        isOpen={openChip === id}
        onToggle={() => setOpenChip((open) => (open === id ? null : id))}
        onClose={() => setOpenChip((open) => (open === id ? null : open))}
        onOpen={draft?.onOpen}
        onSelect={(value) => handleSelect(id, control, value)}
        side="bottom"
        trailing={
          isRisky ? (
            <ShieldAlert
              data-testid="risky-permission-icon"
              size={12}
              aria-hidden="true"
              className="shrink-0 text-status-attention"
            />
          ) : undefined
        }
      />
    );
  };

  const controls = draft?.controls;
  const chips = hasControls(controls) ? (
    <>
      {controls.model && renderChip("model", "Model", controls.model)}
      {controls.effort && renderChip("effort", "Effort", controls.effort)}
      {controls.permission && renderChip("permission", "Permission mode", controls.permission, "Mode")}
    </>
  ) : (
    <OptionDropdown
      label="Starts on"
      options={[{ value: undefined, label: "Default" }]}
      selected={undefined}
      isOpen={openChip === "default"}
      onToggle={() => setOpenChip((open) => (open === "default" ? null : "default"))}
      onClose={() => setOpenChip((open) => (open === "default" ? null : open))}
      onSelect={() => setOpenChip(null)}
      onOpen={draft?.onOpen}
      side="bottom"
      status={
        draft?.status ? (
          <CompareModelStatus
            name={agentName}
            state={draft.status}
            onRetry={() => draft.onOpen?.()}
          />
        ) : undefined
      }
    />
  );

  const hint = `${agentName} reads this conversation first and works in the same folder. Each answer it gives is sent to ${sourceAgentName}.${
    isSourceRunning ? "" : ` ${sourceAgentName} isn't running, so its reports wait in its composer.`
  }`;

  const handleDelegate = () => {
    const trimmed = task.trim();
    if (trimmed === "") {
      setIsTaskMissing(true);
      return;
    }
    if (agentId === null) return;
    onDelegate(agentId, trimmed, choicesOf(controls, picks, draft?.modeKind));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface-1 p-5 text-fg-secondary shadow-dialog outline-none"
      >
        <div className="flex items-center gap-2.5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Delegate to another agent
          </h2>
          <IconButton label="Close" onClick={onCancel}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 p-0 text-ui font-medium text-fg">Agent</legend>
          {agents.map((agent) => {
            const statusId = `${statusIdPrefix}-${agent.profile.id}-status`;
            const canPick = isPickable(agent);
            const isPicked = agent.profile.id === agentId;
            return (
              <label
                key={agent.profile.id}
                className={`flex h-9 items-center gap-2.5 rounded-md px-2.5 ${
                  canPick ? "cursor-pointer" : "cursor-default opacity-55"
                } ${isPicked ? "bg-surface-hover" : canPick ? "hover:bg-surface-hover" : ""}`}
              >
                <span className="relative flex size-3.5 shrink-0 items-center justify-center">
                  <input
                    type="radio"
                    name={titleId}
                    checked={isPicked}
                    disabled={!canPick}
                    onChange={() => {
                      if (canPick) pickAgent(agent.profile.id);
                    }}
                    aria-describedby={canPick ? undefined : statusId}
                    className="peer size-3.5 appearance-none rounded-full border border-border-strong checked:border-fg focus-ring"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute size-1.5 rounded-full bg-fg opacity-0 peer-checked:opacity-100"
                  />
                </span>
                <AgentLogo profileId={agent.profile.id} name="" size={16} />
                <span className={isPicked ? "text-fg" : "text-fg-secondary"}>{agent.profile.name}</span>
                <span
                  id={statusId}
                  className={`ml-auto flex items-center gap-1.5 text-ui-sm ${STATUS_CLASS[agent.status]}`}
                >
                  {agent.status === "needs-sign-in" && (
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-status-attention" />
                  )}
                  {STATUS_TEXT[agent.status]}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={taskId} className="text-ui font-medium text-fg">
            Task
          </label>
          <textarea
            id={taskId}
            rows={3}
            value={task}
            onChange={(event) => {
              setTask(event.target.value);
              setIsTaskMissing(false);
            }}
            aria-describedby={isTaskMissing ? `${errorId} ${hintId}` : hintId}
            className="w-full resize-none rounded-lg border border-border-strong bg-surface-2 px-2.5 py-2 text-ui text-fg focus-ring"
          />
          {isTaskMissing && (
            <p id={errorId} className="text-caption text-danger">
              Write the task first.
            </p>
          )}
          <div className="mt-1 flex items-center gap-1">
            <span className="mr-1.5 text-ui font-medium text-fg">{agentName} starts on</span>
            {chips}
          </div>
          <p id={hintId} className="text-caption text-fg-subtle">
            {hint}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" tone="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleDelegate}>
            Delegate
          </Button>
        </div>
      </div>
    </div>
  );
}
