# Redesign v2, phase 6: Settings and onboarding — Implementation Plan

**Goal:** Settings and the welcome screen take the v2 look: the Settings nav sits on the ground beside one sheet, Appearance becomes a segmented control, the agent rows use the shared tile and a filled sign-in chip, and the welcome screen is one centred sheet with the tick at the right of each row. After this phase no component paints with `bg` or `surface-1`.

**Architecture:** A restyle. No hook, rule, command or string changes, with one exception: Appearance's three preview tiles become three segments (same radio group, same keys, same `onChange`). `SettingsRow` gains one prop (`isCompact`) for the welcome screen's rows; everything else is class changes and swapping hand-made tiles for `AgentTile`.

**Spec:** `docs/superpowers/specs/2026-11-11-redesign-v2-design.md`, sections "Settings" and "Onboarding". Artboards: `SettingsGeneral`, `SettingsAgents`, `SettingsAppearanceGithub`, `Onboarding`. Built on phase 5.

## Global Constraints

- The artboard decides the look; the spec decides behaviour and copy. **No string changes.** Every sentence, label, accessible name and live-region text stays as it is today.
- What the artboards do not draw stays, restyled: "Registry checked …", the check error, the load-error card, Remove's question in a row, the failure lines, the "Soon" MCP item, "Run setup again", the unknown and checking GitHub states, the welcome screen's Check again, its hover-only Make default, its load and error rows, the offered folders and "Another folder".
- Not built, as the spec says: the artboards' "Open setup" button (Settings and onboarding) and the percent in the install line.
- No new `Button` or `IconButton` size or variant. No raw colors.
- Nothing under `src-tauri/**` changes; `tauri-contract.test.ts` passes unchanged. Run targeted Vitest files only. Stage explicit paths.

## Decisions taken in this plan

1. **The Settings nav is 240px, as the spec says**, though the sessions' sidebar is 264px. The sheet's left edge therefore sits 24px further left in Settings than behind it.
2. **Appearance keeps its keys.** The segments are the same `role="radio"` buttons with a roving tab stop; an arrow still moves to the next one and picks it. The preview tiles and their `.theme-sample-*` palettes in `globals.css` are deleted.
3. **"follows your Mac" loses its leading dot** and sits beside the track, only while System is picked (the artboard's text; today it is "· follows your Mac" inside the tile).
4. **Remove's question in an agent row** takes the method list's look (`sheet` fill, `border` edge, radius 8), since both sit inside the same `surface-2` card.
5. **A welcome row's name is weight 500 in every row** (the spec); it reads `fg` when ticked and `fg-secondary` when not (the artboard).
6. **The wordmark keeps its symbol.** The artboard writes only the word; the symbol is the brand's and is not a look decision.
7. **The GitHub account's name takes weight 500**, as the artboard draws it and as the agent names do. Everything else in that section changes only through `SettingsRow`.
8. **`sheet-fills.test.ts` loses its whole exemption list.** From this phase the rule covers every component and `App.tsx`; phase 7's sweep is then about the two tokens themselves.
9. **The 720px column stays `max-w-[720px]`.** `max-w-draft` has the same value but names the draft; a Settings token would be a third name for one number.

## Review Focus

1. **Nothing vanishes.** Each file's diff is classes and tiles; any removed element is listed in this plan (the preview tiles only).
2. **The scroller.** The sheet clips its corners and the section inside it scrolls; a new section still opens at its top (the `key`), the title still takes focus, and the top strip still drags the window.
3. **The tick at the right keeps its name and order.** `aria-label="Use <Agent>"` stays; in the Tab order the row's button now comes before its tick, which the tests that tab through a row must reflect.
4. **Contrast.** `fg-muted` on `surface-2` and on `sheet`, the chip's `fg-secondary` on `chip`, and the `fg-subtle` dot, in both themes (`theme-contrast.test.ts`).
5. **The popover in a card.** `SettingsGroup` still has no overflow clip, so the default agent list opens past the card's edge.

## Tasks

### Task 1: The Settings frame

`settings/SettingsPage.tsx`, `settings/SettingsNav.tsx`; tests `settings-page`, `settings-parts`.

- Page: `bg-ground` (today `bg-bg`).
- Nav: `w-60`, no border, no fill, `px-2`, `gap-0.5`; the drag strip `h-11`. Items `h-7.5 rounded-lg px-2.5 gap-2.5` in `fg-secondary`; the current one `bg-surface-hover text-fg font-medium`; Back to sessions in `fg-muted` with `mb-2.5`.
- The count on Agents: `min-w-4.5 h-4.5 px-1.25 rounded-md bg-chip text-caption text-fg`. The "Soon" tag takes the same `bg-chip`.
- Content: a wrapper `my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-panel border border-border bg-sheet` (`data-sheet="settings"`), and inside it today's keyed `section` as the scroller with `px-10 py-12`. The column stays `mx-auto max-w-[720px]`.

### Task 2: Groups and rows

`settings/SettingsGroup.tsx`; tests `settings-parts`.

- `SettingsRow`: the description becomes `text-ui-sm text-fg-muted` (today `fg-subtle`).
- New prop `isCompact`: `px-3.5 py-2.5`, `gap-3`, and 1px between label and description. Only the welcome screen passes it.
- `SettingsHeader` and `SettingsGroup` are already as drawn (20/28 600, the 11px 500 heading, `surface-2`, radius 12, no clip).

### Task 3: General

`settings/GeneralSection.tsx`, `settings/DefaultAgentPicker.tsx`; tests `settings-general`.

- Default agent button: a 16px `AgentTile` in place of the hand-made tile; the list's rows take 16px tiles too.
- Remove (and Cancel) on a recent folder: ghost, `tone="muted"` as today. Paths stay mono 11px, now `fg-muted` through the row.
- About and Setup rows: unchanged beyond the row's description colour.

### Task 4: Appearance

`settings/AppearanceSection.tsx`, `styles/globals.css`; tests `settings-appearance`, `use-appearance`; docs `design-system/components/Settings/README.md`.

- `role="radiogroup" aria-label="Theme"` on `SEGMENTED_TRACK`; each theme a `role="radio"` button with `segmentedItem(isChecked)` and `px-3.5`. Tab stop, arrows and `onChange` as today.
- Beside the track, 12px apart, while System is picked: "follows your Mac" in `text-ui-sm text-fg-subtle`.
- Delete `ThemeSample`, `Preview` and the two `.theme-sample-*` blocks in `globals.css`.

### Task 5: Agents

`agents/AgentCatalog.tsx`, `agents/AgentCatalogRow.tsx`, `agents/AgentSignIn.tsx`, `agents/SignInChip.tsx`, `agents/UnavailableAgents.tsx`; tests `settings-agents-look`, `agent-catalog-ui`, `settings-sign-in`.

- Search field: `border-border` (today `border-strong`); the rest as it is.
- Row: a 28px `AgentTile`; the name `font-medium text-fg`; the source line mono 11px in `fg-muted`; an available agent's line 12px `fg-muted`. An opened or installing row has **no tint** (the `bg-surface-1` goes).
- `SignInChip`: `h-5.5 rounded-md bg-chip px-2 text-caption text-fg-secondary`, no border, a 6px dot in every state: `status-running`, `status-attention`, `fg-subtle`. The sr-only "Sign-in: " stays.
- `AgentSignIn`: the method list `bg-sheet` with a `border` edge, radius 8; method names `fg-secondary`; descriptions, the lead lines and the session warning 12px `fg-muted`. Remove's question box takes the same fill and edge (Decision 4).
- `UnavailableAgents`: 28px `AgentTile`, reasons and descriptions in `fg-muted`.

### Task 6: GitHub

`settings/GithubSection.tsx`; tests `github-section`.

- The account's name in `font-medium`. Nothing else changes here; the heading stays "Connection" and the avatar keeps initials.

### Task 7: The welcome screen

`Onboarding.tsx`, `onboarding/AgentChoices.tsx`, `onboarding/FolderChoice.tsx`; tests `onboarding`, `onboarding-welcome`, `onboarding-flow`.

- Page: `bg-ground`, still the scroller. The content is one sheet, `my-auto w-full max-w-[640px] rounded-xl border border-border bg-sheet p-8`, `gap-6` between its blocks, so it is centred when short and scrolls from its top when tall.
- Header: `gap-2.5`; the title `text-xl font-semibold tracking-[-0.02em]` (today 28/34); the sentence `text-ui leading-5 text-fg-muted`.
- Numbered heading: the ring's number at weight 500.
- Agent rows: `SettingsRow isCompact`; a 22px `AgentTile` as `leading`; the name per Decision 5; the Default tag `h-4.5 rounded bg-chip px-1.5 text-caption font-medium text-fg-muted`, no border. The tick moves into `control`, after the row's button; its check reads `text-on-primary` (today `text-bg`) on `checked:bg-primary checked:border-primary`.
- Folder rows: `isCompact`, a 22px `AgentTile` holding the 12px folder icon; the name `font-medium text-fg`.
- Footer: no top padding; Start keeps `size="lg"` with `px-5`.

### Task 8: The rule, docs and checks

`test/sheet-fills.test.ts`, `CLAUDE.md`, `docs/design-system/components/Settings/README.md`, `docs/design-system/components/Onboarding/README.md`, `CHANGELOG.md`.

- Empty `KEEPS_OLD_SURFACES` and drop the filter that reads it; reword the test's name.
- `CLAUDE.md`, "Design system rules": the sentence about the areas that keep `bg` and `surface-1` until phase 6 becomes "no component uses them".
- The two READMEs describe the new frame, the segmented theme control, the chip and the welcome sheet. One line under `Unreleased`.
- Run: `pnpm lint`; the test files named in each task; `sheet-fills`, `design-tokens`, `theme-contrast`, `design-system-docs`, `tauri-contract`.
- In-app check against the four artboards in both themes, together with phases 3 to 5.
