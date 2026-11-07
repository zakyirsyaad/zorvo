import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SettingsTab } from "../components/settings/SettingsNav";

export interface SettingsPage {
  /** The section on screen, or null while the sessions show. */
  section: SettingsTab | null;
  /** Shows Settings on `section`, from a session; remembers the control that asked, for Back. */
  open: (section: SettingsTab) => void;
  /** Moves to another section while Settings shows. */
  select: (section: SettingsTab) => void;
  /** Back to sessions. */
  close: () => void;
}

/**
 * Which Settings section shows, if any, and where focus goes on Back: the control that opened Settings
 * when it is still in the page, else `fallbackFocusRef` (the sidebar footer's Settings button). A
 * Manage agents in a menu that has closed since is the usual case for the fallback.
 */
export function useSettingsPage(fallbackFocusRef: RefObject<HTMLElement | null>): SettingsPage {
  const [section, setSection] = useState<SettingsTab | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const isReturningRef = useRef(false);
  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = section !== null;
  }, [section]);

  const open = useCallback((next: SettingsTab) => {
    if (!isOpenRef.current) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      isOpenRef.current = true;
    }
    setSection(next);
  }, []);

  const close = useCallback(() => {
    isReturningRef.current = true;
    setSection(null);
  }, []);

  // After the sessions show again: their elements are focusable once more.
  useEffect(() => {
    if (section !== null || !isReturningRef.current) return;
    isReturningRef.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    const target = opener?.isConnected ? opener : fallbackFocusRef.current;
    target?.focus();
  }, [section, fallbackFocusRef]);

  return { section, open, select: setSection, close };
}
