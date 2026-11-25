import { useState } from "react";
import { BROWSER_MAX_WIDTH, clampInspectorWidth, INSPECTOR_WIDTH } from "../lib/inspector";

/**
 * Kept in the webview's storage rather than state.json: it is this device's
 * preference, and losing it only brings the initial width back. The Browser tab
 * keeps its own, since a page wants far more room than a list of changes.
 */
const KINDS = {
  inspector: { key: "zorvo.inspectorWidth", max: INSPECTOR_WIDTH.max, initial: INSPECTOR_WIDTH.initial },
  browser: { key: "zorvo.browserWidth", max: BROWSER_MAX_WIDTH, initial: INSPECTOR_WIDTH.wide },
} as const;

type WidthKind = keyof typeof KINDS;

function readWidth(kind: WidthKind): number {
  const { key, max, initial } = KINDS[kind];
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : clampInspectorWidth(Number(stored), max, initial);
  } catch {
    return initial;
  }
}

/** The inspector's width, or the Browser tab's, remembered between runs; every value is clamped to its bounds. */
export function useInspectorWidth(kind: WidthKind = "inspector"): [width: number, setWidth: (px: number) => void] {
  const [width, setStoredWidth] = useState(() => readWidth(kind));
  const setWidth = (px: number) => {
    const { key, max, initial } = KINDS[kind];
    const next = clampInspectorWidth(px, max, initial);
    setStoredWidth(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Storage blocked: the width still applies for this run.
    }
  };
  return [width, setWidth];
}
