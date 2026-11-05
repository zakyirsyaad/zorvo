import { useCallback, useState } from "react";

/** An error is something that failed; a warning asks the user to do something first. */
export type NoticeTone = "error" | "warning";

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
} {
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const setNotice = useCallback((message: string | null, tone: NoticeTone = "error") => {
    setNoticeState(message === null ? null : { message, tone });
  }, []);
  return { notice, setNotice };
}
