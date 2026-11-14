import { useEffect, useRef } from 'react';
import { isAppFocused } from '../lib/notify';
import { creditedNoticeText } from '../lib/private-credits';
import type { NoticeTone } from './useNotice';
import type { TopupFlow } from './usePrivateCredits';

/**
 * Says in the window, once per credit, that a top-up's credits arrived while Settings → Private
 * mode is not on screen and the app has focus: a top-up followed from before (or left behind when
 * the user moved on) lands where no one sees it otherwise. While the app is away the system
 * notification says it instead (`notifyIfAway`, same focus test). With that section on screen
 * (`isTopupShown`) the top-up shows its own result, and that credit is not announced again later.
 * `offerNotice` must keep an error that is on screen (`useNotice().offerNotice` does).
 */
export function usePrivateCreditedNotice(
  flow: TopupFlow,
  isTopupShown: boolean,
  offerNotice: (message: string, tone?: NoticeTone) => void,
  isFocused: () => Promise<boolean> = isAppFocused,
): void {
  // The credited flow last seen: each credit makes a new one, and StrictMode's second run sees it again.
  const seen = useRef<TopupFlow | null>(null);
  useEffect(() => {
    if (flow.kind !== 'credited' || seen.current === flow) return;
    seen.current = flow;
    if (isTopupShown) return;
    const text = creditedNoticeText(flow.credits);
    // A focus test that fails says nothing: the notice is a convenience.
    void isFocused()
      .then((hasFocus) => {
        if (hasFocus) offerNotice(text, 'info');
      })
      .catch(() => undefined);
  }, [flow, isTopupShown, offerNotice, isFocused]);
}
