/** The vertical span of a box on screen. */
export interface VerticalBox {
  top: number;
  bottom: number;
}

/** The horizontal span of a box on screen. */
export interface HorizontalBox {
  left: number;
  right: number;
}

export type PopoverSide = "bottom" | "top";
/** Which edge of its trigger a panel shares: `start` grows to the right, `end` to the left. */
export type PopoverAlign = "start" | "end";

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
 * Picks the edge of its trigger a panel shares, so the box that clips it (a dialog that scrolls) never cuts its
 * side off: the asked-for edge when the panel fits there, else the other one when it fits, else the one that
 * loses less. Without a layout (a panel, a trigger or bounds with no width, as in jsdom) it decides nothing.
 */
export function fitAlign(trigger: HorizontalBox, bounds: HorizontalBox, panelWidth: number, preferred: PopoverAlign): PopoverAlign | null {
  if (panelWidth <= 0 || trigger.right - trigger.left <= 0 || bounds.right - bounds.left <= 0) return null;
  // How far the panel would reach past the box on each edge, the margin included.
  const cutOff = {
    start: Math.max(0, trigger.left + panelWidth - (bounds.right - EDGE_MARGIN)),
    end: Math.max(0, bounds.left + EDGE_MARGIN - (trigger.right - panelWidth)),
  };
  const other: PopoverAlign = preferred === "start" ? "end" : "start";
  return cutOff[other] < cutOff[preferred] ? other : preferred;
}

/**
 * The part of the window an element can show in: the viewport, narrowed by every ancestor that clips its
 * overflow (anything other than `visible`), each way by the ancestors that clip that way.
 */
export function clippingBounds(element: HTMLElement): VerticalBox & HorizontalBox {
  let top = 0;
  let bottom = window.innerHeight;
  let left = 0;
  let right = window.innerWidth;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const clipsY = style.overflowY !== "visible" && style.overflowY !== "";
    const clipsX = style.overflowX !== "visible" && style.overflowX !== "";
    if (!clipsY && !clipsX) continue;
    const rect = node.getBoundingClientRect();
    if (clipsY) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    if (clipsX) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
  }
  return { top, bottom, left, right };
}
