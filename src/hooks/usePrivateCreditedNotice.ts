import { useEffect, useRef } from 'react';
import { creditedNoticeText } from '../lib/private-credits';
import type { NoticeTone } from './useNotice';
import type { TopupFlow } from './usePrivateCredits';

/**
 * Says in the window, once per credit, that a top-up's credits arrived while Settings → Private
 * mode is not on screen: a top-up followed from before (or left behind when the user moved on)
 * lands where no one sees it otherwise, since the system notification shows only while the app is
 * away. With that section on screen (`isTopupShown`) the top-up shows its own result, and that
 * credit is not announced again later.
 */
export function usePrivateCreditedNotice(
  flow: TopupFlow,
  isTopupShown: boolean,
  setNotice: (message: string, tone?: NoticeTone) => void,
): void {
  // The credited flow last seen: each credit makes a new one, and StrictMode's second run sees it again.
  const seen = useRef<TopupFlow | null>(null);
  useEffect(() => {
    if (flow.kind !== 'credited' || seen.current === flow) return;
    seen.current = flow;
    if (!isTopupShown) setNotice(creditedNoticeText(flow.credits), 'info');
  }, [flow, isTopupShown, setNotice]);
}
