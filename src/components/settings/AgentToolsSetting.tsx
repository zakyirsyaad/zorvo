import { useId } from "react";
import { SettingsGroup, SettingsRow } from "./SettingsGroup";

export interface AgentToolsSettingProps {
  isOn: boolean;
  onChange: (isOn: boolean) => void;
}

/**
 * Whether agents get Zorvo's own tools: giving another agent a task, and
 * opening sessions. Off means a session is started without them; a running
 * session keeps what it started with, which the description says.
 */
export function AgentToolsSetting({ isOn, onChange }: AgentToolsSettingProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <SettingsGroup heading="Working together">
      <SettingsRow
        label={<span id={labelId}>Let agents delegate and open sessions</span>}
        description={
          <span id={descriptionId}>
            An agent asks first in each session. Applies to sessions you start or reopen from now on.
          </span>
        }
        control={
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            onClick={() => onChange(!isOn)}
            className="focus-ring rounded-full"
          >
            <span
              aria-hidden="true"
              className={`relative block h-4 w-7 rounded-full transition-colors ${isOn ? "bg-fg" : "bg-border-strong"}`}
            >
              <span
                className={`absolute left-0 top-0.5 h-3 w-3 rounded-full transition-transform ${isOn ? "translate-x-3.5 bg-ground" : "translate-x-0.5 bg-fg"}`}
              />
            </span>
          </button>
        }
      />
    </SettingsGroup>
  );
}
