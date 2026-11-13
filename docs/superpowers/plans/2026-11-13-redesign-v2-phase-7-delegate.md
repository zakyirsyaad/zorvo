# Redesign v2, phase 7: Delegate, then the sweep — Implementation Plan

**Goal:** The delegate screens take the v2 look: the working line shows the running arc, a failed turn and a waiting answer become titled cards with an outline Open, the "Delegated from" line gets its icon, the dialog and the mention list use the shared tiles. Then the window's own background follows the ground, so nothing in the app paints with the old two surfaces.

**Architecture:** A restyle. No hook, rule, command or string changes. `useDelegation`, the dialog's state and the mention menu's keyboard list stay as they are.

**Spec:** `docs/superpowers/specs/2026-11-11-redesign-v2-design.md`, section "Delegate", and the last row of its phases table. Artboards: `DelegateMenu`, `DelegateDialog`, `DelegateSource`, `DelegateTarget`, `DelegateReport`, `DelegateMention`. Built on phase 6 (PR 205). It rests on one read-only audit of the six artboards against the code, spot-checked.

## Global Constraints

- The artboard decides the look; the spec decides behaviour and copy. **No string changes.**
- What the artboards do not draw stays: the dialog's single "Default" chip and its asking and failed states, the risky mark on the permission chip, a row's hover in the dialog, End delegation outside the blocked frame.
- No new `Button`, `IconButton` or `PopoverOption` size, variant or prop. No raw colors.
- Nothing under `src-tauri/**` changes; `tauri-contract.test.ts` passes unchanged. Run targeted Vitest files only. Stage explicit paths.

## Decisions taken in this plan

1. **30px buttons are today's 28px** (the dialog's Cancel and Delegate, the composer's "Delegate to Codex"), by the spec's standing rule. They do not change.
2. **Popover padding stays 4px**, as the spec's popover panel says; the two delegate artboards draw 6px.
3. **The ghost Open on the working line keeps radius 8**, since `Button` has one radius; the artboard draws 6.
4. **The More menu's blocked Delegate item keeps its layout**: the reason under the row, as `PopoverOption` draws a description. Putting it under the label, beside the icon, needs an icon slot in the primitive. Only the menu's width (240px) and the rule's margin (4px) change.
5. **The report's quote and file paths stay as they are.** The quote is the shared markdown blockquote (changing it changes every agent reply), and the paths are part of the message's text.
6. **The agent's own "is working" line keeps its dot**, as phase 3 drew it from `ChatStates`; `DelegateReport` draws an arc there too.
7. **The sweep stops at the window's background.** `body` paints `ground` in place of `bg` (in light mode they differ). The tokens `bg` and `surface-1` themselves stay for now: the design-system reference (its previews, `bundle.css`, the viewer) still uses them and has not been redrawn since phase 2. Removing them is a decision for the user, with that redraw.

## Review Focus

1. **The status region stays one always-mounted `role="status"`**, so a card is announced as the line was; a card adds no second live region or `role="alert"`.
2. **Not by colour alone.** Each card has its icon and its sentence; "Needs sign-in" keeps its dot and its words when the text turns `fg-muted`.
3. **The arc respects reduced motion** (`motion-safe:animate-spin`), as the tool rows' arc does.
4. **The mention list's keyboard list is untouched**: only classes and the tile change, so the highlighted index still walks pickable agents and then files.

## Tasks

### Task 1: The status line and its cards

`delegation/DelegationStatusLine.tsx`; test `delegation-ui`.

- Working lines (source and target): `gap-2`, a 14px `LoaderCircle` in `status-running` that spins under `motion-safe`, the sentence in `text-ui text-fg-muted`, the time as today, the ghost Open as today.
- Needs your answer: a card, `flex items-center gap-2.5 rounded-xl border border-attention-border bg-attention-surface px-3 py-2.5`; a 14px `TriangleAlert` in `status-attention`; the sentence in `text-ui font-semibold text-fg`, taking the free width; Open as `Button variant="outline" size="md"`.
- Failed: the same card with `border-danger bg-danger-surface` and today's `CircleAlert` in `danger`.

### Task 2: The "Delegated from" line

`delegation/DelegatedFromLine.tsx`; test `delegation-ui`.

- All three states: `flex items-center gap-2 text-ui-sm text-fg-muted` with a leading 12px `Split` icon. Open stays an underlined text button, now `text-ui-sm`.

### Task 3: The dialog

`delegation/DelegateDialog.tsx`; test `delegation-ui`.

- Title `text-body`; the agent list 4px apart; a 22px `AgentTile` in each row; the picked name at weight 500; "Needs sign-in" in `fg-muted` beside its attention dot.
- Task field: `bg-ground`, 20px lines, and a `danger` edge while the task is missing; the error line `text-ui-sm`.
- "<Agent> starts on" row: wraps, 8px apart. The hint `text-ui-sm leading-[17px] text-fg-muted`.

### Task 4: The mention list and the More menu

`composer/MentionMenu.tsx`, `TopBar.tsx`; tests `mention-delegation`, `top-bar`.

- Agent rows: `min-h-7`, the name `text-ui`, a 16px `AgentTile`, "Needs sign-in" in `fg-muted` beside its dot. File rows `py-1`. The rule between the lists `my-1`.
- More menu: `w-[240px]`; the rule before Archive `my-1`.

### Task 5: The window's background, docs and checks

`styles/globals.css`, `docs/design-system/tokens.json` (the two tokens' usage lines), `docs/design-system/components/Message/README.md` or the nearest delegate notes, `CHANGELOG.md`.

- `body` paints `var(--color-ground)`.
- The two tokens' usage lines say that no component uses them and that the design-system reference still does.
- Run: `pnpm lint`; `delegation-ui`, `mention-delegation`, `message-row-delegation`, `top-bar`, `site`; `sheet-fills`, `design-tokens`, `theme-contrast`, `design-system-docs`, `tauri-contract`.
- In-app check against the six artboards in both themes, together with phases 3 to 6.
