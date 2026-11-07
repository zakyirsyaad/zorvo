import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../lib/notify", () => ({ notifyIfAway: vi.fn(() => Promise.resolve()) }));

import { PrivateSection } from "../components/settings/PrivateSection";
import { RecoveryCodeLayer } from "../components/private/RecoveryCodeLayer";
import { usePrivateCredits, type PrivateCredits } from "../hooks/usePrivateCredits";
import { usePrivateRecoveryDialog } from "../hooks/usePrivateRecoveryDialog";
import type { FakePrivate } from "./fixtures/private-backend";

function fake(): FakePrivate {
  return (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__;
}

function callsTo(cmd: string) {
  return fake().calls.filter((call) => call.cmd === cmd);
}

const FRESH = { updatedAt: "2026-11-07T10:00:00Z" };

/** A device without credits, its recovery code already dealt with. */
function emptyDevice(extra: Partial<FakePrivate["status"]> = {}) {
  fake().status = {
    ...fake().status,
    device: "ready",
    keyReady: true,
    balance: { credits: 0, usedCredits: 0, keyReady: true, ...FRESH },
    recoverySaved: true,
    recoveryPrompted: true,
    ...extra,
  };
}

/** The status the service leaves after a restore that brought credits: the recovery flags are reset. */
function creditsLanded(): FakePrivate["status"] {
  return {
    ...fake().status,
    device: "ready",
    keyReady: true,
    balance: { credits: 500, usedCredits: 0, keyReady: true, ...FRESH },
    recoverySaved: false,
    recoveryPrompted: false,
  };
}

let latest: PrivateCredits | null = null;

/** What App does with Settings open: the hook, the section, and the one recovery layer. */
function Harness() {
  const credits = usePrivateCredits();
  const dialog = usePrivateRecoveryDialog();
  latest = credits;
  return (
    <>
      <PrivateSection credits={credits} onShowRecoveryCode={dialog.show} onRestoringChange={dialog.setIsRestoring} />
      <RecoveryCodeLayer
        credits={credits}
        request={dialog.request}
        suppressStatusPrompt={dialog.suppressStatusPrompt}
        onClose={dialog.close}
      />
    </>
  );
}

async function mount() {
  await act(async () => {
    render(<Harness />);
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function pressEscape() {
  await act(async () => {
    fireEvent.keyDown(document, { key: "Escape" });
  });
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

async function openRestore() {
  const opener = await screen.findByRole("button", { name: "Restore…" });
  opener.focus();
  await click(opener);
  return { opener, dialog: screen.getByRole("dialog", { name: "Restore your credits" }) };
}

async function typeAndRestore(dialog: HTMLElement, code: string) {
  await act(async () => {
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Recovery code" }), { target: { value: code } });
  });
  await click(within(dialog).getByRole("button", { name: "Restore" }));
}

describe("dialog focus", () => {
  it("the stored-code dialog takes focus before the code arrives, then moves it to Copy", async () => {
    emptyDevice({ recoverySaved: false, recoveryPrompted: true });
    let release: () => void = () => {};
    fake().holds.private_recovery_code = new Promise<void>((resolve) => (release = resolve));
    await mount();
    const note = await screen.findByRole("button", { name: "Save your recovery code" });
    note.focus();
    await click(note);

    const dialog = screen.getByRole("dialog", { name: "Save your recovery code" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeDisabled();

    await act(async () => release());
    expect(await within(dialog).findByText("ZRV-FAKE-CODE")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy" })).toHaveFocus();
  });

  it("leaves focus alone once the user has moved it before the code arrives", async () => {
    emptyDevice({ recoverySaved: false, recoveryPrompted: true });
    let release: () => void = () => {};
    fake().holds.private_recovery_code = new Promise<void>((resolve) => (release = resolve));
    await mount();
    await click(await screen.findByRole("button", { name: "Save your recovery code" }));
    const dialog = screen.getByRole("dialog", { name: "Save your recovery code" });
    within(dialog).getByRole("button", { name: "Remind me later" }).focus();
    await act(async () => release());
    await within(dialog).findByText("ZRV-FAKE-CODE");
    expect(within(dialog).getByRole("button", { name: "Remind me later" })).toHaveFocus();
  });

  it("gives focus back to the control that opened the stored-code dialog", async () => {
    emptyDevice({ recoverySaved: false, recoveryPrompted: true });
    await mount();
    const note = await screen.findByRole("button", { name: "Save your recovery code" });
    note.focus();
    await click(note);
    await screen.findByText("ZRV-FAKE-CODE");
    await click(button("Remind me later"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Save your recovery code" })).toHaveFocus();
  });

  it("the Restore dialog takes focus on its field and gives it back on Cancel", async () => {
    emptyDevice();
    await mount();
    const { opener, dialog } = await openRestore();
    expect(within(dialog).getByRole("textbox", { name: "Recovery code" })).toHaveFocus();
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe("one dialog at a time around a restore", () => {
  it("a restore that brings credits shows only the new code, reads no stored one, and marks it once", async () => {
    emptyDevice();
    fake().statusAfterRecover = creditsLanded();
    let release: () => void = () => {};
    fake().holds.private_recover = new Promise<void>((resolve) => (release = resolve));
    await mount();
    const { dialog } = await openRestore();
    await typeAndRestore(dialog, "ZRV-GOOD");

    // Escape during the running restore reaches nobody.
    await pressEscape();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(callsTo("private_mark_recovery")).toHaveLength(0);

    await act(async () => release());
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName("Save your recovery code");
    expect(within(dialogs[0]).getByText("ZRV-NEW-CODE")).toBeInTheDocument();
    expect(callsTo("private_recovery_code")).toHaveLength(0);
    expect(callsTo("private_mark_recovery")).toHaveLength(0);

    await click(within(dialogs[0]).getByRole("checkbox", { name: "I saved it somewhere safe" }));
    await click(within(dialogs[0]).getByRole("button", { name: "Done" }));
    expect(callsTo("private_mark_recovery")).toHaveLength(1);
    expect(callsTo("private_mark_recovery")[0].args).toEqual({ saved: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo("private_recovery_code")).toHaveLength(0);
  });

  it("Escape on a restore's new code marks nothing and keeps the code on screen", async () => {
    emptyDevice();
    fake().statusAfterRecover = creditsLanded();
    await mount();
    const { dialog } = await openRestore();
    await typeAndRestore(dialog, "ZRV-GOOD");
    const newCode = screen.getByRole("dialog", { name: "Save your recovery code" });

    await pressEscape();

    expect(callsTo("private_mark_recovery")).toHaveLength(0);
    expect(newCode).toBeInTheDocument();
    expect(within(newCode).getByText("ZRV-NEW-CODE")).toBeInTheDocument();
  });

  it("Escape on the stored code's prompt still means Remind me later", async () => {
    emptyDevice({ recoverySaved: false, recoveryPrompted: true });
    await mount();
    await click(await screen.findByRole("button", { name: "Save your recovery code" }));
    await screen.findByText("ZRV-FAKE-CODE");

    await pressEscape();

    expect(callsTo("private_mark_recovery").map((call) => call.args)).toEqual([{ saved: false }]);
  });

  it("gives focus back to Restore… once the restore's new code is dealt with", async () => {
    emptyDevice();
    fake().statusAfterRecover = creditsLanded();
    await mount();
    const { opener, dialog } = await openRestore();
    await typeAndRestore(dialog, "ZRV-GOOD");
    const newCode = screen.getByRole("dialog", { name: "Save your recovery code" });

    await click(within(newCode).getByRole("button", { name: "Remind me later" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("a credit that lands under an open Restore dialog adds no second dialog", async () => {
    emptyDevice();
    await mount();
    await openRestore();
    fake().status = creditsLanded();
    await act(async () => {
      await latest?.refresh(true);
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Restore your credits");
    expect(callsTo("private_recovery_code")).toHaveLength(0);

    // Escape reaches only the top (and only) dialog.
    await pressEscape();
    expect(callsTo("private_mark_recovery")).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "Restore your credits" })).toBeNull();

    // With the restore out of the way the saved-code prompt may show, once.
    const prompt = await screen.findByRole("dialog", { name: "Save your recovery code" });
    expect(await within(prompt).findByText("ZRV-FAKE-CODE")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("RecoveryCodeLayer", () => {
  const credits = (needsRecoveryDialog: boolean) => ({
    needsRecoveryDialog,
    revealCode: vi.fn(() => Promise.resolve("ZRV-STORED")),
    markRecovery: vi.fn(() => Promise.resolve({ ok: true as const })),
  });

  it("draws nothing for the status prompt while a restore is on screen", async () => {
    const c = credits(true);
    await act(async () => {
      render(<RecoveryCodeLayer credits={c} request={null} suppressStatusPrompt onClose={() => {}} />);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(c.revealCode).not.toHaveBeenCalled();
  });

  it("draws the status prompt once the restore is out of the way", async () => {
    const c = credits(true);
    await act(async () => {
      render(<RecoveryCodeLayer credits={c} request={null} suppressStatusPrompt={false} onClose={() => {}} />);
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(c.revealCode).toHaveBeenCalledTimes(1);
  });

  it("a request with a new code is the only dialog, and the stored code is not read", async () => {
    const c = credits(true);
    await act(async () => {
      render(
        <RecoveryCodeLayer credits={c} request={{ id: 1, code: "ZRV-NEW" }} suppressStatusPrompt onClose={() => {}} />,
      );
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("ZRV-NEW")).toBeInTheDocument();
    expect(c.revealCode).not.toHaveBeenCalled();
  });

  it("never uses the code as the dialog's key", () => {
    const source = readFileSync(join(__dirname, "../components/private/RecoveryCodeLayer.tsx"), "utf8");
    expect(source).not.toMatch(/key=\{[^}]*code/);
  });
});
