import { act, fireEvent, within } from "@testing-library/react";

/** Opens a sidebar row's ⋯ menu. `row` is the row or the list item that holds it. */
export async function openRowMenu(row: HTMLElement): Promise<void> {
  const [trigger] = within(row).getAllByRole("button", { name: /^More actions for / });
  await act(async () => {
    fireEvent.click(trigger);
  });
}

/** Presses Delete in a row's menu, which asks to confirm. */
export async function clickRowDelete(row: () => HTMLElement): Promise<void> {
  await openRowMenu(row());
  await act(async () => {
    fireEvent.click(within(row()).getByRole("menuitem", { name: "Delete" }));
  });
}

/** Deletes a session from its sidebar row: Delete, then Confirm delete. */
export async function deleteFromRow(row: () => HTMLElement): Promise<void> {
  await clickRowDelete(row);
  await act(async () => {
    fireEvent.click(within(row()).getByRole("menuitem", { name: "Confirm delete" }));
  });
}
