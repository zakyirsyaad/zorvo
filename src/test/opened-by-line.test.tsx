import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OpenedByLine } from "../components/delegation/OpenedByLine";

describe("OpenedByLine", () => {
  it("says who opened the session and opens that session", () => {
    const onOpen = vi.fn();
    render(<OpenedByLine agentName="pi ACP" sessionName="Parser work" openerSessionId="s-a" onOpen={onOpen} canAct />);

    expect(screen.getByRole("note")).toHaveTextContent("Opened by pi ACP from Parser work");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("s-a");
  });

  it("has no Open in a popout", () => {
    render(<OpenedByLine agentName="pi ACP" sessionName="Parser work" openerSessionId="s-a" onOpen={vi.fn()} canAct={false} />);
    expect(screen.getByRole("note")).toHaveTextContent("Opened by pi ACP from Parser work");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says the opener is gone when it was deleted", () => {
    render(<OpenedByLine agentName="" sessionName="" openerSessionId={null} onOpen={vi.fn()} canAct />);
    expect(screen.getByRole("note")).toHaveTextContent("The session that opened this is gone.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
