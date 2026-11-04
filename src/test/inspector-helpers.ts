import { act, fireEvent, screen, within } from "@testing-library/react";

export type InspectorTabLabel = "Changes" | "Activity" | "Files" | "Terminal";

/** The top bar's Inspector button. */
export function inspectorButton(): HTMLElement {
  return within(screen.getAllByRole("banner")[0]).getByRole("button", { name: "Inspector" });
}

/**
 * Opens the inspector when it is closed, then shows that tab. Both wait: the
 * button needs a folder, and Changes needs the folder known to be a repository.
 */
export async function openInspectorTab(label: InspectorTabLabel): Promise<void> {
  if (!screen.queryByRole("tablist", { name: "Inspector" })) {
    const button = await within(screen.getAllByRole("banner")[0]).findByRole("button", { name: "Inspector" });
    await act(async () => {
      fireEvent.click(button);
    });
  }
  // A tab's name carries its count ("Changes 3"), so it is matched from the start.
  const tablist = await screen.findByRole("tablist", { name: "Inspector" });
  const tab = await within(tablist).findByRole("tab", { name: new RegExp(`^${label}`) });
  await act(async () => {
    fireEvent.click(tab);
  });
}

/** Closes the inspector from its own close button. */
export async function closeInspector(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
  });
}
