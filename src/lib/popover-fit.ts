/** The vertical span of a box on screen. */
export interface VerticalBox {
  top: number;
  bottom: number;
}

export type PopoverSide = "bottom" | "top";

/** Where an open panel goes: its side of the trigger, and a height cap when it does not fit there whole. */
export interface PanelFit {
  side: PopoverSide;
  maxHeight?: number;
}

/** The panel's `mt-1` / `mb-1` from its trigger. */
const TRIGGER_GAP = 4;
/** Room kept between the panel and the edge that clips it. */
const EDGE_MARGIN = 8;
/** A capped panel is never shorter than this: about three rows and a heading. */
const MIN_PANEL_HEIGHT = 96;

/**
 * Picks the side a panel opens on and caps it, so the box that clips it (the main area's scrolling column) never
 * cuts it off: the asked-for side when the panel fits there, else the side with more room, capped to that room.
 * Without a layout (a trigger or bounds with no height, as in jsdom) it decides nothing.
 */
export function fitPanel(trigger: VerticalBox, bounds: VerticalBox, panelHeight: number, preferred: PopoverSide): PanelFit | null {
  if (trigger.bottom - trigger.top <= 0 || bounds.bottom - bounds.top <= 0) return null;
  const room = {
    bottom: bounds.bottom - trigger.bottom - TRIGGER_GAP - EDGE_MARGIN,
    top: trigger.top - bounds.top - TRIGGER_GAP - EDGE_MARGIN,
  };
  if (panelHeight <= room[preferred]) return { side: preferred };
  const other: PopoverSide = preferred === "bottom" ? "top" : "bottom";
  const side = room[other] > room[preferred] ? other : preferred;
  if (panelHeight <= room[side]) return { side };
  return { side, maxHeight: Math.max(Math.floor(room[side]), MIN_PANEL_HEIGHT) };
}

/**
 * The part of the window an element can show in: the viewport, narrowed by every ancestor that clips its
 * overflow (anything other than `visible`).
 */
export function clippingBounds(element: HTMLElement): VerticalBox {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}
