// Zorvo's script in an artifact page. It runs before the page's own scripts.
// It reports what the user picks in comment mode and draws numbered marks.
// It is never sent comment text, makes no request, and calls nothing but the
// view's message handler, which carries data only (see picks.rs).
(function () {
  "use strict";
  if (window.__zorvoCommentMode) return;

  var MAX_QUOTE = 1000;
  var MAX_CONTEXT = 60;
  var MAX_CLASSES = 5;
  var MAX_CLASS = 60;
  var MAX_ID = 100;
  var MAX_LABEL = 100;
  var MAX_TEXT = 200;
  var MAX_LEVELS = 12;
  var MARK = "#2563eb";
  var MARK_FILL = "rgba(37, 99, 235, 0.18)";
  var SKIPPED_PARENTS = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true };

  var commenting = false;
  var overlay = null;
  var outline = null;
  var shownMarks = [];

  // wry defines `window.ipc` in the main frame only; in a canvas artboard's frame the handler is
  // reached through WebKit's own name for it, which every frame has.
  function post(message) {
    var body = JSON.stringify(message);
    var ipc = window.ipc;
    if (ipc && typeof ipc.postMessage === "function") { ipc.postMessage(body); return; }
    var handlers = window.webkit && window.webkit.messageHandlers;
    if (handlers && handlers.ipc) handlers.ipc.postMessage(body);
  }

  // Limits count code points, as Rust counts characters.
  function cut(text, limit) {
    return Array.from(text).slice(0, limit).join("");
  }

  function lastChars(text, limit) {
    var chars = Array.from(text);
    return chars.slice(Math.max(0, chars.length - limit)).join("");
  }

  function collapse(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function overlayRoot() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement("div");
    overlay.setAttribute("data-zorvo-overlay", "");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647;";
    document.documentElement.appendChild(overlay);
    outline = null;
    return overlay;
  }

  function isOverlay(node) {
    return overlay !== null && overlay.contains(node);
  }

  // The text of the page as one string, from its text nodes in order. Picks
  // and the search for marks both use it, so they agree on every character.
  function pageText() {
    var nodes = [];
    var starts = [];
    var text = "";
    if (!document.body) return { nodes: nodes, starts: starts, text: text };
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentNode;
        var skipped = parent && SKIPPED_PARENTS[parent.nodeName];
        return skipped || isOverlay(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (var node = walker.nextNode(); node; node = walker.nextNode()) {
      starts.push(text.length);
      nodes.push(node);
      text += node.data;
    }
    return { nodes: nodes, starts: starts, text: text };
  }

  // Where a range boundary falls in `page.text`.
  function offsetOf(page, container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      var index = page.nodes.indexOf(container);
      return index < 0 ? null : page.starts[index] + offset;
    }
    var point = document.createRange();
    point.setStart(container, offset);
    for (var i = 0; i < page.nodes.length; i++) {
      if (point.comparePoint(page.nodes[i], 0) >= 0) return page.starts[i];
    }
    return page.text.length;
  }

  // The range covering `page.text` from `start` to `end`.
  function rangeOf(page, start, end) {
    var range = document.createRange();
    var placed = 0;
    for (var i = 0; i < page.nodes.length && placed < 2; i++) {
      var from = page.starts[i];
      var to = from + page.nodes[i].data.length;
      if (placed === 0 && start >= from && start <= to) {
        range.setStart(page.nodes[i], start - from);
        placed = 1;
      }
      if (placed === 1 && end >= from && end <= to) {
        range.setEnd(page.nodes[i], end - from);
        placed = 2;
      }
    }
    return placed === 2 ? range : null;
  }

  function textPick(range) {
    if (!document.body || !document.body.contains(range.commonAncestorContainer)) return null;
    var page = pageText();
    var start = offsetOf(page, range.startContainer, range.startOffset);
    var end = offsetOf(page, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return null;
    var quote = cut(page.text.slice(start, end), MAX_QUOTE);
    if (quote.trim() === "") return null;
    return {
      kind: "pick-text",
      quote: quote,
      before: lastChars(page.text.slice(0, start), MAX_CONTEXT),
      after: cut(page.text.slice(start + quote.length), MAX_CONTEXT),
    };
  }

  // From the element up to the body, so a full path names one element from the
  // body down. Each level is the element's local name, which keeps the case of
  // SVG names (clipPath) that selectors match case-sensitively.
  function pathOf(element) {
    var levels = [];
    var node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && node !== document.documentElement) {
      var tag = node.localName;
      var parent = node.parentElement;
      var same = [];
      if (parent) {
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].localName === node.localName) same.push(parent.children[i]);
        }
      }
      levels.unshift(same.length > 1 ? tag + ":nth-of-type(" + (same.indexOf(node) + 1) + ")" : tag);
      node = parent;
    }
    return levels.slice(-MAX_LEVELS).join(" > ");
  }

  function elementPick(element) {
    var classes = [];
    for (var i = 0; i < element.classList.length && classes.length < MAX_CLASSES; i++) {
      classes.push(cut(element.classList[i], MAX_CLASS));
    }
    var message = {
      kind: "pick-element",
      tag: element.tagName.toLowerCase(),
      classes: classes,
      text: cut(collapse(element.textContent || ""), MAX_TEXT),
      path: pathOf(element),
    };
    if (element.id) message.elementId = cut(element.id, MAX_ID);
    var label = element.getAttribute("aria-label") || element.getAttribute("role");
    if (label) message.label = cut(label, MAX_LABEL);
    return message;
  }

  function box(rect, style) {
    var shape = document.createElement("div");
    shape.style.cssText =
      "position:absolute;box-sizing:border-box;left:" +
      (rect.left + window.scrollX) +
      "px;top:" +
      (rect.top + window.scrollY) +
      "px;width:" +
      rect.width +
      "px;height:" +
      rect.height +
      "px;" +
      style;
    return shape;
  }

  function badge(n, rect) {
    var mark = document.createElement("div");
    mark.setAttribute("data-zorvo-badge", "");
    mark.textContent = String(n);
    mark.style.cssText =
      "position:absolute;left:" +
      Math.max(0, rect.left + window.scrollX - 9) +
      "px;top:" +
      Math.max(0, rect.top + window.scrollY - 9) +
      "px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:" +
      MARK +
      ";color:#fff;font:600 11px/18px -apple-system,system-ui,sans-serif;text-align:center;";
    return mark;
  }

  function query(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  // The element whose text is the anchor's, else the first.
  function choose(matches, anchor) {
    for (var i = 0; i < matches.length; i++) {
      if (cut(collapse(matches[i].textContent || ""), MAX_TEXT) === anchor.text) return matches[i];
    }
    return matches[0] || null;
  }

  // A full path is read from the body down; one cut to its nearest levels
  // matches anywhere, and the anchor's text picks among the matches.
  function findElement(anchor) {
    var fromBody = document.body ? query(document.body, ":scope > " + anchor.path) : [];
    return choose(fromBody.length > 0 ? fromBody : query(document, anchor.path), anchor);
  }

  function findText(page, anchor) {
    var whole = page.text.indexOf(anchor.before + anchor.quote + anchor.after);
    var start = whole >= 0 ? whole + anchor.before.length : page.text.indexOf(anchor.quote);
    return start < 0 || anchor.quote === "" ? null : rangeOf(page, start, start + anchor.quote.length);
  }

  function rectsOf(range) {
    return typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
  }

  function drawMarks() {
    var root = overlayRoot();
    var drawn = root.querySelectorAll("[data-zorvo-mark]");
    for (var d = 0; d < drawn.length; d++) drawn[d].remove();
    var page = pageText();
    var missing = [];
    shownMarks.forEach(function (mark) {
      var anchor = mark && mark.anchor;
      var group = document.createElement("div");
      group.setAttribute("data-zorvo-mark", "");
      var rects = [];
      if (anchor && anchor.kind === "element") {
        var element = findElement(anchor);
        if (!element || isOverlay(element)) return missing.push(mark.n);
        rects = [element.getBoundingClientRect()];
        group.appendChild(box(rects[0], "border:2px solid " + MARK + ";border-radius:4px;"));
      } else if (anchor && anchor.kind === "text") {
        var range = findText(page, anchor);
        if (!range) return missing.push(mark.n);
        rects = rectsOf(range);
        rects.forEach(function (rect) {
          group.appendChild(box(rect, "background:" + MARK_FILL + ";"));
        });
      } else {
        return missing.push(mark.n);
      }
      group.appendChild(badge(mark.n, rects[0] || { left: 0, top: 0 }));
      root.appendChild(group);
    });
    return missing;
  }

  function showOutline(element) {
    var root = overlayRoot();
    if (!outline || !outline.isConnected) {
      outline = document.createElement("div");
      root.appendChild(outline);
    }
    var shape = box(element.getBoundingClientRect(), "border:2px dashed " + MARK + ";border-radius:4px;");
    outline.style.cssText = shape.style.cssText;
  }

  function hideOutline() {
    if (outline) outline.remove();
    outline = null;
  }

  function isPage(target) {
    return target === document.body || target === document.documentElement;
  }

  function hasSelection() {
    var selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed);
  }

  window.addEventListener(
    "click",
    function (event) {
      if (!commenting) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      var target = event.target;
      if (!(target instanceof Element) || isOverlay(target) || hasSelection()) return;
      post(isPage(target) ? { kind: "cancel" } : elementPick(target));
    },
    true,
  );

  window.addEventListener(
    "mouseup",
    function () {
      if (!commenting || !hasSelection()) return;
      var selection = window.getSelection();
      if (selection.rangeCount === 0) return;
      var pick = textPick(selection.getRangeAt(0));
      if (pick) post(pick);
    },
    true,
  );

  window.addEventListener(
    "mouseover",
    function (event) {
      var target = event.target;
      if (!commenting || !(target instanceof Element) || isOverlay(target) || isPage(target)) return;
      showOutline(target);
    },
    true,
  );

  function followLayout() {
    if (shownMarks.length > 0) drawMarks();
    hideOutline();
  }

  window.addEventListener("resize", followLayout);
  // Marks are drawn where their targets were. A panel that scrolls moves its content and not the
  // overlay, and the window scrolling moves the overlay and not a fixed element: draw them again.
  // A scroll does not bubble, so this listens in the capture phase to hear every scrolling element.
  window.addEventListener("scroll", followLayout, true);

  function setCommentMode(on) {
    commenting = on === true;
    if (!commenting) hideOutline();
  }

  function setMarks(marks) {
    shownMarks = Array.isArray(marks) ? marks : [];
    post({ kind: "marks-missing", numbers: drawMarks() });
  }

  // On a canvas the page is an artboard in a frame of Zorvo's wrapper, which relays comment mode
  // and marks here: only from the parent frame, only in a frame, and only those two kinds.
  window.addEventListener("message", function (event) {
    if (window.parent === window || event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.zorvo === "mode") setCommentMode(data.on === true);
    else if (data.zorvo === "marks") setMarks(data.marks);
  });

  Object.defineProperty(window, "__zorvoCommentMode", { value: setCommentMode });
  Object.defineProperty(window, "__zorvoMarks", { value: setMarks });
})();
