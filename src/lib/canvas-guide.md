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
- At most 200 artboards in all. `canvas.json` is at most 256 KiB, valid UTF-8, and a JSON object with no other top-level field.
- A mistake is refused with the field that is wrong, for example `sections[0].artboards[2].width`.

Common sizes: 1440 x 900 (desktop), 390 x 844 (phone), 1024 x 768 (tablet).

## Artboards

- Each artboard is one self-contained `.html` file with a `<title>`, sized to its `width` and `height`.
- Put shared CSS in one file of the folder and link it relatively: `<link rel="stylesheet" href="shared.css">`.
- Variants of one screen are artboards that share a `group`. A group needs two artboards or more.
- Zorvo places the artboards in order, one row per section. You give no coordinates.

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
