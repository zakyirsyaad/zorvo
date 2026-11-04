import { useState } from "react";
import { clampInspectorWidth, INSPECTOR_WIDTH } from "../lib/inspector";

/**
 * Kept in the webview's storage rather than state.json: it is this device's
 * preference, and losing it only brings the initial width back.
 */
const KEY = "zorvo.inspectorWidth";

function readWidth(): number {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? INSPECTOR_WIDTH.initial : clampInspectorWidth(Number(stored));
  } catch {
    return INSPECTOR_WIDTH.initial;
  }
}

/** The inspector's width, remembered between runs; every value is clamped to its bounds. */
export function useInspectorWidth(): [width: number, setWidth: (px: number) => void] {
  const [width, setStoredWidth] = useState(readWidth);
  const setWidth = (px: number) => {
    const next = clampInspectorWidth(px);
    setStoredWidth(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // Storage blocked: the width still applies for this run.
    }
  };
  return [width, setWidth];
}
