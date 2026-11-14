import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve("granted")),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: vi.fn(() => Promise.resolve([])) }));

import { sendNotification } from "@tauri-apps/plugin-notification";
import { usePrivateLowBalanceNotice } from "../hooks/usePrivateLowBalanceNotice";

async function renderAt(credits: number | null, notified: boolean) {
  const onNotified = vi.fn();
  const view = renderHook(
    (props: { credits: number | null; notified: boolean }) =>
      usePrivateLowBalanceNotice({ ...props, onNotified }),
    { initialProps: { credits, notified } },
  );
  return { view, onNotified };
}

async function change(view: Awaited<ReturnType<typeof renderAt>>["view"], credits: number | null, notified: boolean) {
  await act(async () => {
    view.rerender({ credits, notified });
    await Promise.resolve();
  });
}

const NOTICE = {
  title: "Zorvo Private credits are low",
  body: "40 credits left. Top up to keep private sessions running.",
};

describe("usePrivateLowBalanceNotice", () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockClear();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies once on 60 → 40 and not again below it", async () => {
    const { view, onNotified } = await renderAt(60, false);

    await change(view, 40, false);
    expect(onNotified).toHaveBeenCalledWith(true);
    await waitFor(() => expect(sendNotification).toHaveBeenCalledWith(NOTICE));

    await change(view, 40, true);
    await change(view, 30, true);

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("does not notify on a reload with the flag already set", async () => {
    await renderAt(40, true);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("waits for the first known balance, then notifies below 50", async () => {
    const { view, onNotified } = await renderAt(null, false);

    expect(sendNotification).not.toHaveBeenCalled();
    await change(view, 40, false);

    expect(onNotified).toHaveBeenCalledWith(true);
    await waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
  });

  it("re-arms after a balance of 50 or more", async () => {
    const { view, onNotified } = await renderAt(40, true);

    await change(view, 120, true);
    expect(onNotified).toHaveBeenCalledWith(false);

    await change(view, 40, false);
    await waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
  });

  it("marks a focused crossing handled without showing a system notification", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { view, onNotified } = await renderAt(60, false);

    await change(view, 40, false);

    expect(onNotified).toHaveBeenCalledWith(true);
    await waitFor(() => expect(sendNotification).not.toHaveBeenCalled());
  });
});