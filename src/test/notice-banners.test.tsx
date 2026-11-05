import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FailedTurnBanner } from "../components/FailedTurnBanner";
import { UpdateNotice } from "../components/UpdateNotice";
import { NOTICE_BANNER_LAYOUT } from "../components/ui/noticeBannerStyle";
import { makeCatalogAgent } from "./fixtures/catalog";

describe("banners under the top bar", () => {
  it("keep the shared layout and their own colors", () => {
    render(<UpdateNotice agents={[makeCatalogAgent({ id: "gemini", name: "Gemini", updateVersion: "1.1.0" })]} onShow={vi.fn()} onDismiss={vi.fn()} />);

    const status = screen.getByRole("status");
    expect(status).toHaveClass(...NOTICE_BANNER_LAYOUT.split(" "));
    expect(status).toHaveClass("bg-surface-2", "text-fg-secondary");
  });
});

describe("the failed turn under the last message", () => {
  it("is a danger card of its own, not a banner under the top bar", () => {
    render(<FailedTurnBanner agentName="Gemini CLI" error="fetch failed" isBusy={false} onRetry={vi.fn()} onDismiss={vi.fn()} />);

    const alert = screen.getByRole("alert");
    // The danger edge and icon carry the colour; the words read in fg, as drawn.
    expect(alert).toHaveClass("bg-danger-surface", "border-danger");
    expect(alert.querySelector(".lucide-circle-alert")?.getAttribute("class")).toContain("text-danger");
    // It sits in the chat's column, so it has no margins of a banner across the top.
    expect(alert).not.toHaveClass("mx-6");
  });
});
