import { useCallback, useState } from "react";

/** An error is something that failed; a warning asks the user to do something first; info only tells. */
export type NoticeTone = "error" | "warning" | "info";

export interface Notice {
  message: string;
  tone: NoticeTone;
}

/**
 * The main window's one notice, shown as a toast. `setNotice` keeps one identity for the
 * window's life, since many hooks take it as their `onNotice`; a notice is an error unless
 * the caller says it is a warning.
 */
export function useNotice(): {
  notice: Notice | null;
  setNotice: (message: string | null, tone?: NoticeTone) => void;
  /** Shows a notice that only tells something, unless an error is on screen: that one stays. */
  offerNotice: (message: string, tone?: NoticeTone) => void;
} {
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const setNotice = useCallback((message: string | null, tone: NoticeTone = "error") => {
    setNoticeState(message === null ? null : { message, tone });
  }, []);
  const offerNotice = useCallback((message: string, tone: NoticeTone = "info") => {
    setNoticeState((current) => (current?.tone === "error" ? current : { message, tone }));
  }, []);
  return { notice, setNotice, offerNotice };
}
