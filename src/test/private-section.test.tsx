import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/notify", () => ({ notifyIfAway: vi.fn(() => Promise.resolve()) }));

import { PrivateSection } from "../components/settings/PrivateSection";
import { RecoveryCodeLayer } from "../components/private/RecoveryCodeLayer";
import { RecoveryCodeDialog } from "../components/private/RecoveryCodeDialog";
import { RecoveryCard } from "../components/private/RecoveryCard";
import { TopupProgress } from "../components/private/TopupProgress";
import { usePrivateCredits, type TopupFlow } from "../hooks/usePrivateCredits";
import { usePrivateRecoveryDialog } from "../hooks/usePrivateRecoveryDialog";
import { turnsFor, type PaymentSource, type PendingTopup } from "../lib/private-credits";
import type { Session } from "../types";
import type { FakePrivate } from "./fixtures/private-backend";

function fake(): FakePrivate {
  return (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__;
}

function callsTo(cmd: string) {
  return fake().calls.filter((call) => call.cmd === cmd);
}

const MODEL = { id: "Qwen/Qwen3.8-27B", inputPerM: 0.1, outputPerM: 1.3 };

const PACKAGES = [
  { usd: 5, credits: 500, available: true },
  { usd: 10, credits: 1000, available: true },
  { usd: 25, credits: 2500, available: false, reason: "device_cap" },
];

function stockWith(packages = PACKAGES, availableCredits = 100_000) {
  fake().stock = { availableCredits, yourRoomCredits: 5_000, packages, updatedAt: "2026-11-07T10:00:00Z" };
  fake().models = [MODEL];
}

/** A device that holds credits already. */
function readyWith(credits: number, extra: Partial<FakePrivate["status"]> = {}) {
  fake().status = {
    ...fake().status,
    device: "ready",
    keyReady: true,
    balance: { credits, usedCredits: 260, keyReady: true, updatedAt: new Date().toISOString() },
    // Saved already: the global dialog stays out of these tests unless they ask for it.
    recoverySaved: true,
    recoveryPrompted: true,
    ...extra,
  };
}

/** What App does: one hook, the section, and the one recovery dialog layer. */
function Harness({
  secretGuard = true,
  onSecretGuardChange = () => {},
  sessions = [],
  agentNameOf = (profileId: string) => profileId,
  paymentSource = "credits",
  onPaymentSourceChange = () => {},
}: {
  secretGuard?: boolean;
  onSecretGuardChange?: (isOn: boolean) => void;
  sessions?: readonly Session[];
  agentNameOf?: (profileId: string) => string;
  paymentSource?: PaymentSource;
  onPaymentSourceChange?: (source: PaymentSource) => void;
}) {
  const [source, setSource] = useState<PaymentSource>(paymentSource);
  const credits = usePrivateCredits();
  const dialog = usePrivateRecoveryDialog();
  return (
    <>
      <PrivateSection
        credits={credits}
        onShowRecoveryCode={dialog.show}
        onRestoringChange={dialog.setIsRestoring}
        secretGuard={secretGuard}
        onSecretGuardChange={onSecretGuardChange}
        sessions={sessions}
        agentNameOf={agentNameOf}
        paymentSource={source}
        onPaymentSourceChange={(next) => {
          setSource(next);
          onPaymentSourceChange(next);
        }}
      />
      <RecoveryCodeLayer
        credits={credits}
        request={dialog.request}
        suppressStatusPrompt={dialog.suppressStatusPrompt}
        onClose={dialog.close}
      />
    </>
  );
}

/** What App mounts at start, without Settings open: the hook and the recovery layer, no section. */
function AppWithoutSettings() {
  const credits = usePrivateCredits();
  const dialog = usePrivateRecoveryDialog();
  return (
    <RecoveryCodeLayer
      credits={credits}
      request={dialog.request}
      suppressStatusPrompt={dialog.suppressStatusPrompt}
      onClose={dialog.close}
    />
  );
}

async function mount(options: {
  secretGuard?: boolean;
  onSecretGuardChange?: (isOn: boolean) => void;
  sessions?: readonly Session[];
  agentNameOf?: (profileId: string) => string;
  paymentSource?: PaymentSource;
  onPaymentSourceChange?: (source: PaymentSource) => void;
} = {}) {
  await act(async () => {
    render(<Harness {...options} />);
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function type(element: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Private mode section: how credits work", () => {
  it("says what a credit costs and what using one costs", async () => {
    stockWith();
    await mount();
    expect(await screen.findByText("How credits work")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You buy credits at 1 credit = $0.01. Each model has its own price at NEAR AI; Zorvo adds 20% to cover payments and running the service.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A typical turn on Qwen 3.8 27B uses about 0.4 credits; bigger models use more. Credits don't expire, can't be withdrawn, and work only on this Mac or the one you move them to.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Private mode section: balance", () => {
  it("first run shows 0 credits, no key and the first top-up note", async () => {
    stockWith();
    await mount();
    expect(await screen.findByText("0 credits")).toBeInTheDocument();
    expect(screen.getByText("No key yet")).toBeInTheDocument();
    expect(
      screen.getByText("You haven't topped up yet. Your first top-up also sets up the private key this Mac uses."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Got a promo code? Redeem it under the packages to try Private mode for free."),
    ).toBeInTheDocument();
  });

  it("shows a skeleton with a status while the status loads", async () => {
    let release: () => void = () => {};
    fake().holds.private_status = new Promise<void>((resolve) => (release = resolve));
    await mount();
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Loading your balance…")).toBe(true);
    expect(screen.queryByText("0 credits")).toBeNull();
    await act(async () => release());
    expect(await screen.findByText("0 credits")).toBeInTheDocument();
  });

  it("draws no Running low text in the Settings balance card", async () => {
    readyWith(49);
    await mount();

    expect(await screen.findByText("49 credits")).toBeInTheDocument();
    expect(screen.queryByText("Running low")).toBeNull();
  });

  it("does not mark exactly 50 credits either", async () => {
    readyWith(50);
    await mount();

    expect(await screen.findByText("50 credits")).toBeInTheDocument();
    expect(screen.queryByText("Running low")).toBeNull();
  });

  it("shows the balance, the used credits and the key", async () => {
    readyWith(1240);
    await mount();
    expect(await screen.findByText("1,240 credits")).toBeInTheDocument();
    const amount = document.querySelector("[data-balance-amount]");
    expect(amount).toHaveClass("text-[28px]");
    expect(within(amount as HTMLElement).getByText("credits")).toHaveClass("text-sm");
    expect(screen.getByText("One balance for every private session on this Mac · 260 used so far")).toBeInTheDocument();
    expect(screen.getByText("Key ready")).toBeInTheDocument();
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
    expect(button("Refresh").querySelector("svg")).toHaveAttribute("width", "12");
  });

  it("Refresh asks the server for a fresh balance, once", async () => {
    readyWith(1240);
    await mount();
    await screen.findByText("1,240 credits");
    await click(button("Refresh"));
    expect(callsTo("private_status").map((call) => call.args)).toEqual([{ fresh: false }, { fresh: true }]);
  });

  it("unreachable shows the last known balance and Try again", async () => {
    fake().status = {
      ...fake().status,
      device: "ready",
      keyReady: true,
      balanceError: "unreachable",
      lastBalance: { credits: 1240, usedCredits: 0, at: new Date(Date.now() - 3 * 3_600_000).toISOString() },
      recoverySaved: true,
      recoveryPrompted: true,
    };
    await mount();
    const title = await screen.findByText("Balance unavailable");
    expect(title).toHaveClass("text-ui", "font-semibold");
    expect(title.closest("[data-settings-row]")?.querySelector(".bg-status-attention")).not.toBeNull();
    expect(screen.getByText("Last known: 1,240 credits · 3 hours ago")).toBeInTheDocument();
    await click(button("Try again"));
    expect(callsTo("private_status").at(-1)?.args).toEqual({ fresh: true });
  });

  it("moved offers Forget on this Mac, and says why when it fails", async () => {
    fake().status = { ...fake().status, device: "moved", recoverySaved: true, recoveryPrompted: true };
    await mount();
    expect(await screen.findByText("Your credits moved to another Mac")).toBeInTheDocument();
    expect(screen.getByText(/This Mac can't use them anymore\./)).toBeInTheDocument();
    fake().errors.private_forget_device = "storage";
    await click(button("Forget on this Mac"));
    expect(screen.getByText("Couldn't save your settings on this Mac. Try again.")).toBeInTheDocument();
    delete fake().errors.private_forget_device;
    fake().status = { ...fake().status, device: "none" };
    await click(button("Forget on this Mac"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Forget on this Mac" })).toBeNull());
    expect(callsTo("private_forget_device")).toHaveLength(2);
  });

  it("offers Forget only when the credits moved", async () => {
    readyWith(100);
    await mount();
    await screen.findByText("100 credits");
    expect(screen.queryByRole("button", { name: "Forget on this Mac" })).toBeNull();
  });

  it("shows a key error in words", async () => {
    readyWith(100, { keyReady: false, keyError: "key_lost" });
    await mount();
    expect(
      await screen.findByText("Your private key didn't reach this Mac. Restore with your recovery code to get a new one."),
    ).toBeInTheDocument();
    expect(screen.getByText("No key yet")).toBeInTheDocument();
  });

  it("a recovery code not yet saved leaves a note that opens the dialog", async () => {
    readyWith(100, { recoverySaved: false, recoveryPrompted: true });
    await mount();
    await click(await screen.findByRole("button", { name: "Save your recovery code" }));
    expect(await screen.findByRole("dialog", { name: "Save your recovery code" })).toBeInTheDocument();
    expect(await screen.findByText("ZRV-FAKE-CODE")).toBeInTheDocument();
  });
});

describe("Private mode section: top-up picker", () => {
  it("lists the packages with turns, and a disabled one with its reason", async () => {
    stockWith();
    await mount();
    const five = await screen.findByRole("radio", { name: /\$5\b/ });
    expect(five).toBeEnabled();
    expect(within(five).getByText("500 credits")).toBeInTheDocument();
    const turns = turnsFor(500, MODEL).toLocaleString("en-US");
    expect(within(five).getByText(`≈ ${turns} turns`)).toBeInTheDocument();
    const twentyFive = screen.getByRole("radio", { name: /\$25/ });
    expect(twentyFive).toBeDisabled();
    expect(screen.getByText("Over your 5,000-credit limit")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Package" })).toBeInTheDocument();
    expect(screen.getByText("Credits can't be refunded or withdrawn.")).toBeInTheDocument();
  });

  it("leaves the turns out when the models are not loaded", async () => {
    stockWith();
    fake().models = [];
    await mount();
    await screen.findByRole("radio", { name: /\$5\b/ });
    expect(screen.queryByText(/turns/)).toBeNull();
  });

  it("says Loading packages until the stock arrives", async () => {
    stockWith();
    let release: () => void = () => {};
    fake().holds.private_stock = new Promise<void>((resolve) => (release = resolve));
    await mount();
    expect(screen.getByText("Loading packages…")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await act(async () => release());
    expect(await screen.findByRole("radio", { name: /\$5\b/ })).toBeInTheDocument();
  });

  it("shows a models failure with a retry", async () => {
    stockWith();
    fake().errors.private_models = "upstream";
    await mount();
    expect(await screen.findByText("Couldn't load the private models. Try again.")).toBeInTheDocument();
    delete fake().errors.private_models;
    await click(button("Try again"));
    await waitFor(() => expect(screen.queryByText("Couldn't load the private models. Try again.")).toBeNull());
  });

  it("shows the stock line at the heading, with a low-stock note below 2,500 credits", async () => {
    stockWith(PACKAGES, 600);
    await mount();
    expect(await screen.findByText(/^Stock: 600 credits · more coming soon · updated .+ ago$/)).toBeInTheDocument();
  });

  it("shows no low-stock note when stock is plentiful", async () => {
    stockWith();
    await mount();
    await screen.findByRole("radio", { name: /\$5\b/ });
    expect(screen.getByText(/^Stock: 100,000 credits · updated .+ ago$/)).toBeInTheDocument();
    expect(screen.queryByText(/more coming soon/)).toBeNull();
  });

  it("picking $10 shows the confirm row and calls nothing", async () => {
    stockWith();
    await mount();
    const calls = fake().calls.length;
    await click(await screen.findByRole("radio", { name: /\$10/ }));
    expect(screen.getByText("1,000 credits for $10")).toBeInTheDocument();
    expect(button("Pay $10")).toBeEnabled();
    expect(callsTo("private_create_topup")).toHaveLength(0);
    expect(fake().calls).toHaveLength(calls);
  });

  it("Pay $10 creates the top-up once, then opens checkout and waits", async () => {
    stockWith();
    await mount();
    await click(await screen.findByRole("radio", { name: /\$10/ }));
    await click(button("Pay $10"));
    expect(callsTo("private_create_topup")).toHaveLength(1);
    expect(callsTo("private_create_topup")[0].args).toEqual({ packageUsd: 10 });
    expect(callsTo("private_open_checkout")).toHaveLength(1);
    expect(screen.getByText("Waiting for your payment")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Checkout is open in your browser. Pay $10 in USDC from any chain, a wallet or a card. This updates by itself.",
      ),
    ).toBeInTheDocument();
    // The picker is gone while the top-up is followed.
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows the reason when creating the top-up fails, and Try again brings the picker back", async () => {
    stockWith();
    fake().errors.private_create_topup = "stock";
    await mount();
    await click(await screen.findByRole("radio", { name: /\$10/ }));
    await click(button("Pay $10"));
    expect(screen.getByText("Top-ups are paused for now")).toBeInTheDocument();
    expect(screen.queryByText(/may still go through/)).toBeNull();
    await click(button("Try again"));
    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
  });

  it("disables the packages while a promo code is being redeemed", async () => {
    stockWith();
    readyWith(0);
    let release: () => void = () => {};
    await mount();
    await screen.findByRole("radio", { name: /\$5\b/ });
    fake().holds.private_redeem_promo = new Promise<void>((resolve) => (release = resolve));
    await type(screen.getByRole("textbox", { name: "Promo code" }), "ZORVO-TEST");
    await click(button("Redeem"));
    expect(screen.getByRole("radio", { name: /\$5\b/ })).toBeDisabled();
    await act(async () => release());
  });
});

describe("Private mode section: promo code", () => {
  it("redeems a code and says how many credits it added", async () => {
    stockWith();
    await mount();
    await type(await screen.findByRole("textbox", { name: "Promo code" }), "ZORVO-TEST");
    await click(button("Redeem"));
    expect(callsTo("private_redeem_promo")[0].args).toEqual({ code: "ZORVO-TEST" });
    expect(await screen.findByText("500 credits added. Enjoy.")).toBeInTheDocument();
  });

  it("shows the error text of a refused code", async () => {
    stockWith();
    fake().errors.private_redeem_promo = "bad_code";
    await mount();
    await type(await screen.findByRole("textbox", { name: "Promo code" }), "NOPE");
    await click(button("Redeem"));
    expect(screen.getByText("That code doesn't exist, or it has been used up.")).toBeInTheDocument();
  });

  it("keeps Redeem off for an empty code", async () => {
    stockWith();
    await mount();
    await screen.findByRole("textbox", { name: "Promo code" });
    expect(button("Redeem")).toBeDisabled();
  });

  it("keeps Redeem off while a top-up is followed", async () => {
    stockWith();
    readyWith(0, { pendingTopup: { topupId: "t1", expiresAt: "2026-11-07T11:00:00Z", credits: 1000 } });
    await mount();
    await screen.findByText("Waiting for your payment");
    await type(screen.getByRole("textbox", { name: "Promo code" }), "ZORVO-TEST");
    expect(button("Redeem")).toBeDisabled();
  });
});

const TOPUP: PendingTopup = { topupId: "t1", expiresAt: "2026-11-07T11:00:00Z", credits: 1000 };

function renderProgress(flow: TopupFlow, extra: Partial<Parameters<typeof TopupProgress>[0]> = {}) {
  const props = {
    flow,
    balanceCredits: 2240,
    onOpenCheckout: vi.fn(() => Promise.resolve({ ok: true as const })),
    onCancel: vi.fn(() => Promise.resolve({ ok: true as const })),
    onDismiss: vi.fn(),
    ...extra,
  };
  render(<TopupProgress {...props} />);
  return props;
}

describe("TopupProgress", () => {
  it("renders nothing visible while idle, but keeps its live region", () => {
    renderProgress({ kind: "idle" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opening says so and cannot be cancelled yet", () => {
    renderProgress({ kind: "opening", usd: 10 });
    expect(screen.getByText("Opening checkout in your browser")).toBeInTheDocument();
    expect(screen.getByText("Your 1,000 credits are held for 25 minutes while you pay.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for your payment")).toBeInTheDocument();
    expect(screen.getByText("Browser didn't open? Open checkout again.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Opening checkout in your browser");
    expect(button("Cancel")).toBeDisabled();
  });

  it("waiting offers Open checkout again and Cancel", async () => {
    const props = renderProgress({ kind: "waiting", topup: TOPUP });
    expect(screen.getByText("Waiting for your payment")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Checkout is open in your browser. Pay $10 in USDC from any chain, a wallet or a card. This updates by itself.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Checking with PingPay · 1,000 credits held for you for 25 min")).toBeInTheDocument();
    await click(button("Open checkout again"));
    expect(props.onOpenCheckout).toHaveBeenCalledTimes(1);
    await click(button("Cancel"));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("waiting after a browser that did not open says so", () => {
    renderProgress({ kind: "waiting", topup: TOPUP, openFailed: true });
    expect(screen.getByText("Couldn't open checkout")).toBeInTheDocument();
    expect(screen.getByText("PingPay didn't answer. Nothing was held or charged.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for your payment")).toBeNull();
    expect(button("Try again")).toHaveClass("bg-primary");
    expect(button("Cancel")).toBeInTheDocument();
  });

  it("a checkout that cannot be reopened offers Cancel only", async () => {
    renderProgress(
      { kind: "waiting", topup: TOPUP },
      { onOpenCheckout: vi.fn(() => Promise.resolve({ ok: false as const, code: "not_found" })) },
    );
    await click(button("Open checkout again"));
    expect(
      screen.getByText(
        "Your checkout can't be reopened here. If its browser tab is still open, finish paying there, or cancel.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open checkout again" })).toBeNull();
    expect(button("Cancel")).toBeInTheDocument();
  });

  it("a browser failure keeps Open checkout again", async () => {
    renderProgress(
      { kind: "waiting", topup: TOPUP },
      { onOpenCheckout: vi.fn(() => Promise.resolve({ ok: false as const, code: "open_failed" })) },
    );
    await click(button("Open checkout again"));
    expect(screen.queryByText(/can't be reopened here/)).toBeNull();
    expect(button("Open checkout again")).toBeInTheDocument();
  });

  it("shows why a cancel failed, in place", async () => {
    renderProgress(
      { kind: "waiting", topup: TOPUP },
      { onCancel: vi.fn(() => Promise.resolve({ ok: false as const, text: "Couldn't cancel the checkout. Try again." })) },
    );
    await click(button("Cancel"));
    expect(screen.getByText("Couldn't cancel the checkout. Try again.")).toBeInTheDocument();
    expect(button("Cancel")).toBeEnabled();
  });

  it("paid says the credits are on the way", () => {
    renderProgress({ kind: "paid", topup: TOPUP });
    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.getByText("Adding 1,000 credits to this Mac. You don't need to do anything.")).toBeInTheDocument();
    expect(screen.getByText("Paid · adding credits")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You can close the browser tab. Zorvo hears about the payment from PingPay, and checks again every 2 minutes in case that message is late.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("after 20 seconds of paid, says the credits are on the way", () => {
    vi.useFakeTimers();
    try {
      renderProgress({ kind: "paid", topup: TOPUP });
      act(() => vi.advanceTimersByTime(20_000));
      expect(screen.getByText("Paid. Your 1,000 credits are on the way")).toBeInTheDocument();
      expect(
        screen.getByText("NEAR AI is slow to answer right now. Zorvo keeps trying, and you don't need to pay again."),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("credited shows the new balance and starts a private session", async () => {
    const props = renderProgress({ kind: "credited", credits: 1000 });
    const amount = screen.getByRole("status").querySelector("[class*='text-[28px]']");
    expect(amount?.textContent).toBe("+1,000 credits");
    expect(screen.getByRole("status")).not.toHaveTextContent("credits credits");
    expect(screen.getByRole("status").closest("[class*='border-status-running']")).not.toBeNull();
    expect(amount).not.toBeNull();
    expect(screen.getByText("Balance 2,240 credits")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Private sessions use the new credits at once. A notification says so if Zorvo is in the background.",
      ),
    ).toBeInTheDocument();
    await click(button("Start a private session"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("says when the first top-up made the key", () => {
    renderProgress({ kind: "credited", credits: 1000, keyCreated: true });

    expect(screen.getByText("Key saved in your Keychain · first top-up only")).toBeInTheDocument();
  });

  it("failed says nothing was added and offers Try again", async () => {
    const props = renderProgress({ kind: "failed", topupId: "t1" });
    expect(screen.getByText("Your payment didn't go through")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No credits were added. If PingPay received part of it, PingPay handles the refund. You can try again, with another chain or a card.",
      ),
    ).toBeInTheDocument();
    expect(button("Try again").className).toContain("border-border-strong");
    await click(button("Try again"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("expired says the checkout closed", async () => {
    const props = renderProgress({ kind: "expired", topupId: "t1" });
    expect(screen.getByText("Checkout closed without paying")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing was charged. Cancel releases the held credits at once; otherwise they're released after 25 minutes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checkout closed without paying");
    await click(button("Try again"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("waiting for stock says the payment counts", () => {
    renderProgress({ kind: "waiting-stock", topup: TOPUP });
    expect(screen.getByText("Paid. Credits come with the next restock")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The 25-minute hold ran out and the stock sold out meanwhile. Your payment counts, and you're first in line when stock comes back.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Payment received · first in line")).toBeInTheDocument();
  });

  it("a top-up it could not check for long says so, and that a payment may still go through", async () => {
    const props = renderProgress({ kind: "error", code: "topup_unchecked" });
    expect(
      screen.getByText("Couldn't check your top-up. Refresh your balance later to check again."),
    ).toBeInTheDocument();
    expect(screen.getByText("If you started a payment, it may still go through.")).toBeInTheDocument();
    await click(button("Try again"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("an error before any hold claims nothing about a payment", () => {
    renderProgress({ kind: "error", code: "device_cap" });
    expect(screen.getByText("That would take you over your 5,000-credit limit.")).toBeInTheDocument();
    expect(screen.queryByText(/may still go through/)).toBeNull();
    expect(screen.queryByText(/cancel/i)).toBeNull();
    expect(button("Try again")).toBeInTheDocument();
  });

  it("a lasting error while following a top-up says a payment may still go through", async () => {
    const props = renderProgress({ kind: "error", code: "unauthorized" });
    expect(screen.getByText("Your credits moved to another Mac.")).toBeInTheDocument();
    expect(screen.getByText("If you started a payment, it may still go through.")).toBeInTheDocument();
    await click(button("Try again"));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("announces each state in one live region", () => {
    const { rerender } = render(
      <TopupProgress
        flow={{ kind: "opening", usd: 10 }}
        balanceCredits={null}
        onOpenCheckout={() => Promise.resolve({ ok: true })}
        onCancel={() => Promise.resolve({ ok: true })}
        onDismiss={() => {}}
      />,
    );
    const region = screen.getByRole("status");
    rerender(
      <TopupProgress
        flow={{ kind: "paid", topup: TOPUP }}
        balanceCredits={null}
        onOpenCheckout={() => Promise.resolve({ ok: true })}
        onCancel={() => Promise.resolve({ ok: true })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Payment received");
  });
});

describe("Private mode section: resumed top-up", () => {
  it("a checkout that cannot be reopened after a restart offers Cancel only", async () => {
    stockWith();
    readyWith(0, { pendingTopup: { topupId: "t1", expiresAt: "2026-11-07T11:00:00Z", credits: 1000 } });
    fake().errors.private_open_checkout = "not_found";
    await mount();
    await click(await screen.findByRole("button", { name: "Open checkout again" }));
    expect(screen.getByText(/can't be reopened here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open checkout again" })).toBeNull();
    await click(button("Cancel"));
    expect(callsTo("private_cancel_topup")).toHaveLength(1);
    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
  });
});

describe("RecoveryCard", () => {
  const MASKED = "ZRV-••••-••••-••••-••••";

  it("keeps the code masked and reads it only on Show or Copy", async () => {
    stockWith();
    readyWith(100);
    await mount();
    await screen.findByText("100 credits");
    expect(screen.getByText(MASKED)).toBeInTheDocument();
    expect(callsTo("private_recovery_code")).toHaveLength(0);
    expect(document.body).not.toHaveTextContent("ZRV-FAKE-CODE");

    await click(button("Show"));
    expect(callsTo("private_recovery_code")).toHaveLength(1);
    expect(await screen.findByText("ZRV-FAKE-CODE")).toBeInTheDocument();

    // A second press hides it again.
    await click(button("Hide"));
    expect(screen.queryByText("ZRV-FAKE-CODE")).toBeNull();
    expect(screen.getByText(MASKED)).toBeInTheDocument();
  });

  it("Copy writes the code to the clipboard without showing it", async () => {
    stockWith();
    readyWith(100);
    await mount();
    await screen.findByText("100 credits");
    await click(button("Copy"));
    expect(writeText).toHaveBeenCalledWith("ZRV-FAKE-CODE");
    expect(screen.queryByText("ZRV-FAKE-CODE")).toBeNull();
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("is off until this Mac has a device", async () => {
    stockWith();
    await mount();
    await screen.findByText("0 credits");
    expect(button("Show")).toBeDisabled();
    expect(button("Copy")).toBeDisabled();
  });

  it("hides a shown code after 30 seconds and when it unmounts", async () => {
    vi.useFakeTimers();
    const revealCode = vi.fn(() => Promise.resolve("ZRV-ABCD-EFGH-JKLM-NPQR"));
    const { unmount } = render(<RecoveryCard revealCode={revealCode} isAvailable onRestore={() => {}} />);
    await act(async () => {
      fireEvent.click(button("Show"));
    });
    expect(screen.getByText("ZRV-ABCD-EFGH-JKLM-NPQR")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(screen.getByText("ZRV-ABCD-EFGH-JKLM-NPQR")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(screen.queryByText("ZRV-ABCD-EFGH-JKLM-NPQR")).toBeNull();
    unmount();
  });

  it("says why when the code cannot be read", async () => {
    stockWith();
    readyWith(100);
    fake().errors.private_recovery_code = "no_key";
    await mount();
    await screen.findByText("100 credits");
    await click(button("Show"));
    expect(await screen.findByText("This Mac has no private credits yet.")).toBeInTheDocument();
  });
});

describe("RecoveryCodeDialog", () => {
  it("keeps Done off until the code is marked as saved", async () => {
    const markRecovery = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onClose = vi.fn();
    render(
      <RecoveryCodeDialog
        revealCode={() => Promise.resolve("ZRV-AAAA-BBBB-CCCC-DDDD")}
        markRecovery={markRecovery}
        onClose={onClose}
      />,
    );
    expect(await screen.findByText("ZRV-AAAA-BBBB-CCCC-DDDD")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Save your recovery code" })).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText("Anyone with this code can use your credits. Keep it in a password manager, not in a chat."),
    ).toBeInTheDocument();
    expect(button("Done")).toBeDisabled();
    await click(screen.getByRole("checkbox", { name: "I saved it somewhere safe" }));
    expect(button("Done")).toBeEnabled();
    await click(button("Done"));
    expect(markRecovery).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Remind me later marks it as not saved", async () => {
    const markRecovery = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onClose = vi.fn();
    render(<RecoveryCodeDialog revealCode={() => Promise.resolve("ZRV-A")} markRecovery={markRecovery} onClose={onClose} />);
    await screen.findByText("ZRV-A");
    await click(button("Remind me later"));
    expect(markRecovery).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes an initial code and does not read the stored one", async () => {
    const revealCode = vi.fn(() => Promise.resolve("ZRV-OLD"));
    render(
      <RecoveryCodeDialog
        revealCode={revealCode}
        markRecovery={() => Promise.resolve({ ok: true })}
        initialCode="ZRV-NEW"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("ZRV-NEW")).toBeInTheDocument();
    expect(revealCode).not.toHaveBeenCalled();
  });

  it("copies the code", async () => {
    render(
      <RecoveryCodeDialog
        revealCode={() => Promise.resolve("ZRV-A")}
        markRecovery={() => Promise.resolve({ ok: true })}
        onClose={() => {}}
      />,
    );
    await screen.findByText("ZRV-A");
    await click(button("Copy"));
    expect(writeText).toHaveBeenCalledWith("ZRV-A");
  });

  it("stays open and says why when saving the choice fails", async () => {
    const onClose = vi.fn();
    render(
      <RecoveryCodeDialog
        revealCode={() => Promise.resolve("ZRV-A")}
        markRecovery={() => Promise.resolve({ ok: false as const, text: "Couldn't save your settings on this Mac. Try again." })}
        onClose={onClose}
      />,
    );
    await screen.findByText("ZRV-A");
    await click(screen.getByRole("checkbox", { name: "I saved it somewhere safe" }));
    await click(button("Done"));
    expect(screen.getByText("Couldn't save your settings on this Mac. Try again.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows when the code cannot be read", async () => {
    render(
      <RecoveryCodeDialog
        revealCode={() => Promise.reject("keychain")}
        markRecovery={() => Promise.resolve({ ok: true })}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/Couldn't save your key in the Keychain/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I saved it somewhere safe" })).toBeDisabled();
  });

  it("Escape reminds me later and gives focus back", async () => {
    const markRecovery = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onClose = vi.fn();
    render(<RecoveryCodeDialog revealCode={() => Promise.resolve("ZRV-A")} markRecovery={markRecovery} onClose={onClose} />);
    await screen.findByText("ZRV-A");
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(markRecovery).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Restore", () => {
  async function openRestore() {
    await click(await screen.findByRole("button", { name: "Restore…" }));
    return screen.getByRole("dialog", { name: "Restore your credits" });
  }

  it("a code that does not work shows its text and stays open", async () => {
    stockWith();
    readyWith(0);
    fake().errors.private_recover = "bad_code";
    await mount();
    const dialog = await openRestore();
    const input = within(dialog).getByRole("textbox", { name: "Recovery code" });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("autocomplete", "off");
    await type(input, "ZRV-WRONG");
    await click(within(dialog).getByRole("button", { name: "Restore" }));
    expect(within(dialog).getByText("That code doesn't exist, or it has been used up.")).toBeInTheDocument();
    expect(callsTo("private_recover")[0].args).toEqual({ code: "ZRV-WRONG" });
  });

  it("a code that works shows the new recovery code", async () => {
    stockWith();
    readyWith(0);
    await mount();
    const dialog = await openRestore();
    await type(within(dialog).getByRole("textbox", { name: "Recovery code" }), " ZRV-GOOD ");
    await click(within(dialog).getByRole("button", { name: "Restore" }));
    expect(callsTo("private_recover")[0].args).toEqual({ code: "ZRV-GOOD" });
    expect(screen.queryByRole("dialog", { name: "Restore your credits" })).toBeNull();
    expect(await screen.findByRole("dialog", { name: "Save your recovery code" })).toBeInTheDocument();
    expect(screen.getByText("ZRV-NEW-CODE")).toBeInTheDocument();
    // The stored code is not read: the new one came with the answer.
    expect(callsTo("private_recovery_code")).toHaveLength(0);
  });

  it("keeps Restore off for an empty code and closes on Cancel and Escape", async () => {
    stockWith();
    readyWith(0);
    await mount();
    const dialog = await openRestore();
    expect(within(dialog).getByRole("button", { name: "Restore" })).toBeDisabled();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Restore your credits" })).toBeNull();
    await openRestore();
    await click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Restore your credits" })).toBeNull();
  });

  it("does not close on Escape while a restore runs", async () => {
    stockWith();
    readyWith(0);
    let release: () => void = () => {};
    fake().holds.private_recover = new Promise<void>((resolve) => (release = resolve));
    await mount();
    const dialog = await openRestore();
    await type(within(dialog).getByRole("textbox", { name: "Recovery code" }), "ZRV-GOOD");
    await click(within(dialog).getByRole("button", { name: "Restore" }));
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByRole("dialog", { name: "Restore your credits" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => release());
  });
});

describe("Private mode: the catalog loads only when Settings shows it", () => {
  it("the hook and an app without Settings read the status and nothing else", async () => {
    await act(async () => {
      render(<AppWithoutSettings />);
    });
    expect(fake().calls.map((call) => call.cmd)).toEqual(["private_status"]);
  });

  it("mounting the section loads the stock and the models once each", async () => {
    stockWith();
    await mount();
    await screen.findByRole("radio", { name: /\$5\b/ });
    expect(callsTo("private_stock")).toHaveLength(1);
    expect(callsTo("private_models")).toHaveLength(1);
    expect(callsTo("private_status")).toHaveLength(1);
  });

  it("a stock failure says so with a Try again that loads the packages", async () => {
    stockWith();
    fake().errors.private_stock = "unreachable";
    await mount();
    expect(await screen.findByText("Couldn't load the packages. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Loading packages…")).toBeNull();
    delete fake().errors.private_stock;
    await click(button("Try again"));
    expect(await screen.findByRole("radio", { name: /\$5\b/ })).toBeInTheDocument();
    expect(callsTo("private_stock")).toHaveLength(2);
    expect(screen.queryByText("Couldn't load the packages. Try again.")).toBeNull();
  });

  it("says Loading packages only while the load is in flight", async () => {
    stockWith();
    fake().errors.private_stock = "unreachable";
    await mount();
    await screen.findByText("Couldn't load the packages. Try again.");
    let release: () => void = () => {};
    fake().holds.private_stock = new Promise<void>((resolve) => (release = resolve));
    await click(button("Try again"));
    expect(screen.getByText("Loading packages…")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the packages. Try again.")).toBeNull();
    await act(async () => release());
  });
});

describe("Private mode: one hold at a time", () => {
  it("Restore… is off, with its reason, while a top-up is followed", async () => {
    stockWith();
    readyWith(0, { pendingTopup: { topupId: "t1", expiresAt: "2026-11-07T11:00:00Z", credits: 1000 } });
    await mount();
    const restore = await screen.findByRole("button", { name: "Restore…" });
    expect(restore).toBeDisabled();
    expect(restore).toHaveAccessibleDescription("Finish or cancel your top-up first.");
    // The reason is on screen too, not only for a screen reader or on hover.
    const reason = screen.getByText("Finish or cancel your top-up first.");
    expect(reason.closest(".sr-only")).toBeNull();
    expect(restore).not.toHaveAttribute("title");
  });

  it("Open checkout again takes one press at a time", async () => {
    let release: () => void = () => {};
    const onOpenCheckout = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => (release = () => resolve({ ok: true }))),
    );
    renderProgress({ kind: "waiting", topup: TOPUP }, { onOpenCheckout });
    await click(button("Open checkout again"));
    expect(button("Open checkout again")).toBeDisabled();
    await click(button("Open checkout again"));
    expect(onOpenCheckout).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(button("Open checkout again")).toBeEnabled();
  });
});

describe("Private mode: used by model", () => {
  const GLM = { id: "zai/GLM-5.3-Flash", inputPerM: 0.1, outputPerM: 0.2 };

  function privateSession(id: string, modelId: string, credits: number): Session {
    return {
      id,
      name: "Private review",
      profileId: "qwen-code",
      cwd: "/w",
      status: "running",
      createdAt: 1,
      transport: "acp",
      privateMode: { modelId },
      privateUsage: { credits, estimated: false },
    };
  }

  it("lists the persisted totals grouped by model, with turns left from the balance", async () => {
    stockWith();
    fake().models = [MODEL, GLM];
    readyWith(1_240);
    await mount({
      sessions: [privateSession("s-1", MODEL.id, 210), privateSession("s-2", GLM.id, 50)],
      agentNameOf: () => "Qwen Code",
    });

    const details = await screen.findByText("Used by 2 models");
    expect(details.parentElement).toHaveTextContent("260 credits");
    await click(details);

    expect(screen.getByText("Qwen Code · Qwen 3.8 27B")).toBeInTheDocument();
    expect(screen.getByText("210 used")).toBeInTheDocument();
    expect(screen.getByText(`≈ ${turnsFor(1_240, MODEL).toLocaleString("en-US")} turns left`)).toBeInTheDocument();
    expect(screen.getByText("Qwen Code · GLM 5.3 Flash")).toBeInTheDocument();
    expect(screen.getByText("50 used")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sessions running at the same time draw from this balance together. Give a session its own cap in its draft.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Private mode: your own NEAR AI key", () => {
  const waitForCheck = () => act(async () => new Promise((resolve) => setTimeout(resolve, 450)));

  it("checks a pasted key, saves it, and switches private sessions to it", async () => {
    stockWith();
    readyWith(1_240);
    const onPaymentSourceChange = vi.fn();
    await mount({ onPaymentSourceChange });

    await click(button("Add key"));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("NEAR AI key"), { target: { value: "own-key-3f9a" } });
    });
    await waitForCheck();
    expect(screen.getByText("NEAR AI accepted this key")).toBeInTheDocument();

    await click(button("Use this key"));
    await waitFor(() => expect(onPaymentSourceChange).toHaveBeenCalledWith("ownKey"));
    expect(screen.getByText(/sk-••••••••3f9a · added today/)).toBeInTheDocument();
    expect(callsTo("private_set_own_key")[0].args).toEqual({ key: "own-key-3f9a" });
    expect(screen.getByRole("radio", { name: "My NEAR AI key" })).toHaveAttribute("aria-checked", "true");

    await click(button("Remove key"));
    await waitFor(() => expect(onPaymentSourceChange).toHaveBeenLastCalledWith("credits"));
    expect(screen.queryByText(/sk-••••••••3f9a/)).toBeNull();
    expect(callsTo("private_remove_own_key")).toHaveLength(1);
  });

  it("keeps the key and says so when the Keychain refuses to remove it", async () => {
    stockWith();
    readyWith(1_240, {
      ownKey: { saved: true, last4: "3f9a", addedAt: new Date().toISOString(), noCredits: false },
    });
    fake().errors.private_remove_own_key = "keychain";
    await mount({ paymentSource: "ownKey" });

    await click(button("Remove key"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't remove the key from your Keychain. Try again.",
    );
    expect(screen.getByText(/sk-••••••••3f9a/)).toBeInTheDocument();
  });

  it("replaces the balance with paying-with text when the own key is the source", async () => {
    stockWith();
    readyWith(1_240);
    fake().status = {
      ...fake().status,
      ownKey: { saved: true, last4: "3f9a", addedAt: new Date().toISOString(), noCredits: false },
    };
    await mount({ paymentSource: "ownKey" });

    expect(screen.getByText("Paying with your NEAR AI key")).toBeInTheDocument();
    expect(screen.queryByText("1,240 credits")).toBeNull();
  });

  it("saves a key NEAR AI accepts with no credits, and warns", async () => {
    stockWith();
    readyWith(1_240);
    fake().checkOwnKey = "no_credits";
    await mount();

    await click(button("Add key"));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("NEAR AI key"), { target: { value: "own-key-3f9a" } });
    });
    await waitForCheck();
    expect(
      screen.getByText("NEAR AI accepted this key, but your organization has no credits yet."),
    ).toBeInTheDocument();
    await click(button("Use this key"));
    expect(await screen.findByText("NEAR AI has no credits for this key yet.")).toBeInTheDocument();
  });

  it("refuses to save a key NEAR AI rejects", async () => {
    stockWith();
    readyWith(1_240);
    fake().errors.private_check_own_key = "unauthorized";
    await mount();

    await click(button("Add key"));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("NEAR AI key"), { target: { value: "sk-wrong" } });
    });
    await waitForCheck();
    expect(screen.getByText("NEAR AI didn't accept this key.")).toBeInTheDocument();
    expect(button("Use this key")).toBeDisabled();
  });
});

describe("Private mode: the secret guard switch", () => {
  it("is on by default, explains its limit, and reports turning it off", async () => {
    stockWith();
    readyWith(1_240);
    const onChange = vi.fn();
    await mount({ onSecretGuardChange: onChange });

    const toggle = await screen.findByRole("switch", { name: "Check messages for secrets before sending" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "Zorvo looks for keys and passwords in what you send, on this Mac. The agent can still read files in the folder itself.",
      ),
    ).toBeInTheDocument();
    await click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("draws the off state when the setting is off", async () => {
    stockWith();
    readyWith(1_240);
    await mount({ secretGuard: false });

    const toggle = await screen.findByRole("switch", { name: "Check messages for secrets before sending" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.className).toContain("justify-start");
  });
});
