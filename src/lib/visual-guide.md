# Drawing a visual for show_visual

A visual is a picture inside your reply: a flow or architecture diagram, or a mockup of a card or a screen. It sits between your paragraphs, so keep it to one idea; a reply may hold several visuals, each beside the text it explains. For something the user keeps, reopens, scrolls or clicks through, or that needs a script, use show_artifact instead.

## What it is

- An SVG document, or an HTML fragment with its CSS. No `<html>` or `<body>`.
- At most 256 KB.
- No script runs. Handlers such as `onclick` are removed.
- Nothing loads from the network. Draw with inline SVG, or embed a picture as a `data:` URI.
- A visual has no links. An `<a>` shows as plain text; put a link in your reply's text.

## Fit the chat

- Leave the background transparent. Zorvo draws the frame around the visual.
- The width is the chat column, about 700 px, and it can be narrower. Give an SVG a `viewBox` and let it scale; avoid fixed widths over 700 px.
- Text is already set in the app's font at 14 px.

## Colours

Use only these variables, so the visual follows light and dark:

- `--fg` main text, `--fg-secondary` body text, `--fg-muted` labels, `--fg-subtle` small notes
- `--border` hairlines and box outlines, `--border-strong` arrows and connectors
- `--chip` the fill of a box or a chip, `--sheet` a raised surface
- `--status-running` something working, `--status-attention` something waiting on the user, `--danger` a failure
- `--diff-added` and `--diff-removed` for added and removed

In a diagram, fill boxes with `--chip`, outline them with `--border`, and draw arrows with `--border-strong`. Do not use colour alone to carry meaning: label it too.

## Honest content

Write a placeholder as a placeholder: `[name]`, `[number]`, `[time]`. Never invent a name, a figure or a quote to make a mockup look real.

## Title

Give every visual a short title that says what it shows, such as "Path of a request".
