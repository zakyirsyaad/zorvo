import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The whole sandbox of an inline visual. Never `allow-scripts`: nothing an agent wrote may run.
 * `allow-same-origin` alone lets Zorvo read the document's height and gives the content no way
 * to act. A test pins this value.
 */
export const VISUAL_SANDBOX = "allow-same-origin";
/** Above this the visual scrolls inside its frame. */
export const MAX_VISUAL_HEIGHT = 2000;

export interface VisualFrameProps {
  /** The whole document from `visual_read`: Zorvo's wrapper around the cleaned markup. */
  document: string;
  title: string;
  maxHeight?: number;
  /** The height it had when last on screen, so the chat does not jump while it loads. */
  initialHeight?: number;
  onHeight?: (height: number) => void;
}

/** An inline visual's document in a frame that is as tall as its content. */
export function VisualFrame({ document: source, title, maxHeight = MAX_VISUAL_HEIGHT, initialHeight = 0, onHeight }: VisualFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight);

  const measure = useCallback(() => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    // The body, not the root: the root is never shorter than the frame, so it could not shrink.
    const next = Math.min(Math.ceil(body.scrollHeight), maxHeight);
    if (next <= 0) return;
    setHeight(next);
    onHeight?.(next);
  }, [maxHeight, onHeight]);

  // Text wraps differently at another width, so the height is read again.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <iframe
      ref={frameRef}
      sandbox={VISUAL_SANDBOX}
      srcDoc={source}
      title={title}
      onLoad={measure}
      className="block w-full border-0"
      style={{ height }}
    />
  );
}
