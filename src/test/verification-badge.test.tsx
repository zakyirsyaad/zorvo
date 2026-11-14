import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { VerificationBadge } from "../components/private/VerificationBadge";
import { verificationCenterUrl } from "../components/private/PrivateInspector";
import { VERIFICATION_LABEL } from "../lib/private-verification";
import type { MessageVerification } from "../types";

const MODEL_ID = "Qwen/Qwen3.8-27B";
const SIGNER = "0x1234567890abcdef1234567890abcdef12345678";

const VERIFIED: MessageVerification = {
  state: "verified",
  kind: "provider_tee",
  signer: SIGNER,
  signed: 2,
  total: 2,
};

function open(verification: MessageVerification, modelId = MODEL_ID) {
  const onOpenUrl = vi.fn();
  const view = render(<VerificationBadge verification={verification} modelId={modelId} onOpenUrl={onOpenUrl} />);
  fireEvent.click(screen.getByRole("button", { name: /Show how this answer was verified/ }));
  return { onOpenUrl, panel: screen.getByRole("dialog", { name: "Signature" }), view };
}

describe("VerificationBadge", () => {
  it("draws the four 24px states with the canvas icons", () => {
    const cases = [
      ["verified", "Verified in TEE"],
      ["not_signed", "Not signed"],
      ["didnt_verify", "Didn't verify"],
      ["checking", "Checking the signature"],
    ] as const;
    for (const [state, label] of cases) {
      const view = render(
        <VerificationBadge verification={{ ...VERIFIED, state }} modelId={MODEL_ID} />,
      );
      const badge = screen.getByRole("button", { name: new RegExp(label) });
      expect(badge).toHaveClass("h-6", "rounded-md", "border", "text-ui-sm");
      expect(badge.querySelector(`[data-verification-icon="${state}"]`)).not.toBeNull();
      view.unmount();
    }

    const checking = render(<VerificationBadge verification={{ ...VERIFIED, state: "checking" }} />);
    expect(checking.container.querySelector(".animate-spin")).not.toBeNull();
    checking.unmount();
  });

  it("puts the verified signer beside the badge", () => {
    render(<VerificationBadge verification={VERIFIED} modelId={MODEL_ID} />);
    expect(screen.getByText("signed by 0x1234…5678")).toBeInTheDocument();
  });

  it("shows the verified popover's key/value rows and opens the Verification Center", () => {
    const { onOpenUrl, panel } = open(VERIFIED);

    expect(within(panel).getByText("Verified in TEE")).toBeInTheDocument();
    expect(within(panel).getByText(MODEL_ID)).toBeInTheDocument();
    expect(within(panel).getByText("0x1234…5678 · provider TEE")).toBeInTheDocument();
    expect(
      within(panel).getByText("The request and the answer match their signed hashes"),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/attestation report/i)).toBeNull();
    expect(within(panel).queryByText(/calls signed/i)).toBeNull();
    expect(within(panel).getByText("Model")).toHaveClass("w-24");
    expect(within(panel).getByText("Model").parentElement).toHaveClass("py-1.5");

    fireEvent.click(
      within(panel).getByRole("button", { name: "Check it yourself in NEAR AI's Verification Center" }),
    );
    expect(onOpenUrl).toHaveBeenCalledWith(verificationCenterUrl(MODEL_ID));
    expect(verificationCenterUrl("Qwen/Qwen3.8-27B")).toBe("https://cloud.near.ai/verify?model=Qwen%2FQwen3.8-27B");
    expect(verificationCenterUrl(undefined)).toBe("https://cloud.near.ai/verify");
  });

  it("names the gateway and an unknown kind honestly", () => {
    const gateway = open({ ...VERIFIED, kind: "gateway" });
    expect(within(gateway.panel).getByText("0x1234…5678 · gateway")).toBeInTheDocument();
    gateway.view.unmount();

    const unknown = open({ ...VERIFIED, kind: undefined });
    expect(within(unknown.panel).getByText("0x1234…5678 · unknown signer")).toBeInTheDocument();
  });

  it("shows the canvas's body for each unfinished state and no link", () => {
    const bodies = [
      [
        "not_signed",
        "The answer was cut off before NEAR AI could sign it, for example when you pressed Stop. It ran on the same hardware; it just can't be proven.",
      ],
      ["didnt_verify", "The signature doesn't match this answer. Treat the answer as unverified."],
      ["checking", "Right after the answer ends, for a second or two."],
    ] as const;
    for (const [state, body] of bodies) {
      const view = render(<VerificationBadge verification={{ ...VERIFIED, state }} modelId={MODEL_ID} />);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(VERIFICATION_LABEL[state]) }));
      const panel = screen.getByRole("dialog", { name: "Signature" });
      expect(within(panel).getByText(body)).toBeInTheDocument();
      expect(
        within(panel).queryByRole("button", {
          name: "Check it yourself in NEAR AI's Verification Center",
        }),
      ).toBeNull();
      view.unmount();
    }
  });
});