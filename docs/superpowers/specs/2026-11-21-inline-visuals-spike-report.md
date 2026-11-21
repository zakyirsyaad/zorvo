# Inline visuals: spike report

Date: 2026-11-21. Throwaway code, not kept. It answers the four questions of
section 6 of `2026-11-21-inline-visuals-design.md`.

## How it was run

A scratch page replaced `App` and mounted three
`<iframe sandbox="allow-same-origin" srcdoc>` frames. It ran its checks by
itself and wrote the results to a file through a throwaway command. The build
was `pnpm tauri build --debug --no-bundle`: the frontend is embedded and
Tauri applies the CSP, as in a release (`import.meta.env.PROD` was true and
the page reported CSP violations). The app ran under a scratch `HOME`.
WebKit: `AppleWebKit/605.1.15` on macOS 27.2.

## Results

| Question | Result | Evidence |
| --- | --- | --- |
| Do scripts, `on*`, `javascript:`, meta refresh and form submission stay dead? | **Yes** | `<script>` did not run. `onclick` did not run on a click. A `javascript:` link did not run. `onerror` did not run. After a meta refresh, a form submit and a link click the frame's location was still `about:srcdoc`. An `<img>` from `https://example.com` did not load (`naturalWidth` 0). Inline `<style>` and `style=""` applied. |
| Can the parent read the height? | **Yes** | `contentDocument.documentElement.scrollHeight` read 1017. A `ResizeObserver` made by the parent on the frame's root fired. |
| Can the parent catch a click inside the frame? | **No** | A `click` listener the parent added to `contentDocument` fired 0 times for three clicks. WebKit runs no event listener in a document whose sandbox forbids scripts, whoever added it. |
| Does a link navigate the frame when nothing stops it? | **No** | The CSP refused it: two `frame-src https://example.com` violations, and the frame kept its document. |
| Does heavy CSS freeze the interface? | **No, by this measure** | 223 KB of CSS, 2,000 elements each with `filter: blur()` and an infinite animation. The frame loaded in 53 ms. A 16 ms timer on the main thread, while the page scrolled, was at most 54 ms late (21 ms with no heavy frame). This measures the main thread, not dropped frames on screen. |
| Can `render.rs` draw HTML to a PNG on a background? | **Yes** | `ZORVO_RENDER_TEST=1 cargo test --test canvas_render` passes: it draws an HTML artboard with a solid background to a PNG. `draw` reads only canvas URLs today, so a visual needs a URL kind of its own. |
| Can Rust put PNG bytes on a pasteboard? | **Yes** | A test wrote PNG bytes to a uniquely named `NSPasteboard` with `setData:forType:` (`NSPasteboardTypePNG`) and read them back. `objc2-app-kit` already has the feature on. The user's clipboard was not touched. |

## What changes

**Approach A stands.** Nothing runs and nothing navigates in the frame, and
the height can be measured.

**Links cannot work as the spec says.** The spec has Zorvo catch a click from
outside and open the browser. No listener fires in the frame, so there is no
click to catch. The same finding means Zorvo cannot suppress a right-click in
the frame from the page.

Options:

1. **No links in a visual** (recommended). The sanitizer drops `href`, so an
   `<a>` is plain text. A link belongs in the reply's text, where Zorvo's link
   handling already works. It also removes a way to dress a link as a button.
2. A transparent layer over the frame that takes every click and asks the
   frame's document which element is under the pointer. Links work, but text
   in a visual can no longer be selected.
3. Add `allow-popups` and give links `target="_blank"`, then handle the new
   window request natively. Unproven, and it widens the sandbox.

**Size limit stays at 256 KiB**, and filters and animation are not stripped.

**The right-click menu** in a frame is WebKit's. With no links it has no
"Open Link". What it offers on text and on a `data:` image is checked by hand
in Task 8.
