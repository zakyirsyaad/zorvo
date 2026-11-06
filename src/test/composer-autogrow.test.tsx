import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";

/**
 * The prompt grows with its text: it is set to `height: auto` and measured. In a column that scrolls (a draft in a
 * short window), that brief shrink lets the browser clamp the column's scroll position, and setting the height back
 * does not undo it, so Send would jump out of reach on each edit. The composer puts the offset back.
 */
describe("the prompt growing in a scrolled column", () => {
  it("keeps the column where the user scrolled it", () => {
    render(
      <div data-testid="column">
        <ComposerDock onSendMessage={vi.fn()} />
      </div>,
    );
    const column = screen.getByTestId("column");
    let columnTop = 240;
    Object.defineProperty(column, "scrollTop", {
      configurable: true,
      get: () => columnTop,
      set: (value: number) => {
        columnTop = value;
      },
    });
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    Object.defineProperty(prompt, "scrollHeight", {
      configurable: true,
      // Measuring at `height: auto` lays the page out with a short prompt; the browser clamps the column then.
      get: () => {
        columnTop = 104;
        return 160;
      },
    });

    fireEvent.change(prompt, { target: { value: "one\ntwo\nthree\nfour\nfive" } });

    expect(prompt.style.height).toBe("160px");
    expect(columnTop).toBe(240);
  });
});
