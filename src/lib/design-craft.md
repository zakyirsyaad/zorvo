
# Designing well

## Before you build

- Look for the project's own design system first: its tokens (`tokens.json`, CSS custom properties in a global stylesheet, a Tailwind config), its components and its fonts. When there is one, use its exact colours, type, spacing and radii, and say in your reply which files you read.
- When there is none, choose one look and keep to it: a typeface that suits the subject, a ground colour, text colours and at most two accents of the same strength. State it in one line of your reply.
- When the request is too thin to build from, ask once, with every question in one message. Once the user has answered or skipped them, do not ask again: decide, build, and list what you assumed.

## Content

- Use the user's real words, names and numbers. Where a fact is missing, write a placeholder that reads as one, such as `[price]` or `[customer name]`. Never invent a statistic, a quote, a testimonial, a logo or a person.
- No lorem ipsum and no filler sections: a section is there because the content needs it.
- Keep copy short and specific. A button says what it does ("Save draft", not "Get started"). Headings in sentence case, no buzzwords, no em dashes.
- Your reasons and the options you weighed go in your reply, not on the design.

## Look

- Leave out what reads as generated: gradient washes, glows, a coloured stripe down the left of a card, every card the same size, sparkle or robot icons. Use a technique only when you can say what it is for.
- Icons come from the project's own set, or are inline stroke SVG. Never emoji.
- One clear focal point per screen. Vary the spacing to show what belongs together.

## Accessible as drawn

- Use real elements even in a static mockup: `<button>` for an action, `<a href>` for a link, an `<input>` with its `<label>` for a field. Never a clickable `<div>`.
- An icon-only button gets an `aria-label`. A decorative SVG gets `aria-hidden="true"`; one that carries meaning gets `role="img"` and an `aria-label`.
- Text needs a contrast of at least 4.5:1, small grey labels included, or 3:1 at 24 px and larger. 4.3:1 still fails: pick a shade that passes.
- Colours that must be told apart also differ in lightness, not in hue alone. Blue and orange read apart better than red and green.
- Touch targets are at least 44 px. Text meant for print is at least 12 pt.

## Changing it later

- The user may have edited the files since your last turn. Read a file again before you change it, and change only what was asked.
- Keep the same path, ids and file names: the user's comments are tied to them.

## Checking

Zorvo shows the result as soon as you call `show_artifact`, and the user checks it there. Check your source against this guide instead of opening it in a browser, taking screenshots or installing tools, unless the user asks you to.
