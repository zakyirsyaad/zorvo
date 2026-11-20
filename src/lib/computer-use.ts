/** What Settings shows for computer use, as `computer_use_status` reports it. */
export interface ComputerUseStatus {
  /** False off macOS: the group is hidden. */
  available: boolean;
  /** macOS lists Zorvo for these permissions only when it runs from Applications. */
  inApplications: boolean;
  driver: "ready" | "missing" | "changed" | "update-pending";
  screenRecording: PermissionState;
  accessibility: PermissionState;
  /** Both permissions were lost to an update. */
  afterUpdate: boolean;
  /** Screen Recording was asked for in this run and still reads not allowed. */
  restartHint: boolean;
}

export type PermissionState = "allowed" | "not-allowed";

/** The System Settings panes Zorvo can open; the backend refuses any other name. */
export type PermissionPane = "screen" | "accessibility";

const DRIVER_STATES: readonly ComputerUseStatus["driver"][] = ["ready", "missing", "changed", "update-pending"];

const permissionOf = (value: unknown): PermissionState => (value === "allowed" ? "allowed" : "not-allowed");

/** Reads the backend's answer; anything it does not say clearly reads as not allowed or not available. */
export function parseComputerUseStatus(value: unknown): ComputerUseStatus | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const driver = DRIVER_STATES.find((state) => state === raw.driver);
  if (!driver) return null;
  return {
    available: raw.available === true,
    inApplications: raw.inApplications === true,
    driver,
    screenRecording: permissionOf(raw.screenRecording),
    accessibility: permissionOf(raw.accessibility),
    afterUpdate: raw.afterUpdate === true,
    restartHint: raw.restartHint === true,
  };
}

export const COMPUTER_USE_COPY = {
  heading: "Computer use",
  label: "Let agents use apps on your Mac",
  description:
    "An agent asks before it uses each app, once per session. What it sees goes to its model provider. Turning this on applies to sessions you start or reopen from now on.",
  screenRecording: "Screen Recording",
  accessibility: "Accessibility",
  allowed: "Allowed",
  notAllowed: "Not allowed",
  openSettings: "Open System Settings",
  checkAgain: "Check again",
  checking: "Checking…",
  allowAgain: "Allow again",
  restart: "Restart Zorvo",
} as const;

/** What stops computer use on this Mac, most blocking first, or null when nothing does. */
export type ComputerUseBlocker = "not-in-applications" | "update-pending" | "driver-changed" | "driver-missing";

export function blockerOf(status: ComputerUseStatus): ComputerUseBlocker | null {
  if (!status.inApplications) return "not-in-applications";
  if (status.driver === "update-pending") return "update-pending";
  if (status.driver === "changed") return "driver-changed";
  if (status.driver === "missing") return "driver-missing";
  return null;
}

export const BLOCKER_TEXT: Record<ComputerUseBlocker, string> = {
  "not-in-applications": "Move Zorvo to Applications to use computer use.",
  "update-pending": "Restart Zorvo to finish the update.",
  "driver-changed": "Zorvo's computer use driver was changed. Reinstall Zorvo to use computer use.",
  "driver-missing": "Zorvo's computer use driver is missing. Reinstall Zorvo to use computer use.",
};

export const AFTER_UPDATE_TEXT = "macOS no longer recognizes Zorvo's permission after the update.";
export const RESTART_HINT_TEXT =
  "After you allow Screen Recording, restart Zorvo. If Zorvo is not in the list, add it with the + button.";

/** What a screen reader hears when the group's state changes, in few words. */
export function announcementOf(status: ComputerUseStatus | null, isOn: boolean, isChecking: boolean): string {
  if (isChecking) return "Checking computer use.";
  // An answer Zorvo could not read: the app's notice says so, and nothing is still being checked.
  if (status === null) return "";
  // The sentences on screen say why; the announcement only says that something changed.
  if (blockerOf(status) === "not-in-applications") return "Computer use is not available.";
  if (!isOn) return "Computer use is off.";
  if (blockerOf(status)) return "Computer use is not available.";
  if (status.afterUpdate) return "Computer use needs its permissions again.";
  const missing: string[] = [];
  if (status.screenRecording !== "allowed") missing.push(COMPUTER_USE_COPY.screenRecording);
  if (status.accessibility !== "allowed") missing.push(COMPUTER_USE_COPY.accessibility);
  return missing.length === 0 ? "Computer use is ready." : `${missing.join(" and ")} not allowed.`;
}
