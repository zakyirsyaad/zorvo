import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePrivateCreditedNotice } from "../hooks/usePrivateCreditedNotice";
import type { TopupFlow } from "../hooks/usePrivateCredits";

const WAITING: TopupFlow = {
  kind: "waiting",
  topup: { topupId: "saved-3", expiresAt: "2026-11-07T11:00:00Z", credits: 500 },
};

function renderNotice(flow: TopupFlow, isSettingsOpen: boolean) {
  const setNotice = vi.fn();
  const view = renderHook(
    (props: { flow: TopupFlow; isSettingsOpen: boolean }) =>
      usePrivateCreditedNotice(props.flow, props.isSettingsOpen, setNotice),
    { initialProps: { flow, isSettingsOpen } },
  );
  return { ...view, setNotice };
}

describe("usePrivateCreditedNotice", () => {
  it("says once that the credits arrived when a top-up lands while Settings is closed", () => {
    const { rerender, setNotice } = renderNotice(WAITING, false);
    const credited: TopupFlow = { kind: "credited", credits: 500 };

    rerender({ flow: credited, isSettingsOpen: false });
    rerender({ flow: credited, isSettingsOpen: false });

    expect(setNotice).toHaveBeenCalledTimes(1);
    expect(setNotice).toHaveBeenCalledWith("+500 credits. Private sessions can use them now.", "info");
  });

  it("says nothing while Settings shows the top-up's own result", () => {
    const { rerender, setNotice } = renderNotice(WAITING, true);

    rerender({ flow: { kind: "credited", credits: 500 }, isSettingsOpen: true });

    expect(setNotice).not.toHaveBeenCalled();
  });

  it("says nothing for a credit already shown when Settings closes after it", () => {
    const credited: TopupFlow = { kind: "credited", credits: 500 };
    const { rerender, setNotice } = renderNotice(WAITING, true);
    rerender({ flow: credited, isSettingsOpen: true });

    rerender({ flow: credited, isSettingsOpen: false });

    expect(setNotice).not.toHaveBeenCalled();
  });

  it("says it again for the next top-up's credit", () => {
    const { rerender, setNotice } = renderNotice(WAITING, false);
    rerender({ flow: { kind: "credited", credits: 500 }, isSettingsOpen: false });
    rerender({ flow: { kind: "idle" }, isSettingsOpen: false });
    rerender({ flow: WAITING, isSettingsOpen: false });

    rerender({ flow: { kind: "credited", credits: 1000 }, isSettingsOpen: false });

    expect(setNotice).toHaveBeenCalledTimes(2);
    expect(setNotice).toHaveBeenLastCalledWith("+1,000 credits. Private sessions can use them now.", "info");
  });
});
