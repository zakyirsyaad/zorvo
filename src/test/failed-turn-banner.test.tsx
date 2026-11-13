import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FailedTurnBanner } from "../components/FailedTurnBanner";
import { UserMessageBar } from "../components/chat/UserMessageBar";

const NETWORK_ERROR = "exception TypeError: fetch failed sending request";

function renderBanner(props: Partial<Parameters<typeof FailedTurnBanner>[0]> = {}) {
  const onRetry = vi.fn();
  const onDismiss = vi.fn();
  render(
    <FailedTurnBanner
      agentName="Gemini CLI"
      error={NETWORK_ERROR}
      isBusy={false}
      onRetry={onRetry}
      onDismiss={onDismiss}
      {...props}
    />,
  );
  return { onRetry, onDismiss };
}

describe("FailedTurnBanner", () => {
  it("explains a network failure in plain words with one hint", () => {
    renderBanner();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Gemini CLI could not reach the network.");
    expect(alert).toHaveTextContent("Check your connection or proxy, then try again.");
  });

  it("keeps the raw error behind Details", () => {
    renderBanner();
    expect(screen.queryByText(NETWORK_ERROR)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByText(NETWORK_ERROR)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText(NETWORK_ERROR)).toBeNull();
  });

  it("shows an unknown error as it is, with no Details to open", () => {
    renderBanner({ error: "quota exceeded" });

    expect(screen.getByRole("alert")).toHaveTextContent("The agent's turn failed quota exceeded");
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("asks to send the last prompt again once per click", () => {
    const { onRetry } = renderBanner();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("cannot try again while a turn runs", () => {
    const { onRetry } = renderBanner({ isBusy: true });

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("dismisses without trying again", () => {
    const { onRetry, onDismiss } = renderBanner();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("offers no Try again when there is no prompt to send again", () => {
    renderBanner({ onRetry: undefined });

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss notice" })).toBeInTheDocument();
  });
});

describe("the Rewind control under your message", () => {
  it("is named Rewind to here for everyone, in its tooltip and for screen readers", () => {
    render(<UserMessageBar copied={false} onCopy={vi.fn()} onRewind={vi.fn()} />);

    const rewind = screen.getByRole("button", { name: "Rewind to here" });
    expect(rewind).toHaveAttribute("title", "Rewind to here");
  });

  it("does not use the rotate arrow that reads as retry", () => {
    render(<UserMessageBar copied={false} onCopy={vi.fn()} onRewind={vi.fn()} />);

    const icon = screen.getByRole("button", { name: "Rewind to here" }).querySelector("svg");
    expect(icon).toHaveClass("lucide-undo-2");
    expect(icon).not.toHaveClass("lucide-rotate-ccw");
  });
});
