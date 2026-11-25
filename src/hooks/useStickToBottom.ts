import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type TouchEvent,
  type WheelEvent,
} from "react";

/** How close to the bottom still counts as following new output. */
export const STICK_TO_BOTTOM_PX = 80;

/** How far above the bottom the view must be before a jump back down is offered: a few lines, not a nudge. */
export const OFFER_JUMP_PX = 240;

const KEYS_THAT_MOVE_UP = new Set(["PageUp", "ArrowUp", "Home"]);

export interface StickToBottom {
  containerRef: RefObject<HTMLDivElement | null>;
  /** The element that holds the content, watched for size changes no new message announces. */
  contentRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  /** Brings the newest output into view and follows it again. */
  scrollToBottom: () => void;
  /** Follows grown content, unless the user scrolled away to read. */
  followNewContent: () => void;
  /** Leaves the bottom, for a jump to an earlier message. */
  stopFollowing: () => void;
  /** The user scrolled more than {@link OFFER_JUMP_PX} above the newest output. */
  isAwayFromBottom: boolean;
}

/**
 * Keeps a scroll container at its newest output while the user stays there.
 * Any small move up leaves the bottom at once, so a streaming reply cannot
 * pull the view back down under a slow trackpad scroll. Only scrolling back
 * within {@link STICK_TO_BOTTOM_PX} of the bottom resumes following.
 */
export function useStickToBottom(): StickToBottom {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isFollowingRef = useRef(true);
  // The scrollTop this hook set itself: its scroll event is not the user's.
  const ownScrollTopRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const lastTouchYRef = useRef<number | null>(null);
  // State, unlike the rest: the jump button shows and hides with it. Set only when it changes.
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isFollowingRef.current = true;
    el.scrollTop = el.scrollHeight;
    ownScrollTopRef.current = el.scrollTop;
    lastScrollTopRef.current = el.scrollTop;
    setIsAwayFromBottom(false);
  }, []);

  const followNewContent = useCallback(() => {
    const el = containerRef.current;
    // Reading scrollHeight lays the whole list out: only a follower pays for it.
    if (!el || !isFollowingRef.current) return;
    el.scrollTop = el.scrollHeight;
    ownScrollTopRef.current = el.scrollTop;
    lastScrollTopRef.current = el.scrollTop;
  }, []);

  const stopFollowing = useCallback(() => {
    isFollowingRef.current = false;
  }, []);

  // A late image, a box under the reply, a reflow when a panel opens or a taller composer change the
  // size without a new message: follow them too, and say again whether the view is away.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      followNewContent();
      const el = containerRef.current;
      if (el) setIsAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > OFFER_JUMP_PX);
    });
    observer.observe(container);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [followNewContent]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const top = el.scrollTop;
    if (ownScrollTopRef.current !== null && top === ownScrollTopRef.current) {
      // The event for the hook's own assignment, after the content may have
      // grown; it says nothing about where the user wants the view.
      ownScrollTopRef.current = null;
      lastScrollTopRef.current = top;
      return;
    }
    ownScrollTopRef.current = null;
    const distance = el.scrollHeight - top - el.clientHeight;
    // Content that shrinks makes the browser pull the view up to the new end, which also fires a
    // scroll: that move ends at the bottom, so only a move up that leaves the bottom is the user's.
    if (top < lastScrollTopRef.current && distance > STICK_TO_BOTTOM_PX) isFollowingRef.current = false;
    else if (distance <= STICK_TO_BOTTOM_PX) isFollowingRef.current = true;
    lastScrollTopRef.current = top;
    setIsAwayFromBottom(distance > OFFER_JUMP_PX);
  }, []);

  /** An upward signal only leaves the bottom when the view can actually move up. */
  const leaveIfScrollable = useCallback(() => {
    const el = containerRef.current;
    if (el && el.scrollTop > 0) isFollowingRef.current = false;
  }, []);

  const onWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) leaveIfScrollable();
    },
    [leaveIfScrollable],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Keys belong to the chat only when the chat itself has focus: an
      // ArrowUp inside a form is the input's, not the list's.
      if (event.target !== event.currentTarget) return;
      if (KEYS_THAT_MOVE_UP.has(event.key)) leaveIfScrollable();
    },
    [leaveIfScrollable],
  );

  const onTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    lastTouchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      const last = lastTouchYRef.current;
      // A finger moving down pulls earlier content into view.
      if (last !== null && y > last) leaveIfScrollable();
      lastTouchYRef.current = y;
    },
    [leaveIfScrollable],
  );

  return {
    containerRef,
    contentRef,
    onScroll,
    onWheel,
    onKeyDown,
    onTouchStart,
    onTouchMove,
    scrollToBottom,
    followNewContent,
    stopFollowing,
    isAwayFromBottom,
  };
}
