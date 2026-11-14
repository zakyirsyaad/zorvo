import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrivateSessionLimitMenu, sessionLimitDisabledReason } from "../components/private/PrivateSessionLimitMenu";
import { turnsFor } from "../lib/private-credits";
import type { ModelPrice } from "../lib/private-credits";

const MODEL: ModelPrice = { id: "Qwen/Qwen3.8-27B", inputPerM: 0.04, outputPerM: 1.35 };

function Harness({ credits = 1240, ownKey = false }: { credits?: number; ownKey?: boolean }) {
  const [cap, setCap] = useState<number | undefined>(undefined);
  return (
    <PrivateSessionLimitMenu cap={cap} model={MODEL} credits={credits} ownKey={ownKey} onChange={setCap} />
  );
}

describe("PrivateSessionLimitMenu", () => {
  it("opens with No limit, the three caps with their turns, and the canvas footer", () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Session limit: No session limit" });
    fireEvent.click(chip);

    expect(screen.getByRole("listbox", { name: "Session limit" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No limit" })).toHaveAttribute("aria-selected", "true");
    for (const cap of [100, 200, 500]) {
      expect(screen.getByRole("option", { name: `${cap} credits ≈ ${turnsFor(cap, MODEL)} turns` })).toBeEnabled();
    }
    expect(
      screen.getByText("NEAR AI stops the session at the limit, even if Zorvo is closed. Turns are for Qwen 3.8 27B."),
    ).toBeInTheDocument();
  });

  it("picks a cap, closes the listbox and shows it on the chip", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Session limit: No session limit" }));
    fireEvent.click(screen.getByRole("option", { name: /200 credits/ }));

    expect(screen.queryByRole("listbox", { name: "Session limit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Session limit: 200 credits" })).toBeInTheDocument();
  });

  it("offers the options the balance covers and disables the rest", () => {
    render(<Harness credits={150} />);
    fireEvent.click(screen.getByRole("button", { name: "Session limit: No session limit" }));

    expect(screen.getByRole("option", { name: /100 credits/ })).toBeEnabled();
    expect(screen.getByRole("option", { name: /200 credits/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /500 credits/ })).toBeDisabled();
  });

  it("is disabled with the canvas reason for the user's own key", () => {
    render(<Harness ownKey />);

    expect(screen.getByRole("button", { name: "Session limit" })).toBeDisabled();
    expect(
      screen.getByText("With your own key, set spending limits on the key in your NEAR AI dashboard."),
    ).toBeInTheDocument();
    expect(sessionLimitDisabledReason({ ownKey: true, credits: 1240 })).toBe(
      "With your own key, set spending limits on the key in your NEAR AI dashboard.",
    );
  });

  it("is disabled below the smallest cap", () => {
    render(<Harness credits={50} />);

    expect(screen.getByRole("button", { name: "Session limit" })).toBeDisabled();
    expect(screen.getByText("You need at least 100 credits to set a session limit.")).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Session limit" })).toBeNull();
  });
});