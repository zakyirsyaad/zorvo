import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePrivateCreditedNotice } from "../hooks/usePrivateCreditedNotice";
import { useNotice } from "../hooks/useNotice";
import type { TopupFlow } from "../hooks/usePrivateCredits";

const WAITING: TopupFlow = {
  kind: "waiting",
  topup: { topupId: "saved-3", expiresAt: "2026-11-07T11:00:00Z", credits: 500 },
};

const focused = () => Promise.resolve(true);
const away = () => Promise.resolve(false);

async function renderNotice(flow: TopupFlow, isTopupShown: boolean, isFocused = focused) {
  const offerNotice = vi.fn();
  const view = renderHook(
    (props: { flow: TopupFlow; isTopupShown: boolean }) =>
      usePrivateCreditedNotice(props.flow, props.isTopupShown, offerNotice, isFocused),
    { initialProps: { flow, isTopupShown } },
  );
  const rerender = async (props: { flow: TopupFlow; isTopupShown: boolean }) => {
    await act(async () => view.rerender(props));
  };
  return { rerender, offerNotice };
}

describe("usePrivateCreditedNotice", () => {
  it("says once that the credits arrived when a top-up lands while Private mode is not on screen", async () => {
    const { rerender, offerNotice } = await renderNotice(WAITING, false);
    const credited: TopupFlow = { kind: "credited", credits: 500 };

    await rerender({ flow: credited, isTopupShown: false });
    await rerender({ flow: credited, isTopupShown: false });

    expect(offerNotice).toHaveBeenCalledTimes(1);
    expect(offerNotice).toHaveBeenCalledWith("+500 credits. Private sessions can use them now.", "info");
  });

  it("says nothing while Settings shows the top-up's own result", async () => {
    const { rerender, offerNotice } = await renderNotice(WAITING, true);

    await rerender({ flow: { kind: "credited", credits: 500 }, isTopupShown: true });

    expect(offerNotice).not.toHaveBeenCalled();
  });

  it("says nothing for a credit already shown when Settings closes after it", async () => {
    const credited: TopupFlow = { kind: "credited", credits: 500 };
    const { rerender, offerNotice } = await renderNotice(WAITING, true);
    await rerender({ flow: credited, isTopupShown: true });

    await rerender({ flow: credited, isTopupShown: false });

    expect(offerNotice).not.toHaveBeenCalled();
  });

  it("says it again for the next top-up's credit", async () => {
    const { rerender, offerNotice } = await renderNotice(WAITING, false);
    await rerender({ flow: { kind: "credited", credits: 500 }, isTopupShown: false });
    await rerender({ flow: { kind: "idle" }, isTopupShown: false });
    await rerender({ flow: WAITING, isTopupShown: false });

    await rerender({ flow: { kind: "credited", credits: 1000 }, isTopupShown: false });

    expect(offerNotice).toHaveBeenCalledTimes(2);
    expect(offerNotice).toHaveBeenLastCalledWith("+1,000 credits. Private sessions can use them now.", "info");
  });

  it("leaves a credit that lands while the app is away to the system notification", async () => {
    const { rerender, offerNotice } = await renderNotice(WAITING, false, away);

    await rerender({ flow: { kind: "credited", credits: 500 }, isTopupShown: false });

    expect(offerNotice).not.toHaveBeenCalled();
  });

  it("never replaces an error on screen, and replaces anything else", async () => {
    const view = renderHook(
      (props: { flow: TopupFlow }) => {
        const notices = useNotice();
        usePrivateCreditedNotice(props.flow, false, notices.offerNotice, focused);
        return notices;
      },
      { initialProps: { flow: WAITING as TopupFlow } },
    );
    act(() => view.result.current.setNotice("Could not open the link: boom"));

    await act(async () => view.rerender({ flow: { kind: "credited", credits: 500 } }));
    expect(view.result.current.notice).toEqual({ message: "Could not open the link: boom", tone: "error" });

    act(() => view.result.current.setNotice("Pick a folder first.", "warning"));
    await act(async () => view.rerender({ flow: { kind: "credited", credits: 700 } }));
    expect(view.result.current.notice).toEqual({
      message: "+700 credits. Private sessions can use them now.",
      tone: "info",
    });
  });
});
