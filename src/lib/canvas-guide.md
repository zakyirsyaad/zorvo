# Making a canvas for show_artifact

A canvas lays out several screens, a flow or variants of one screen side by side, so the user can see them together. Zorvo draws each screen as an artboard on a board they can pan and zoom. Use a plain page for one screen; use a canvas when there are two or more.

## The folder

Put everything in one folder inside this session's folder, such as `design/checkout/`. It holds `canvas.json`, one `.html` file per artboard, and the files they use (images, CSS, scripts, fonts). Zorvo keeps no copy: the files stay in the project.

## canvas.json

```json
{
  "version": 1,
  "title": "Checkout",
  "sections": [
    {
      "id": "flow",
      "title": "Flow",
      "artboards": [
        { "id": "cart", "title": "Cart", "file": "cart.html", "width": 1440, "height": 900 },
        { "id": "pay-a", "title": "Payment A", "file": "pay-a.html", "width": 1440, "height": 900, "group": "pay" },
        { "id": "pay-b", "title": "Payment B", "file": "pay-b.html", "width": 1440, "height": 900, "group": "pay" }
      ]
    }
  ]
}
```

- `version` is 1.
- `title` is 1 to 120 visible characters, with no control characters.
- `sections`: 1 to 50. A section has an `id`, a `title` and 1 to 200 `artboards`.
- An `id` is 1 to 64 characters of `a-z`, `0-9` and `-`, and is unique in the canvas.
- An artboard has an `id`, a `title`, a `file`, a `width` and a `height`, and an optional `group`.
- `width` and `height` are whole numbers from 200 to 8000.
- `file` is a relative path inside the folder that ends in `.html` or `.htm`. It may name a subfolder. It may not contain `..` or start with `/`.
- `designSystem`, optional: the folder of the project's design system, relative to the canvas folder, such as `"../../docs/design-system"`. Set it to the default system the folder line below names; Zorvo never links one by itself.
- At most 200 artboards in all. `canvas.json` is at most 256 KiB, valid UTF-8, and a JSON object with no other top-level field.
- A mistake is refused with the field that is wrong, for example `sections[0].artboards[2].width`.

Common sizes: 1440 x 900 (desktop), 390 x 844 (phone), 1024 x 768 (tablet).

## Artboards

- Each artboard is one self-contained `.html` file with a `<title>`, sized to its `width` and `height`.
- Put shared CSS in one file of the folder and link it relatively: `<link rel="stylesheet" href="shared.css">`.
- Variants of one screen are artboards that share a `group`. A group needs two artboards or more. Each variant tries one different idea (layout, hierarchy or tone), and its title says which.
- Zorvo places the artboards in order, one row per section. You give no coordinates.
- Put the look in `shared.css` as custom properties on `:root`, and use only those in the artboards, so one change reaches every artboard.
- A phone screen, a poster, a social post or a printed page is fixed at its `width` and `height`. A web page, a dashboard or an app window is fluid: a `max-width` container with `%`, `fr` and `rem` inside, so it also holds at phone width, and a `height` that is the page's height at that `width`.
- Draw each artboard in the theme the design is for. When the product has both themes, put the dark screens in a section of their own.

## Using the design system

When `canvas.json` names a `designSystem`, an artboard loads it from the folder `_ds/`, relatively: `<link rel="stylesheet" href="_ds/tokens.css">` (every token as a `--<name>` variable, in the theme the user picks), `<link rel="stylesheet" href="_ds/components/bundle.css">`, and `<img src="_ds/assets/Logos/mark.svg">`. From an artboard in a subfolder write `../_ds/...`. Use `var(--token)` names instead of raw values, so the Theme menu switches every artboard.

## What an artboard may load

- Files inside the canvas folder: HTML, CSS, JavaScript, images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`), fonts (`.woff`, `.woff2`, `.ttf`, `.otf`) and JSON.
- Scripts only from these hosts, each with an exact version in the URL (never `latest`, never a bare package name):
  - `https://cdnjs.cloudflare.com/`
  - `https://cdn.jsdelivr.net/npm/`
  - `https://unpkg.com/`
  - `https://cdn.tailwindcss.com/`
  - `https://code.jquery.com/`
- Stylesheets and fonts from Google Fonts (`https://fonts.googleapis.com/`).
- No network: no `fetch`, XHR or WebSocket. Put the data in the page.

## Showing it

Call `show_artifact` with `kind: "canvas"` and `path` set to the folder or its `canvas.json`. Call it again the same way after every change, so Zorvo reads the files again.

Build it one artboard at a time, so the user watches the canvas fill in. First write `canvas.json` with every artboard and the first artboard's file, then call `show_artifact`. Then write the next artboard's file and call it again, and so on. Until you write an artboard's file, its frame reads "File not found"; that is expected.
