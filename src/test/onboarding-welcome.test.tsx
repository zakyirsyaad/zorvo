import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wordmark } from "../components/onboarding/Wordmark";

describe("the wordmark", () => {
  it("the wordmark is the symbol beside zorvo", () => {
    render(<Wordmark />);
    const mark = screen.getByRole("img", { name: "Zorvo" });
    expect(mark.querySelectorAll("svg path")).toHaveLength(3);
    expect(mark.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(screen.getByText("zorvo")).toHaveClass("font-semibold", "tracking-[-0.04em]");
  });
});
