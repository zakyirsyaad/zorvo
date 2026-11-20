import { useId, type ReactNode } from "react";
import {
  AFTER_UPDATE_TEXT,
  BLOCKER_TEXT,
  COMPUTER_USE_COPY as COPY,
  RESTART_HINT_TEXT,
  announcementOf,
  blockerOf,
  type ComputerUseStatus,
  type PermissionPane,
  type PermissionState,
} from "../../lib/computer-use";
import { Button } from "../ui/Button";
import { StatusLine } from "../ui/StatusLine";
import { SettingsGroup, SettingsRow } from "./SettingsGroup";

export interface ComputerUseSettingProps {
  isOn: boolean;
  /** null until the backend has answered. */
  status: ComputerUseStatus | null;
  isChecking: boolean;
  /** The user turned the switch; turning it on also asks macOS for the permissions. */
  onChange: (isOn: boolean) => void;
  onCheck: () => void;
  onOpenPane: (pane: PermissionPane) => void;
  onAllowAgain: () => void;
  onRestart: () => void;
}

/** One permission: its name, whether macOS allows it for Zorvo, and the way to System Settings. */
function PermissionRow({
  name,
  state,
  pane,
  onOpenPane,
}: {
  name: string;
  state: PermissionState;
  pane: PermissionPane;
  onOpenPane: (pane: PermissionPane) => void;
}) {
  const isAllowed = state === "allowed";
  return (
    <SettingsRow
      label={name}
      description={
        <StatusLine status={isAllowed ? "ready" : "attention"}>{isAllowed ? COPY.allowed : COPY.notAllowed}</StatusLine>
      }
      control={
        !isAllowed && (
          <Button variant="outline" size="md" aria-label={`${COPY.openSettings} for ${name}`} onClick={() => onOpenPane(pane)}>
            {COPY.openSettings}
          </Button>
        )
      }
    />
  );
}

/** A sentence about what to do next, with its one action at the right. */
function MessageRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <SettingsRow label={<span className="text-ui-sm text-fg-secondary">{children}</span>} control={action} />;
}

/**
 * Whether agents may use apps on this Mac, and Zorvo's two macOS permissions for it. Zorvo asks
 * macOS only from this group: turning the switch on, or Allow again after an update.
 */
export function ComputerUseSetting({
  isOn,
  status,
  isChecking,
  onChange,
  onCheck,
  onOpenPane,
  onAllowAgain,
  onRestart,
}: ComputerUseSettingProps) {
  const labelId = useId();
  const descriptionId = useId();
  if (status !== null && !status.available) return null;
  const blocker = status === null ? null : blockerOf(status);
  // Outside Applications macOS would never list Zorvo, so the switch cannot be turned on.
  const isLocked = blocker === "not-in-applications";
  const isShownOn = isOn && !isLocked;
  const showsPermissions = status !== null && isShownOn && blocker === null;
  const restart = (
    <Button variant="primary" size="md" onClick={onRestart}>
      {COPY.restart}
    </Button>
  );
  return (
    <SettingsGroup heading={COPY.heading}>
      <SettingsRow
        label={<span id={labelId}>{COPY.label}</span>}
        description={<span id={descriptionId}>{COPY.description}</span>}
        control={
          <button
            type="button"
            role="switch"
            aria-checked={isShownOn}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            disabled={isLocked}
            onClick={() => onChange(!isShownOn)}
            className="focus-ring rounded-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              className={`relative block h-4 w-7 rounded-full transition-colors ${isShownOn ? "bg-fg" : "bg-border-strong"}`}
            >
              <span
                className={`absolute left-0 top-0.5 h-3 w-3 rounded-full transition-transform ${isShownOn ? "translate-x-3.5 bg-ground" : "translate-x-0.5 bg-fg"}`}
              />
            </span>
          </button>
        }
      />
      {blocker && (isOn || isLocked) && (
        <MessageRow action={blocker === "update-pending" ? restart : undefined}>{BLOCKER_TEXT[blocker]}</MessageRow>
      )}
      {showsPermissions && (
        <>
          <PermissionRow name={COPY.screenRecording} state={status.screenRecording} pane="screen" onOpenPane={onOpenPane} />
          <PermissionRow
            name={COPY.accessibility}
            state={status.accessibility}
            pane="accessibility"
            onOpenPane={onOpenPane}
          />
          {status.afterUpdate && (
            <MessageRow
              action={
                <Button variant="primary" size="md" onClick={onAllowAgain} disabled={isChecking}>
                  {COPY.allowAgain}
                </Button>
              }
            >
              {AFTER_UPDATE_TEXT}
            </MessageRow>
          )}
          {status.restartHint && <MessageRow action={restart}>{RESTART_HINT_TEXT}</MessageRow>}
          <SettingsRow
            label={<span className="sr-only">Permissions</span>}
            control={
              <Button variant="ghost" size="md" onClick={onCheck} disabled={isChecking}>
                {isChecking ? COPY.checking : COPY.checkAgain}
              </Button>
            }
          />
        </>
      )}
      <span role="status" className="sr-only">
        {announcementOf(status, isShownOn, isChecking)}
      </span>
    </SettingsGroup>
  );
}
