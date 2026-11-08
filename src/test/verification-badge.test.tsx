import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { VerificationBadge } from "../components/private/VerificationBadge";
import { VERIFICATION_CENTER_URL } from "../components/private/PrivateInspector";
import type { MessageVerification } from "../types";

const SIGNER = "0x1234567890abcdef1234567890abcdef12345678";

const VERIFIED: MessageVerification = {
  state: "verified",
  kind: "provider_tee",
  signer: SIGNER,
  signed: 2,
  total: 2,
};

function open(verification: MessageVerification) {
  const onOpenUrl = vi.fn();
  render(<VerificationBadge verification={verification} onOpenUrl={onOpenUrl} />);
  return { onOpenUrl };
}

describe("VerificationBadge", () => {
  it("shows the four states by name", () => {
    const { unmount } = render(<VerificationBadge verification={VERIFIED} />);
    expect(screen.getByText("Verified in TEE")).toBeInTheDocument();
    unmount();

    const states = [
      ["didnt_verify", "Didn't verify"],
      ["not_signed", "Not signed"],
      ["checking", "Checking the signature"],
    ] as const;
    for (const [state, label] of states) {
      const view = render(<VerificationBadge verification={{ ...VERIFIED, state }} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("names the kind, the shortened signer and the signed calls", () => {
    open(VERIFIED);
    fireEvent.click(screen.getByRole("button", { name: /Verified in TEE/ }));

    const panel = screen.getByRole("dialog", { name: "Signature" });
    expect(within(panel).getByText("Signed by the model's TEE")).toBeInTheDocument();
    expect(within(panel).getByText("2 of 2 calls signed · 0x1234…5678")).toBeInTheDocument();
  });

  it("names the attested gateway honestly", () => {
    open({ ...VERIFIED, kind: "gateway" });
    fireEvent.click(screen.getByRole("button", { name: /Verified in TEE/ }));

    expect(screen.getByText("Signed by NEAR AI's attested gateway")).toBeInTheDocument();
  });

  it("says when the signer's kind is unknown", () => {
    open({ ...VERIFIED, kind: undefined });
    fireEvent.click(screen.getByRole("button", { name: /Verified in TEE/ }));

    expect(screen.getByText("The signature names an unknown signer")).toBeInTheDocument();
  });

  it("explains a failure, a missing signature and a pending check", () => {
    const failures = [
      ["didnt_verify", "A call in this answer did not verify."],
      ["not_signed", "NEAR AI did not sign this answer."],
      ["checking", "Zorvo is checking NEAR AI's signature."],
    ] as const;
    for (const [state, detail] of failures) {
      const view = render(<VerificationBadge verification={{ ...VERIFIED, state }} />);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(state === "didnt_verify" ? "Didn't verify" : state === "not_signed" ? "Not signed" : "Checking") }));
      expect(screen.getByText(detail)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("opens NEAR AI's Verification Center from the panel", () => {
    const { onOpenUrl } = open(VERIFIED);
    fireEvent.click(screen.getByRole("button", { name: /Verified in TEE/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open the Verification Center" }));

    expect(onOpenUrl).toHaveBeenCalledWith(VERIFICATION_CENTER_URL);
  });
});