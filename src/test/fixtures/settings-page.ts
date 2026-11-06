import type { GeneralAppUpdate } from "../../components/settings/GeneralSection";
import type { SettingsTab } from "../../components/settings/SettingsNav";
import type { SettingsPage } from "../../hooks/useSettingsPage";

/** No Zorvo update found, none being checked. */
export const idleAppUpdate: GeneralAppUpdate = {
  available: null,
  isChecking: false,
  checkedAt: null,
  checkFailed: false,
  checkNow: () => Promise.resolve(),
  install: () => Promise.resolve(),
  isInstalling: false,
  progress: null,
};

/** A Settings page held on `section`, or closed when it is null. */
export function pageAt(section: SettingsTab | null, select: (section: SettingsTab) => void = () => {}): SettingsPage {
  return { section, open: select, select, close: () => {} };
}
