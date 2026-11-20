import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Copy, ExternalLink, PanelRight } from "lucide-react";
import { linkAt, menuPlacement, openableLinkAt, shownAddress, type OpenableLink, type Point } from "../lib/link-menu";
import { POPOVER_PANEL_STYLE, PopoverOption } from "./ui/Popover";
import { requestBrowserOpen } from "../lib/browser";

interface OpenMenu {
  link: OpenableLink;
  point: Point;
}

/**
 * Zorvo's own menu for a right-click on a link, in place of WebKit's, whose "Open Link" would load
 * the page inside Zorvo's window. Mounted once per window; it watches every link, so links outside
 * an agent's reply (Settings, the Changes panel) get it too. A link Zorvo cannot open keeps no menu.
 */
export function LinkMenuLayer() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (!linkAt(event.target)) return;
      event.preventDefault();
      const link = openableLinkAt(event.target);
      if (!link) return;
      setMenu({ link, point: pointFor(event, link.anchor) });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!menu) return null;
  return createPortal(
    <LinkMenu key={`${menu.point.x},${menu.point.y},${menu.link.href}`} menu={menu} onClose={() => setMenu(null)} />,
    document.body,
  );
}

/** Puts text on the clipboard, as the code block's Copy does; WKWebView has the clipboard API. */
function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {});
}

/** At the pointer; from the keyboard (the menu key, Shift+F10) there is no pointer, so below the link. */
function pointFor(event: MouseEvent, anchor: HTMLAnchorElement): Point {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
  const box = anchor.getBoundingClientRect();
  return { x: box.left, y: box.bottom };
}

function LinkMenu({ menu, onClose }: { menu: OpenMenu; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const addressId = useId();
  const [place, setPlace] = useState({ left: menu.point.x, top: menu.point.y });
  const { anchor, href } = menu.link;

  // Before paint, so the menu never shows past the window's edge.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const size = { width: panel.offsetWidth, height: panel.offsetHeight };
    setPlace(menuPlacement(menu.point, size, { width: window.innerWidth, height: window.innerHeight }));
    panel.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu.point]);

  // A click outside, Escape, leaving the window or resizing it closes it. Escape is heard on the whole
  // document, since focus can leave the items (a click on the address line) while the menu stays open.
  // A scroll does not close it: the chat scrolls by itself while an agent writes, and the menu would
  // vanish under the pointer.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchor.focus();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key === "Tab") {
      // Back on the link first, so Tab goes on from it rather than from the top of the window.
      onClose();
      anchor.focus();
    } else if (event.key in step && items.length > 0) {
      event.preventDefault();
      const next = at < 0 ? (step[event.key] > 0 ? 0 : items.length - 1) : (at + step[event.key] + items.length) % items.length;
      items[next].focus();
    } else if ((event.key === "Home" || event.key === "End") && items.length > 0) {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1].focus();
    }
  };

  const open = () => {
    // The backend opens only http, https and mailto, which OPENABLE_URL already checked.
    invoke("open_external_url", { url: href }).catch(() => {});
    onClose();
  };

  const copy = () => {
    copyText(href);
    onClose();
  };

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label="Link"
      aria-describedby={addressId}
      onKeyDown={onKeyDown}
      style={{ left: place.left, top: place.top }}
      className={`fixed z-50 flex w-60 flex-col ${POPOVER_PANEL_STYLE}`}
    >
      {/^https?:\/\//i.test(href) && <PopoverOption onSelect={() => { requestBrowserOpen(href); onClose(); }}>
        <span className="inline-flex items-center gap-2">
          <PanelRight aria-hidden="true" className="size-3.5 text-fg-muted" />
          Open in Zorvo's browser
        </span>
      </PopoverOption>}
      <PopoverOption onSelect={open}>
        <span className="inline-flex items-center gap-2">
          <ExternalLink aria-hidden="true" className="size-3.5 text-fg-muted" />
          Open in browser
        </span>
      </PopoverOption>
      <PopoverOption onSelect={copy}>
        <span className="inline-flex items-center gap-2">
          <Copy aria-hidden="true" className="size-3.5 text-fg-muted" />
          Copy link
        </span>
      </PopoverOption>
      <div aria-hidden="true" className="mx-1.5 my-1 h-px bg-border" />
      {/* Not a menu item, so hidden as a child of the menu; it is the menu's description instead. */}
      <p id={addressId} aria-hidden="true" title={href} className="truncate px-2 pb-1 font-mono text-caption text-fg-subtle">
        {shownAddress(href)}
      </p>
    </div>
  );
}
