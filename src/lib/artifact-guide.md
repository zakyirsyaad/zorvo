# Making a page for show_artifact

The page is shown beside the chat in Zorvo, in a panel about 540 px wide that the user can widen to the whole window. They read it there, ask you to change it, and may save it as a file. Make it worth reading: one clear subject, the main point first, no filler and no invented numbers.

For several screens, a flow or variants of one screen, make a canvas instead: call `artifact_guide` with `kind: "canvas"` for how.

## What a page is

- One self-contained `.html` file with a `<title>` and `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- CSS in a `<style>` block and scripts inline, or from the hosts below.
- Images as `data:` URIs or inline `<svg>`. No other image URL loads.

## What it may load

Scripts only from these hosts, each with an exact version in the URL (never `latest`, never a bare package name):

- `https://cdnjs.cloudflare.com/`
- `https://cdn.jsdelivr.net/npm/`
- `https://unpkg.com/`
- `https://cdn.tailwindcss.com/`
- `https://code.jquery.com/`

Stylesheets and fonts only from Google Fonts (`https://fonts.googleapis.com/`). Everything else is blocked and fails silently, so check each URL against this list.

## What it cannot do

- No `fetch`, XHR or WebSocket: put the data in the page.
- No `localStorage`, `sessionStorage` or cookies: they throw. Keep state in variables and wrap any storage call in `try`.
- No links or forms that leave the page; links to `#sections` inside it work.
- No `alert`, `confirm`, `prompt`, pop-ups, downloads or iframes.
- No `eval` or `new Function`; a library that needs them will not run.

## Colour, in both themes

The user may be in light or dark mode, and the page must read well in both.

- Define colours once as custom properties on `:root`, then redefine them under `@media (prefers-color-scheme: dark)`. Use only those properties below.
- Give `body` an explicit background and text colour from them. Never rely on the browser default.
- Body text needs a contrast of at least 4.5:1 against its background in both themes, small grey labels included.
- One accent colour is usually enough. Never use colour as the only signal: add a label, an icon or a pattern.

```css
:root { --bg: #ffffff; --fg: #18181b; --muted: #52525b; --line: #e4e4e7; --accent: #0369a1; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #111113; --fg: #fafafa; --muted: #a1a1aa; --line: #27272a; --accent: #38bdf8; }
}
body { margin: 0; background: var(--bg); color: var(--fg); }
```

## Layout

- It must hold from 320 px wide to a full window with no sideways scrolling. Use fluid widths, `max-width` on the reading column (about 720 px), flex or grid with `gap`, and `minmax(0, 1fr)` columns that collapse to one.
- A row of tiles or cards must wrap evenly: use `repeat(auto-fit, minmax(150px, 1fr))`, or a column count that divides the number of tiles, so none is left alone on a row.
- A wide table goes in its own box with `overflow-x: auto`.
- Padding of 16 to 24 px around the content. Text of 14 to 16 px with a line height near 1.5.
- A system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`) unless you link a Google Font. Monospace for code and numbers in columns.
- Headings in sentence case, short. One `<h1>`.

## Charts and diagrams

- Prefer inline `<svg>` you write yourself for a simple chart or diagram: it needs no library and scales cleanly. Use `viewBox` and `width: 100%`.
- For a library chart, give its canvas a container with a fixed height, and turn animation off.
- Every chart needs a title, labelled axes or direct labels on the marks, and units. Read the colours from your custom properties so they follow the theme.
- Sort bars by value unless the order means something. Start a bar axis at zero.
- In a diagram, label every box and arrow, keep text horizontal, and leave room so labels do not touch lines.

## Before you call show_artifact

- Every script and font URL is on the list and has an exact version.
- The page has no storage call, no `fetch` and no outside link.
- It reads in light and in dark, and at 320 px.
- Then call `show_artifact` with the file's path and a short title. To change the page, edit the same file and call it again: the user gets a new version.
