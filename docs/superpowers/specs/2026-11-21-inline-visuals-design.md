# Inline visuals: a diagram or mockup inside an agent's reply

Date: 2026-11-21. Status: design, waiting for review.

## Goal

An agent can put a picture in the middle of its answer: a flow diagram, an
architecture sketch, a mockup of a card or a screen. The picture sits between
the paragraphs of the reply, scrolls with the chat, follows the light and dark
theme, and can be copied or saved as a file.

The model is the "Made a visual" block of Claude Code's desktop app. Zorvo's
version is static: nothing in a visual runs.

Today the closest thing is `show_artifact`, which opens a page in the Output
tab beside the chat. That stays. An inline visual is for a picture that
belongs to one answer, and a page is for something the user keeps and reopens.

## Decisions made with the user

- **Static only.** SVG, or HTML with CSS. No script runs in a visual, and a
  visual cannot send a message to the agent.
- **No live version in Output.** A visual is not an artifact and is not listed
  in the Output tab or the gallery. It lives in the chat only.
- **Shown in a sandboxed `srcdoc` iframe without scripts** (approach A). A
  sanitized shadow root and a PNG drawn by a hidden webview were the other two
  candidates. The PNG path is the fallback if the spike in section 6 fails.
- **The agent hands over `code` or `path`**, exactly one of them.
- **Three export actions in the first version:** Copy as image, Download as
  SVG (or HTML), Download as PNG.

## Out of scope

Scripts in a visual, a `sendPrompt` bridge from a visual to the chat, visuals
in a popout window (a popout shows the title only), a list of visuals in the
Output tab or the gallery, comments on a visual, versions of a visual, images
or fonts loaded from the network, visuals for sessions that get no Zorvo tools
(compare runs, workers, sessions an agent opened), streaming a visual while the
agent still writes it.

## 1. What the agent calls

### The tool

`show_visual` joins the agent tool server as its eleventh tool. It follows the
rules of `show_artifact`: `useAgentTools` answers it at once, with no card and
no grant, and only a session whose token carries `Capabilities.agent_tools`
sees it. A worker's token still opens `done` only.

| Argument | Rule |
| --- | --- |
| `title` | Required. Cleaned by `clean_title`, the rule artifacts use. |
| `code` | An SVG document, or an HTML fragment with its CSS. No `<html>` or `<body>`. At most 256 KiB of valid UTF-8. |
| `path` | A `.html`, `.htm` or `.svg` file inside the session's folder or a temporary folder, read through `artifacts/source.rs` (opened first, judged open, a regular file only), at most 256 KiB. |

Exactly one of `code` and `path` must be present. Text that starts with `<svg`
after leading white space is an SVG visual; anything else is an HTML visual.

`path` exists for the command path. Pi calls a tool as
`zorvo tools show_visual '<json>'`, and a few hundred lines of markup inside a
shell argument do not survive quoting. Writing a file and naming it does.

### The answer

`{ "shown": true }` on success. A refusal is one fixed sentence that never
repeats what the agent sent:

- neither or both of `code` and `path`
- too large
- not valid UTF-8
- nothing left to show after cleaning
- the session already holds 100 visuals
- the file is not one Zorvo reads (the sentences of `ARTIFACT_REFUSALS`)

The sentences live in Rust and are mirrored in `lib/visuals.ts`; a test keeps
the two lists equal, as it does for artifacts.

### The guide

`artifact_guide` takes a third `kind`, `visual`, and returns
`src/lib/visual-guide.md`. It says:

- the CSS variables Zorvo defines and what each is for
- the background stays transparent and the width follows the chat column
- no script runs, and nothing loads from the network: use inline SVG or a
  `data:` URI for a picture
- placeholders are written as placeholders (`[name]`, `[number]`), never as
  made-up data
- when to use a visual and when to use a page in Output

`MCP_PATH_CONTEXT` and `COMMAND_PATH_CONTEXT` gain one sentence each: show a
visual when a picture explains the answer better than a list would.

## 2. Storage

A visual's markup is kept by the backend, never in the transcript. A
transcript is written whole on every save, and large payloads inside it once
grew a session's file to tens of megabytes.

- File: `<data dir>/artifacts/<sessionId>/visuals/<visualId>.html` or `.svg`,
  mode 0600, written aside and renamed.
- Index: `visuals.json` beside `index.json`, one entry per visual
  (`v-<16 hex>` id, title, kind `svg` or `html`, size, when it was shown),
  under the session's existing lock.
- Limits: 256 KiB per visual, 100 visuals per session.
- The chat message holds only `{ id, title, kind }`.

`STATE_VERSION` stays 2: nothing is added to `state.json`.

### Cleaning at intake

Before a visual is stored, the backend passes it through an allowlist
sanitizer. Tags and attributes it does not know are dropped. Among what never
passes: `<script>`, every `on*` attribute, `javascript:` URLs,
`<meta http-equiv>`, `<base>`, `<iframe>`, `<object>`, `<embed>`, `<form>`,
`<link>`. `<style>` and the `style` attribute pass.

The library is chosen in the plan (the candidate is `ammonia`, configured for
SVG). The stored file is the cleaned markup, so the screen, the export and a
later reload all read the same bytes.

### Lifetime

| Event | Effect |
| --- | --- |
| A rewind removes the message | A sweep deletes visuals no message of the session names, only for a session whose transcript is loaded |
| The session is deleted | `artifact_delete_session` already removes the folder |
| The start-up sweep | Already removes the folders of sessions that are gone |
| A transcript names a visual whose file is gone | The block reads "This visual is no longer available." |

## 3. In the chat

### Where it goes

A visual is a part of the reply, placed where its tool call arrived, so text,
visual, text, visual read in order. `ChatMessagePart` (today `text` and
`tools`) gains `{ kind: 'visual', id, title, visualKind }`. `normalizeTranscript` keeps a
part only when its fields have the right shape.

A tool call arrives whole, so the block appears once, with `animate-appear`.
A block loaded from a transcript does not fade.

### The block

`components/chat/VisualBlock.tsx`, drawn by Zorvo outside the iframe:

- **Header:** the title, "{Agent} made this visual" as its second line,
  **Expand**, a fold toggle, and a ⋯ menu with the export actions.
- **Body:** the iframe.
- **Frame:** a hairline border around the body, so nothing an agent draws
  reads as part of Zorvo's own interface.

The header's controls are `IconButton`s with accessible names and the
`focus-ring` utility. The ⋯ menu is a real `role="menu"` with arrow keys and
Escape, like `LinkMenuLayer`. A folded block shows the header only.

States: loading (a quiet placeholder at the last known height), shown, gone
(the sentence above), and failed to read ("Zorvo could not show this visual."
with **Try again**).

### The iframe

```html
<iframe sandbox="allow-same-origin" srcdoc="…" title="{title}"></iframe>
```

No `allow-scripts`, ever. A test pins the attribute's exact value.
`allow-same-origin` without scripts lets Zorvo read the document's height and
handle clicks from outside, and gives the content no way to act.

`srcdoc` is Zorvo's wrapper followed by the stored markup. The wrapper holds:

- the design tokens as CSS variables, dark values with a
  `prefers-color-scheme: light` block, generated from `tokens.json` (a test
  fails on a variable `tokens.json` does not hold)
- the app's base font and text colour, a transparent background, zero margin
- one `prefers-reduced-motion: reduce` block that ends animation and
  transition

The markup comes from `visual_read(sessionId, id)`. The webview sends ids,
never a path or markup.

### Size

The width is the chat column's. Zorvo measures the height from the iframe's
document after it loads and whenever the width changes. Above 2,000 px the
body scrolls inside the block.

### Cost

An iframe is mounted only while its block is near the scroll area and
unmounted when it leaves, keeping the measured height so the chat does not
jump. The file viewer's PDF pages work the same way.

### Expand

Opens the same visual, still static, in a wide dialog (`shadow-dialog`).
Escape closes it and focus returns to the Expand button.

### Links

A link in a visual never loads anything in the iframe. Zorvo catches the
click from outside and hands the address to `open_external_url`, only for
`http`, `https` and `mailto` (`OPENABLE_URL`). A right-click inside a visual
shows no menu: WebKit's own is suppressed, since its "Open Link" would load
the page in the frame, and Zorvo's link menu is not wired into the frame in
this version.

### Popout

A popout renders a visual part as one line with the title and "Shown in the
main window." It mounts no iframe.

## 4. Export

The ⋯ menu:

| Action | What happens |
| --- | --- |
| **Copy as image** | The backend draws a PNG and puts it on the macOS clipboard (`NSPasteboard`). |
| **Download as SVG** | The save dialog picks a place; the stored bytes are written. Offered for an SVG visual. |
| **Download as HTML** | The same, for an HTML visual. The file is the wrapper plus the markup, so it opens the same in a browser. |
| **Download as PNG** | The save dialog picks a place; the backend writes the PNG. |

The PNG is drawn by the hidden-webview path of `artifacts/render.rs`
(`WKSnapshotConfiguration`) at 2×, at the block's current width. The hidden
view loads `zorvo-artifact://localhost/visual/<session>/<id>`, a route that
exists only on that view and serves the wrapper plus the stored markup under a
CSP of its own with no `script-src` (a test pins its text). Its navigation
handler allows that one address. A visual's background is
transparent, so the PNG gets the `sheet` colour of the theme in use; light
text on a transparent PNG would be unreadable when pasted into a white
document.

Commands: `visual_read`, `visual_copy_image`, `visual_export(sessionId, id,
format)`. All three are `#[tauri::command(async)]`, take ids only, and find
the session's folder themselves. A failure is a plain sentence in a notice,
never a path.

## 5. Security

The markup is written by an agent, which can be wrong or steered by text in
the repository. The boundaries, outermost first:

1. **The sandbox.** Without `allow-scripts` no JavaScript runs in a visual,
   whatever its source.
2. **Zorvo's CSP.** A `srcdoc` document inherits it: `script-src 'self'`, no
   network for images or fonts, `form-action 'none'`.
3. **Cleaning at intake** (section 2), so the stored file holds nothing that
   could run even if it were opened elsewhere.
4. **The frame and header**, drawn by Zorvo, against a visual that draws a
   fake Zorvo button. Nothing inside a visual can be pressed except a link,
   and a link only opens the browser.
5. **Ids only** from the webview.

Not protected: an agent can draw something misleading inside the frame. The
same agent can write misleading text in its reply.

## 6. Spike

Done on 2026-11-21. The full report is
`2026-11-21-inline-visuals-spike-report.md`.

| Question | Result |
| --- | --- |
| Do scripts, `on*`, `javascript:`, meta refresh and form submission stay dead in the frame, with the CSP applied? | Yes |
| Can the parent read the document's height? | Yes |
| Can the parent catch a click inside the frame? | **No.** WebKit runs no listener in a document whose sandbox forbids scripts |
| Does a link navigate the frame when nothing stops it? | No, the CSP's `frame-src` refuses it |
| Does heavy CSS (223 KB, 2,000 blurred, animated elements) block the main thread? | No (a 16 ms timer was at most 54 ms late) |
| Can `render.rs` draw HTML to a PNG, and can Rust write a PNG to a pasteboard? | Yes to both |

Approach A stands and the size limit stays. The "Links" part of section 3
cannot be built as written; the decision is open (see the report's options).

## 7. Testing

**Rust**

- `show_visual` arguments: each refusal, and that no refusal repeats input
- sanitizer fixtures: every item of the list in section 2, plus an SVG and an
  HTML mockup that must pass unchanged in what they show
- store: limits, atomic write, the index, deletion with the session
- `protocol.rs` lists eleven tools for a coordinator and still one for a worker
- one end-to-end test: the fake agent as an MCP client calls `show_visual`
  through a real bridge

**Frontend**

- `lib/visuals.ts`: parsing, the refusal list kept equal to Rust's
- `VisualBlock`: the pinned `sandbox` value, each state, fold, the menu by
  keyboard, focus after Expand closes
- the wrapper names only variables `tokens.json` holds
- `normalizeTranscript` keeps and drops visual parts correctly
- the rewind sweep
- `tauri-contract.test.ts` for the three commands

Local runs are the targeted files; CI runs the whole suite.

## 8. Design first

New artboards on the v2 canvas, built from the existing chat artboards, in a
section of their own: the block in a reply (dark and light), the open ⋯ menu,
the folded block, the Expand dialog, and the gone and failed states. The
canvas decides look and copy; this spec decides behaviour.

## 9. What else changes

- `CLAUDE.md`: an **Inline visuals** section, and "ten tools" becomes eleven
- `CHANGELOG.md`: a line under `Unreleased`
- the README's privacy section does not change: a visual makes no network
  request
