import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrivateTopupRequestCard } from "../components/private/PrivateTopupRequestCard";

const MODEL = { id: "Qwen/Qwen3.8-27B", inputPerM: 0, outputPerM: 100 };
const REQUEST = {
  sessionId: "s-1",
  requestId: "r-1",
  usd: 5,
  credits: 500,
  reason: "The review needs more credits.",
};

describe("PrivateTopupRequestCard", () => {
  it("draws the package, the turns and the agent's reason as text", () => {
    render(
      <PrivateTopupRequestCard
        request={{ ...REQUEST, reason: "<b>bold</b> and \u202Ereversed" }}
        model={MODEL}
        onTopUp={vi.fn()}
        onNotNow={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Qwen Code asks to top up $5" })).toBeInTheDocument();
    expect(screen.getByText("500 credits · about 41 turns on Qwen 3.8 27B")).toBeInTheDocument();
    expect(screen.getByText("Qwen Code says:")).toBeInTheDocument();
    expect(screen.getByText(/<b>bold<\/b>/)).toBeInTheDocument();
    expect(screen.getByText(/\\u202Ereversed/)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Top up $5" })).toBeInTheDocument();
  });

  it("runs the top-up only on a click, never by drawing the card", () => {
    const onTopUp = vi.fn();
    render(<PrivateTopupRequestCard request={REQUEST} model={MODEL} onTopUp={onTopUp} onNotNow={vi.fn()} />);

    expect(onTopUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Top up $5" }));

    expect(onTopUp).toHaveBeenCalledTimes(1);
  });

  it("dismisses with Not now", () => {
    const onNotNow = vi.fn();
    render(<PrivateTopupRequestCard request={REQUEST} model={MODEL} onTopUp={vi.fn()} onNotNow={onNotNow} />);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onNotNow).toHaveBeenCalledTimes(1);
  });

  it("holds both buttons while the answer is on its way", () => {
    render(<PrivateTopupRequestCard request={REQUEST} model={MODEL} isBusy onTopUp={vi.fn()} onNotNow={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();
  });

  it("waits for another open top-up instead of starting a second one", () => {
    render(
      <PrivateTopupRequestCard request={REQUEST} model={MODEL} canTopUp={false} onTopUp={vi.fn()} onNotNow={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Top up $5" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
  });
});