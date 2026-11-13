# Redesign v2, phase 1: foundations and shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the window its layered frame: new surface tokens, the sidebar on the ground, the chat and the inspector as raised sheets, with nothing in the chat or inspector vanishing on the new surface.

**Architecture:** Three new color tokens (`ground`, `sheet`, `chip`) and one radius (`radius-panel`) enter `globals.css` and `tokens.json` together. `App.tsx` gains a stage: the top bar, chat and diff view share one main sheet, and the inspector becomes a sibling sheet. Two small primitives (`segmented-style`, `AgentTile`) and the popover panel style land here because every later phase uses them. No session logic, hook or Tauri command changes.

**Tech Stack:** React 19, Tailwind 4 (`@theme` tokens), Vitest + Testing Library, Tauri 2.12 (window config, one Rust builder call).

**Spec:** `docs/superpowers/specs/2026-11-11-redesign-v2-design.md` (sections "Visual foundations" and "Window shell"). Artboard: `docs/superpowers/specs/2026-11-11-redesign-v2-artboards/Main.dc.html`. Read both before Task 1.

## Global Constraints

- Change `src/styles/globals.css` and `docs/design-system/tokens.json` together; `design-system-docs.test.ts` fails on drift.
- No raw colors in components (`design-tokens.test.ts`). Use the token utilities: `bg-ground`, `bg-sheet`, `bg-chip`, `rounded-panel`.
- The artboard decides the look; the spec decides behaviour and copy. No copy, `aria-label` or behaviour changes in this phase.
- A function the artboard does not draw stays (Close inspector, the resize handle, every top bar control).
- 30px in an artboard means today's 28px control. No new `Button` or `IconButton` size.
- `bg` and `surface-1` keep their values. Settings, onboarding and the agent catalog keep using them until phase 6; the draft chips (`DRAFT_CHIP`) until phase 5.
- Brand: color only for state; weights 400/500/600; every focusable control keeps `focus-ring`.
- No keyboard shortcuts are added.
- Run targeted Vitest files, not the whole suite; CI runs everything. `src-tauri/**` changes in Task 8, so `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` run once, in Task 9 (`pnpm build` first: Tauri embeds `dist/`).
- Work on branch `feat/redesign-v2-shell`. Stage explicit paths (`git add <path>`), never `git add -A`: other sessions share the checkout.
- Conventional Commits. No `Co-Authored-By` trailer.

## Review Focus

1. **A fill left on the old tokens.** In light mode `bg` and `surface-1` are the reverse of `sheet` and `ground`, so one missed class shows as a wrong patch. Task 6 adds a scan test.
2. **The window cannot be dragged.** The 8px strips around the sheets are new and carry no drag region today. Task 5 tests the stage's `data-tauri-drag-region`.
3. **The resize handle is clipped or unreachable.** The sheet clips its children for its radius. Task 5 tests that the separator is outside the clipped element.
4. **A narrow window.** At the 640px minimum with the inspector open, the insets must count in `isCrowded` or the chat drops under 560px. Task 5 tests the arithmetic at four widths.
5. **Traffic lights over a sheet's corner.** With the sidebar hidden, and in popouts, the native lights float over the main sheet. Task 8 pins the position in config and Rust, and Task 9's in-app check covers what a test cannot see.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/styles/globals.css` | modify | `--color-ground`, `--color-sheet`, `--color-chip` (dark and light), `--radius-panel` |
| `docs/design-system/tokens.json` | modify | The same four tokens with usage notes; new usage notes for `bg` and `surface-1` |
| `src/components/ui/segmented-style.ts` | create | The track and item classes of the segmented control |
| `src/components/ui/Tabs.tsx` | modify | Renders with the segmented classes; roles and keys unchanged |
| `src/components/ui/AgentTile.tsx` | create | A tile around an agent logo or icon, with an optional status badge |
| `src/components/ui/Popover.tsx`, `ui/Toast.tsx` | modify | Panel radius and padding, row radius, search field height |
| `src/lib/inspector.ts` | modify | `SIDEBAR_WIDTH` 264, `STAGE_INSET`, `isCrowded` |
| `src/App.tsx` | modify | Root fill, the stage, the main sheet, the inspector as a sibling |
| `src/components/Sidebar.tsx`, `ProfileFooter.tsx`, `TopBar.tsx` | modify | Frames only: width, fills, borders, header offset |
| `src/components/inspector/Inspector.tsx` | modify | Sheet frame; the resize handle outside the clip |
| `src/components/changes/DiffView.tsx` and the files Task 6 lists | modify | Fills that sit on a sheet |
| `src/components/PopoutApp.tsx` | modify | Ground root, one sheet |
| `src/components/settings/SettingsPage.tsx` | modify | Keeps `bg-bg` explicitly until phase 6 |
| `src-tauri/tauri.conf.json`, `src-tauri/src/windows.rs` | modify | Traffic-light position, main window and popouts |
| `src/test/sheet-fills.test.ts`, `src/test/agent-tile.test.tsx` | create | The scan test; the tile's tests |
| `docs/design-system/README.md`, `components/Tabs/*`, `components/AgentTile/*`, `components/Popover/README.md`, `CHANGELOG.md`, `CLAUDE.md` | modify or create | Docs in step with the code |

---

### Before Task 1: the branch and the documents

The spec, the artboards folder and this plan are untracked in the main checkout. They go in as the branch's first commit, so a worktree made from the branch has them.

- [ ] In the main checkout: `git checkout -b feat/redesign-v2-shell`
- [ ] Commit the documents:

```bash
git add docs/superpowers/specs/2026-11-11-redesign-v2-design.md docs/superpowers/specs/2026-11-11-redesign-v2-artboards docs/superpowers/plans/2026-11-11-redesign-v2-phase-1-shell.md
git commit -m "docs: add the redesign v2 spec, its artboards and the phase 1 plan"
```

- [ ] If another session works in the main checkout, switch it back to `main` and continue in a worktree of this branch (`git worktree add .claude/worktrees/redesign-v2-shell feat/redesign-v2-shell`).

### Task 1: Tokens

**Files:**
- Modify: `src/styles/globals.css` (the `@theme` block and the light block)
- Modify: `docs/design-system/tokens.json`
- Test: `src/test/theme-contrast.test.ts`

**Interfaces:**
- Produces: utilities `bg-ground`, `bg-sheet`, `bg-chip`, `ring-ground`, `ring-sheet`, `rounded-panel` for every later task.

- [ ] **Step 1: Write the failing tests** in `src/test/theme-contrast.test.ts`.

Change `SURFACES` to `["bg", "surface-1", "surface-2", "surface-3", "ground", "sheet"]`. Add a helper and a test:

```ts
/** A translucent `rgba(r, g, b, a)` token painted over an opaque hex one, as a hex. */
function flattened(rgbaToken: string, over: string): string

it.each(["sheet", "surface-2"])("text on the chip fill is readable over %s", (under) => {
  const fill = flattened("chip", under);
  for (const text of ["fg", "fg-secondary", "fg-muted", "fg-subtle"]) {
    expect(ratio(token(text), fill)).toBeGreaterThanOrEqual(4.5);
  }
});
```

`flattened` reads the raw light value of `--color-chip` from the light block (the existing `light` map holds only hex values, so read the rgba from `block` with a regex) and blends each channel: `round(a * c + (1 - a) * under)`.

- [ ] **Step 2: Run** `pnpm vitest run src/test/theme-contrast.test.ts src/test/design-system-docs.test.ts`. Expected: FAIL, "light block has no hex --color-ground".

- [ ] **Step 3: Add the tokens to `globals.css`.**

`@theme`, after `--color-surface-hover`:

```css
  /* The window behind the sidebar and the sheets; also wells (code, inputs) on a sheet. */
  --color-ground: #0a0a0b;
  /* The raised panels: chat, inspector. In light mode these two are the reverse of bg and surface-1. */
  --color-sheet: #111113;
  /* A translucent fill: chips, agent tiles, segmented tracks. */
  --color-chip: rgba(255, 255, 255, 0.06);
```

`@theme`, after the `--container-chat` line: `--radius-panel: 10px;`

Light block: `--color-ground: #f4f4f5;`, `--color-sheet: #fafafa;`, `--color-chip: rgba(9, 9, 11, 0.05);`

- [ ] **Step 4: Add the same tokens to `tokens.json`.**

`color.tokens` gains three entries after `surface-hover`, each `{name, value: {dark, light}, usage}` with the values above and these usage notes:
- `ground`: "The window behind the sidebar and the sheets; wells on a sheet: code boxes and inputs."
- `sheet`: "The raised panels: chat with its top bar, the inspector. Cards on it are `surface-2`."
- `chip`: "Translucent fill of composer chips, agent tiles and segmented tracks, on `sheet` or `surface-2`."

Rewrite two usage notes: `bg` → "Settings and onboarding pages until they move to `ground` and `sheet`; the marketing page background." `surface-1` → "The Settings nav and dialog bodies not yet moved to the v2 surfaces."

`radius.tokens` gains `{"name": "radius-panel", "value": "10px", "usage": "Sheets, menus, popovers and toasts."}` between `radius-lg` and `radius-xl`.

- [ ] **Step 5: Run** the two test files again. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/styles/globals.css docs/design-system/tokens.json src/test/theme-contrast.test.ts
git commit -m "feat: add the ground, sheet and chip tokens and the panel radius"
```

### Task 2: Segmented look for tabs

**Files:**
- Create: `src/components/ui/segmented-style.ts`
- Modify: `src/components/ui/Tabs.tsx`
- Test: `src/test/ui-primitives.test.tsx` (the `Tabs` block, line 439)

**Interfaces:**
- Produces:
  - `SEGMENTED_TRACK: string` = `"inline-flex gap-0.5 rounded-lg bg-chip p-0.5"`
  - `segmentedItem(isSelected: boolean): string` = `"flex h-6.5 items-center gap-1.5 rounded-md px-2.5 text-ui-sm transition-colors focus-ring"` plus `" bg-surface-hover text-fg"` when selected, else `" text-fg-muted hover:text-fg"`.
  - Phases 4 and 6 build a radio group and a toggle group on the same two exports.

- [ ] **Step 1: Change the failing test.** In the test at line 450–456, replace the `border-fg` assertion:

```ts
const list = screen.getByRole("tablist", { name: "Inspector" });
expect(list).toHaveClass("inline-flex", "gap-0.5", "rounded-lg", "bg-chip", "p-0.5");
expect(changes).toHaveClass("h-6.5", "rounded-md", "px-2.5", "text-ui-sm", "bg-surface-hover", "text-fg");
expect(changes).not.toHaveClass("border-b-2");
expect(screen.getByRole("tab", { name: "Activity" })).toHaveClass("text-fg-muted");
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/ui-primitives.test.tsx -t Tabs`. Expected: FAIL on `bg-chip`.
- [ ] **Step 3: Create `segmented-style.ts`** with the two exports, and use them in `Tabs.tsx`: the list's class becomes `SEGMENTED_TRACK` plus the caller's `className`; each tab's class becomes `segmentedItem(isSelected)`. The count's span keeps `text-fg-muted` and drops `text-caption`. Delete the `TAB` constant. Roles, ids, `tabIndex` and the key handler do not change.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/ui/segmented-style.ts src/components/ui/Tabs.tsx src/test/ui-primitives.test.tsx
git commit -m "feat: draw tabs as a segmented control"
```

### Task 3: AgentTile

**Files:**
- Create: `src/components/ui/AgentTile.tsx`
- Test: `src/test/agent-tile.test.tsx`

**Interfaces:**
- Consumes: `AgentLogo` (`profileId`, `name`, `size`) from `src/components/AgentLogo.tsx`.
- Produces:

```ts
export type AgentTileSize = 16 | 22 | 28;
export type AgentTileBadge = "attention" | "running" | "unread";
export interface AgentTileProps {
  /** The agent whose logo shows; omit it and pass an icon as children instead. */
  profileId?: string;
  /** Read out in place of the logo; "" when the name is written beside the tile. */
  name?: string;
  size?: AgentTileSize; // default 22
  badge?: AgentTileBadge;
  /** The color behind the tile, which the badge's ring takes. Default "ground". */
  badgeOn?: "ground" | "sheet" | "hover";
  children?: ReactNode;
  className?: string;
}
export function AgentTile(props: AgentTileProps): JSX.Element
```

Values: the tile is `relative inline-flex shrink-0 items-center justify-center bg-chip ring-1 ring-inset ring-border`; size 16 → `size-4 rounded` with a 10px logo; 22 → `size-[22px] rounded-md` with a 14px logo; 28 → `size-7 rounded-lg` with a 16px logo. The badge is a `span` `absolute -right-[3px] -bottom-[3px] size-2 rounded-full ring-2` with `bg-status-attention`, `bg-status-running` or `bg-status-unread`, and `ring-ground`, `ring-sheet` or `ring-surface-hover`. The badge is `aria-hidden`: the row's status words say the state.

- [ ] **Step 1: Write the failing tests** in `src/test/agent-tile.test.tsx`:

```tsx
it("draws the agent's logo in a 22px tile by default", () => {
  render(<AgentTile profileId="claude-acp" name="Claude Code" />);
  const logo = screen.getByRole("img", { name: "Claude Code" });
  expect(logo.parentElement).toHaveClass("size-[22px]", "rounded-md", "bg-chip", "ring-1", "ring-inset", "ring-border");
  expect(logo).toHaveAttribute("width", "14");
});
it.each([[16, "size-4", "rounded"], [28, "size-7", "rounded-lg"]] as const)("sizes the %ipx tile", (size, box, radius) => {
  const { container } = render(<AgentTile profileId="claude-acp" name="" size={size} />);
  expect(container.firstElementChild).toHaveClass(box, radius);
});
it("puts a badge on the corner with a ring in the color behind it", () => {
  const { container } = render(<AgentTile profileId="claude-acp" name="" badge="attention" badgeOn="hover" />);
  const badge = container.querySelector("[data-badge]");
  expect(badge).toHaveClass("size-2", "rounded-full", "bg-status-attention", "ring-2", "ring-surface-hover");
  expect(badge).toHaveAttribute("aria-hidden", "true");
});
it("shows no badge when none is asked for", () => {
  const { container } = render(<AgentTile profileId="claude-acp" name="" />);
  expect(container.querySelector("[data-badge]")).toBeNull();
});
it("holds an icon in place of a logo", () => {
  render(<AgentTile><svg data-testid="icon" /></AgentTile>);
  expect(screen.getByTestId("icon")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-tile.test.tsx`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `AgentTile`** to the interface above. The badge span carries `data-badge`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/ui/AgentTile.tsx src/test/agent-tile.test.tsx
git commit -m "feat: add the agent tile with its status badge"
```

### Task 4: Popover panel and toast

**Files:**
- Modify: `src/components/ui/Popover.tsx:33` (`POPOVER_PANEL_STYLE`), `:175` (`PopoverSearch`), `:231` (the option row), `src/components/ui/Toast.tsx:16`
- Test: `src/test/popover-rows.test.tsx`, plus any test the grep in step 1 finds

**Interfaces:**
- Produces: `POPOVER_PANEL_STYLE` = `"rounded-panel border border-border bg-surface-3 p-1 shadow-popover"`. `SlashCommandMenu` and `MentionMenu` import it and follow without edits.

- [ ] **Step 1: Find the pinned classes.** Run `grep -rln "p-1\.5\|h-7\.5\|\"rounded\"\|rounded-\[10px\]" src/test`. For each hit that asserts a popover panel, a popover row, the search field or a toast card, change the expectation: panel `rounded-lg` → `rounded-panel` and `p-1.5` → `p-1`; option row `rounded` → `rounded-md` (`popover-rows.test.tsx:69`); search field `h-7.5` → `h-7` and `rounded` → `rounded-md` (`:88–94`); toast `rounded-[10px]` → `rounded-panel`.
- [ ] **Step 2: Run** those test files. Expected: FAIL on the changed classes.
- [ ] **Step 3: Change the classes** in `Popover.tsx` and `Toast.tsx` to match. Row padding (`py-1.75`, `py-1.5`, `px-2`) and `min-h-7.5` do not change.
- [ ] **Step 4: Run** the same files. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Popover.tsx src/components/ui/Toast.tsx src/test
git commit -m "feat: give popovers and toasts the panel radius"
```

(Only this task stages `src/test` as a folder: the grep decides which files change. Check `git status` first and unstage anything that is not yours.)

### Task 5: The stage and the sheets

**Files:**
- Modify: `src/lib/inspector.ts`, `src/App.tsx:1186` and `:1228–1565`, `src/components/Sidebar.tsx:168–181`, `src/components/ProfileFooter.tsx` (its root), `src/components/TopBar.tsx:272`, `src/components/inspector/Inspector.tsx:97–132`, `src/components/changes/DiffView.tsx:173`
- Test: `src/test/inspector-layout.test.ts`, `use-inspector.test.tsx:90`, `chrome-wiring.test.tsx`, `profile-footer.test.tsx:67–73`, `inspector-frame.test.tsx`, `diff-view.test.tsx`

**Interfaces:**
- Consumes: Task 1's utilities.
- Produces: `SIDEBAR_WIDTH = 264`, `STAGE_INSET = 8` in `lib/inspector.ts`; in the DOM, `[data-stage]` (the stage), `[data-sheet="main"]` and `[data-sheet="inspector"]`. Later phases and tests find the sheets by these attributes.

- [ ] **Step 1: Write the failing tests.**

`inspector-layout.test.ts`, new cases for `isCrowded` (it now subtracts `2 * STAGE_INSET`):

```ts
expect(isCrowded(1280, 380, true)).toBe(false); // 1280 - 264 - 380 - 16 = 620
expect(isCrowded(1220, 380, true)).toBe(false); // exactly 560
expect(isCrowded(1219, 380, true)).toBe(true);
expect(isCrowded(1280, 560, true)).toBe(true);  // 440
expect(isCrowded(640, 560, false)).toBe(false); // no sidebar, never crowded
```

Fix the comment and numbers at `use-inspector.test.tsx:90` to `1280 - 264 - 560 - 16 leaves the chat 440px`.

`chrome-wiring.test.tsx`, in the test at "runs the sidebar the full height…": keep every existing assertion, and add:

```ts
const stage = document.querySelector("[data-stage]") as HTMLElement;
expect(stage.hasAttribute("data-tauri-drag-region")).toBe(true);
expect(stage).toHaveClass("gap-2", "py-2", "pr-2");
expect(stage).not.toHaveClass("pl-2");
const sheet = stage.querySelector('[data-sheet="main"]') as HTMLElement;
expect(sheet).toHaveClass("rounded-panel", "border", "border-border", "bg-sheet", "overflow-hidden");
expect(sheet.contains(screen.getByRole("banner"))).toBe(true);
expect(sidebar).toHaveClass("w-66");
expect(sidebar).not.toHaveClass("border-r", "bg-surface-1");
expect(sidebarHeader).toHaveClass("mt-2");
// after Hide sidebar:
expect(stage).toHaveClass("pl-2");
```

A new test in the same file, with the inspector opened through the top bar's Inspector button:

```ts
const inspector = screen.getByRole("region", { name: "Inspector" });
expect(inspector.parentElement).toBe(document.querySelector("[data-stage]"));
expect(document.querySelector('[data-sheet="main"]')!.contains(inspector)).toBe(false);
```

`profile-footer.test.tsx:71–73` becomes: the footer has neither `border-t` nor `bg-surface-1`.

`inspector-frame.test.tsx`, add:

```ts
const region = screen.getByRole("region", { name: "Inspector" });
const sheet = region.querySelector('[data-sheet="inspector"]') as HTMLElement;
expect(sheet).toHaveClass("rounded-panel", "border", "border-border", "bg-sheet", "overflow-hidden");
expect(region).not.toHaveClass("border-l", "bg-surface-1", "overflow-hidden");
const handle = screen.getByRole("separator", { name: "Resize inspector" });
expect(sheet.contains(handle)).toBe(false);
expect(handle).toHaveClass("-left-2", "w-2");
```

The strip's existing assertion (`h-12`, `pl-3`, `pr-2`) and the line and grip classes stay.

`diff-view.test.tsx`: where it asserts `bg-bg` on the diff view, assert it is absent; `border-border` stays.

- [ ] **Step 2: Run** `pnpm vitest run src/test/inspector-layout.test.ts src/test/use-inspector.test.tsx src/test/chrome-wiring.test.tsx src/test/profile-footer.test.tsx src/test/inspector-frame.test.tsx src/test/diff-view.test.tsx`. Expected: FAIL.

- [ ] **Step 3: `lib/inspector.ts`.** `SIDEBAR_WIDTH = 264`; add `/** The gap around and between the sheets. */ export const STAGE_INSET = 8;`; `isCrowded` returns `isSidebarShown && windowWidth - SIDEBAR_WIDTH - inspectorWidth - 2 * STAGE_INSET < MIN_CHAT_WIDTH`.

- [ ] **Step 4: `App.tsx`.**
  - The root `<main>`: `bg-bg` → `bg-ground`.
  - The `<div className="flex min-w-0 flex-1 flex-col">` that holds the top bar becomes two elements:

```tsx
<div data-stage data-tauri-drag-region className={`flex min-w-0 flex-1 gap-2 py-2 pr-2${isSidebarHidden ? " pl-2" : ""}`}>
  <div data-sheet="main" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-sheet">
    {/* TopBar, then the existing row: article and DiffView */}
  </div>
  {/* Inspector moves here, out of the row */}
</div>
```

  - The `<Inspector>` element, with its children, moves from the end of the inner row to after the main sheet. Nothing about its props changes.
  - The `<article>` loses `bg-bg`.

- [ ] **Step 5: Frames.**
  - `Sidebar.tsx`: the `<aside>` class becomes `w-66 shrink-0 flex flex-col justify-between select-none text-ui text-fg-secondary`; its header `div` gains `mt-2` (its center line then matches the top bar's, 32px from the window's top).
  - `ProfileFooter.tsx`: its root loses `border-t`, `border-border` and `bg-surface-1`.
  - `TopBar.tsx:272`: remove `bg-bg`. Everything else stays, including the 78px inset.
  - `DiffView.tsx:173`: remove `bg-bg`; `border-l border-border` stays.
  - `Inspector.tsx`: the `<section>` keeps its label, width style and `relative flex shrink-0 text-ui text-fg`, and loses `flex-col`, `border-l`, `border-border`, `bg-surface-1`. The separator stays its first child, with `-left-1` → `-left-2`; its line span `left-0.5` → `right-0`; its grip span `-left-0.5` → `left-0.5`. Everything after the separator (the 48px strip and the panel) goes into a new `<div data-sheet="inspector" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-sheet">`.

- [ ] **Step 6: Run** the command from step 2. Expected: PASS. Then run `pnpm vitest run src/test/top-bar.test.tsx src/test/inspector.test.tsx src/test/inspector-app.test.tsx src/test/navigation.test.tsx` and fix only assertions about the classes this task changed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/inspector.ts src/App.tsx src/components/Sidebar.tsx src/components/ProfileFooter.tsx src/components/TopBar.tsx src/components/inspector/Inspector.tsx src/components/changes/DiffView.tsx src/test/inspector-layout.test.ts src/test/use-inspector.test.tsx src/test/chrome-wiring.test.tsx src/test/profile-footer.test.tsx src/test/inspector-frame.test.tsx src/test/diff-view.test.tsx
git commit -m "feat: put the chat and the inspector on sheets over the window ground"
```

Add any other test file step 6 made you touch, by path.

### Task 6: Nothing may vanish

**Files:**
- Create: `src/test/sheet-fills.test.ts`
- Modify: every file the scan names (the known ones are listed in step 3)
- Test: the look tests of the files you change (`tool-card`, `chat-states`, `chat-messages`, `terminal-drawer`, and others the run shows)

**Interfaces:**
- Consumes: Task 1's utilities, Task 5's sheets.

- [ ] **Step 1: Write the failing scan test** `src/test/sheet-fills.test.ts`:

```ts
/** Files that keep the old surfaces until their own phase: Settings and onboarding (6), the agent catalog (6), the draft chips (5). */
const KEEPS_OLD_SURFACES = ["components/settings/", "components/agents/", "components/onboarding/", "components/Onboarding.tsx", "components/composer/chip-style.ts"];

it("paints nothing with bg or surface-1 outside the areas that have not moved yet", () => {
  // every .ts/.tsx under src/components plus src/App.tsx, minus KEEPS_OLD_SURFACES;
  // offenders = lines matching /\b(?:bg|ring|border|outline|fill|stroke|from|via|to)-(?:bg|surface-1)\b/,
  // reported as "path:line" (a ring that imitates the surface behind it counts too)
  expect(offenders).toEqual([]);
});
```

Walk the tree as `design-system-docs.test.ts`'s `sourceFiles` does.

- [ ] **Step 2: Run** `pnpm vitest run src/test/sheet-fills.test.ts`. Expected: FAIL with the list of offenders. That list is your worklist.

- [ ] **Step 3: Repaint each offender by this table.**

| What the element is | New fill |
| --- | --- |
| A panel root inside the inspector (`ChangesPanel.tsx:199`, `ActivityPanel.tsx:139`, `FilesPanel.tsx:280` and `:298`, `FileViewer.tsx:262`, `TerminalDrawer.tsx:120` when it has no tabs, `:170`) or the diff review's file list (`DiffFileList.tsx:18`) | none: remove the class |
| A dot or marker that must hide the line behind it (`ActivityEntryRow.tsx:17–20`) | `bg-sheet` |
| A card, a notice or a hover fill in the chat (`ToolsPart.tsx:37`, `AgentStallNotice.tsx:52`, `MessageRow.tsx:175`'s `group-hover:` fill) | `bg-surface-2` |
| A dialog body (`ImagePreviewDialog.tsx:56`, `DelegateDialog.tsx:283`, and any other `role="dialog"` the scan finds) | `bg-surface-2` |
| A well on a sheet or a card: a code box, a text field, the code area of a file (`MarkdownRenderer.tsx:20`, `ElicitationCard.tsx`, `ElicitationFields.tsx`, `ReplyExtras.tsx`, `ActionCard.tsx`, `LineCommentBox.tsx`, `ChangesPanel.tsx`'s commit field, `FileViewer.tsx`'s code well, `RenameField.tsx`, `BranchPicker.tsx`) | `bg-ground` |
| A fill, ring or edge that imitates the surface behind it: the backing of stacked logos (`sidebar/AgentsMenu.tsx:96`, `sidebar/RunGroupRow.tsx:47`), the avatar's mark | `ground` in the sidebar (`bg-ground`, `ring-ground`), `sheet` on a sheet |
| The popout's root and article | Task 7 |
| Anything the table does not cover | Decide by the layer order in the spec ("Visual foundations"), and name the file and your choice in the commit body |

- [ ] **Step 4: Run** the scan test. Expected: PASS, or only `PopoutApp.tsx` left for Task 7 (then add it to the test's expectation as the one known leftover and remove it in Task 7).
- [ ] **Step 5: Run the look tests** of every directory you touched (`pnpm vitest run src/test/tool-card.test.tsx src/test/tools-part.test.tsx src/test/chat-states.test.tsx src/test/chat-messages.test.tsx src/test/terminal-drawer.test.tsx src/test/activity-tab-look.test.tsx src/test/files-tab-look.test.tsx src/test/file-view-look.test.tsx src/test/changes-tab-look.test.tsx src/test/diff-review-look.test.tsx src/test/image-preview-dialog.test.tsx src/test/delegation-ui.test.tsx src/test/elicitation-card.test.tsx`) and change only the fill a test pins.
- [ ] **Step 6: Commit** with explicit paths:

```bash
git add src/test/sheet-fills.test.ts <each file you changed>
git commit -m "feat: repaint the chat and the inspector for the sheet surface"
```

### Task 7: Popout and Settings

**Files:**
- Modify: `src/components/PopoutApp.tsx:87–95`, `src/components/settings/SettingsPage.tsx` (its root element)
- Test: `src/test/popout.test.tsx`, `src/test/settings-parts.test.tsx`

- [ ] **Step 1: Write the failing tests.** In `popout.test.tsx`, beside the existing 78px inset assertion at `:180`:

```ts
const main = screen.getByRole("main");
expect(main).toHaveClass("bg-ground", "p-2");
expect(main.hasAttribute("data-tauri-drag-region")).toBe(true);
const sheet = main.querySelector('[data-sheet="main"]') as HTMLElement;
expect(sheet).toHaveClass("rounded-panel", "border", "border-border", "bg-sheet", "overflow-hidden");
expect(sheet.contains(screen.getByRole("banner"))).toBe(true);
```

In `settings-parts.test.tsx`: the Settings page's root element has `bg-bg` (the app's root no longer supplies it).

- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.** `PopoutApp.tsx`: `<main>` becomes `flex h-screen w-screen flex-col bg-ground p-2 text-fg-secondary` with `data-tauri-drag-region`; the `TopBar` and the `<article>` go inside `<div data-sheet="main" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-sheet">`; the article loses `bg-bg`. `SettingsPage.tsx`: add `bg-bg` to its root element.
- [ ] **Step 4: Run** both files and `src/test/sheet-fills.test.ts` (with the Task 6 leftover removed). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/PopoutApp.tsx src/components/settings/SettingsPage.tsx src/test/popout.test.tsx src/test/settings-parts.test.tsx src/test/sheet-fills.test.ts
git commit -m "feat: give popout windows the sheet frame"
```

### Task 8: Traffic lights

**Files:**
- Modify: `src-tauri/tauri.conf.json` (the main window), `src-tauri/src/windows.rs:95–100`
- Test: `src/test/window-config.test.ts`

**Interfaces:**
- Produces: `const TRAFFIC_LIGHT_POSITION: (f64, f64)` in `windows.rs`, equal to the config's `trafficLightPosition`.

The target: the lights' vertical center 32px from the window's top (the top bar's center line inside the sheet), and the first light's left edge 20px from the window's left.

- [ ] **Step 1: Write the failing test** in `window-config.test.ts`:

```ts
it("places the traffic lights the same way in the main window and in popouts", () => {
  const main = /* the "main" window of tauri.conf.json, as the test above reads it */;
  expect(main.trafficLightPosition.x).toBe(20);
  expect(typeof main.trafficLightPosition.y).toBe("number");
  const rust = readFileSync(resolve(__dirname, "../../src-tauri/src/windows.rs"), "utf8");
  const [, x, y] = rust.match(/TRAFFIC_LIGHT_POSITION: \(f64, f64\) = \(([\d.]+), ([\d.]+)\)/)!;
  expect([Number(x), Number(y)]).toEqual([main.trafficLightPosition.x, main.trafficLightPosition.y]);
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/window-config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `tauri.conf.json`, main window: `"trafficLightPosition": { "x": 20, "y": 26 }`. `windows.rs`: `const TRAFFIC_LIGHT_POSITION: (f64, f64) = (20.0, 26.0);` and, in the macOS builder chain, `.traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHT_POSITION.0, TRAFFIC_LIGHT_POSITION.1))`.
- [ ] **Step 4: Check it compiles and measure.** Run `pnpm tauri dev`. If the config key or the builder method is refused, stop and use the fallback below. Otherwise take a screenshot of the window's top-left corner with the sidebar shown, and one with it hidden: the lights' center must be 32px ± 1 from the top. If it is not, change only `y`, in both files, and measure again.
- [ ] **Step 5: Run** the test. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/windows.rs src/test/window-config.test.ts
git commit -m "feat: line the traffic lights up with the top bar"
```

**Fallback, only if Tauri 2.12 has no traffic-light position:** revert this task's three files; remove `mt-2` from the sidebar header; with the sidebar hidden, the stage takes `pt-7` in place of `py-2`'s top padding so the sheet starts under the lights, and the top bar takes no 78px inset in the main window. Update `chrome-wiring.test.tsx` to that, and say so in the pull request.

### Task 9: Docs and the whole-branch check

**Files:**
- Modify: `docs/design-system/README.md` (the "Color" section's first bullet and "Space, shape and elevation"), `docs/design-system/components/Tabs/README.md` and `preview.html`, `docs/design-system/components/Popover/README.md`, `docs/design-system/components/bundle.css`, `CHANGELOG.md`, `CLAUDE.md` ("Design system rules")
- Create: `docs/design-system/components/AgentTile/README.md` and `preview.html`

- [ ] **Step 1: Docs.**
  - README "Color", first bullet, becomes: "Paint the window `ground`; the sidebar sits on it. Raise the chat and the inspector as `sheet` panels with a `border` edge and `radius-panel`. On a sheet: the composer, cards and inputs `surface-2`; wells (code, fields inside a card) `ground`; menus and popovers `surface-3`; chips, tiles and segmented tracks `chip`. `bg` and `surface-1` remain only where a page has not moved yet."
  - README "Space, shape and elevation": add `radius-panel` (10px) for sheets, menus, popovers and toasts.
  - Tabs: the guideline and preview show the segmented look (track `chip`, 26px items, selected `surface-hover`); `bundle.css` follows.
  - Popover: radius 10, padding 4px, rows radius 6.
  - AgentTile: a guideline (what it is, the three sizes, the badge and its ring, that the status word always accompanies the badge) and a preview with the three sizes and the three badges. Follow `components/StatusDot/` for shape.
  - `CHANGELOG.md`, Unreleased → Changed: "The window has a layered look: the chat and the inspector are raised panels on the window's background."
  - `CLAUDE.md`, "Design system rules", first bullet: add that `ground`, `sheet` and `chip` are the v2 surfaces and that `sheet-fills.test.ts` fails on `bg-bg` or `bg-surface-1` outside Settings, onboarding and the agent catalog.
- [ ] **Step 2: Run** `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts src/test/theme-contrast.test.ts`. Expected: PASS.
- [ ] **Step 3: Run** `pnpm lint`. Expected: no errors, no warnings.
- [ ] **Step 4: Run** `pnpm build`, then from `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. Expected: all pass.
- [ ] **Step 5: The app beside the artboard.** Run `pnpm tauri dev` and compare with `Main.dc.html`, in dark and in light (Settings → Appearance):
  - the sidebar has no border and no fill of its own; the chat sheet and the inspector sheet have 8px around and between them and rounded corners;
  - the top bar is inside the chat sheet; the inspector's header is level with it;
  - dragging the strip above the sheets, the sidebar header and the top bar each move the window;
  - the resize handle shows on hover in the gap, drags, and answers the arrow keys;
  - with the sidebar hidden, the sheet has 8px at its left and the lights sit in the top bar's inset;
  - a popout window shows one sheet with the lights in its top bar;
  - at the minimum window size with the Terminal tab open, the sidebar gives way and the chat keeps its width;
  - open a session with tool calls, a code block, a permission request, a stalled notice (or the fake agent's), the full diff review, each inspector tab, the image preview and the delegate dialog: nothing is the same color as what it sits on;
  - Settings and onboarding look as they did before.
  Write down anything that differs from the artboard and is not on this list of deliberate differences: the tool group is still a card, the tabs' strip keeps its height, session rows and the top bar's content are untouched (phases 2 and 3).
- [ ] **Step 6: Commit**

```bash
git add docs/design-system CHANGELOG.md CLAUDE.md
git commit -m "docs: describe the v2 surfaces, the segmented tabs and the agent tile"
```

- [ ] **Step 7: Review before the push** (`/code-review --fix`), then push with `-u` and open the pull request. Its body lists the deliberate differences from step 5 and the result of the in-app check. After it merges, republish the Design System reference from `docs/design-system/`.
