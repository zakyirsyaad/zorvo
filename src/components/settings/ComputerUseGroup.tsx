import { useComputerUseSetting } from "../../hooks/useComputerUseSetting";
import { ComputerUseSetting } from "./ComputerUseSetting";

export interface ComputerUseGroupProps {
  isOn: boolean;
  /** Saves the switch. */
  onChange: (isOn: boolean) => void;
  /** Writes what the app still holds, then restarts Zorvo. */
  onRestart: () => void;
  onError: (message: string) => void;
}

/** Settings' Computer use group with its state: the saved switch and what macOS allows Zorvo. */
export function ComputerUseGroup({ isOn, onChange, onRestart, onError }: ComputerUseGroupProps) {
  const setting = useComputerUseSetting(onError);
  return (
    <ComputerUseSetting
      isOn={isOn}
      status={setting.status}
      isChecking={setting.isChecking}
      onChange={(next) => {
        onChange(next);
        // Zorvo asks macOS for the permissions from this click, and from nowhere else.
        if (next) setting.requestPermissions();
        else setting.check();
      }}
      onCheck={setting.check}
      onOpenPane={setting.openPane}
      onAllowAgain={setting.allowAgain}
      onRestart={onRestart}
    />
  );
}
