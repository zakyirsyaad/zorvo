# Redesign phase 1: foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the UI font to SF Pro, add the new type scale, and add the shared primitives (`StatusLine`, `Chip`, `Tabs`, `Popover`, `Toast`) that phases 2 to 6 build on, with today's notice banner moved onto `Toast`.

**Architecture:** Tokens live in `src/styles/globals.css` (`@theme`) and are mirrored in `docs/design-system/tokens.json`. Each primitive is one focused file in `src/components/ui/`, tested in `src/test/ui-primitives.test.tsx`, and documented in `docs/design-system/components/<Name>/` (README plus preview), which `design-system-docs.test.ts` requires. Only the notice banner is migrated in this phase; every other surface adopts the primitives in its own phase.

**Tech Stack:** React 19, Tailwind 4 (`@theme` tokens become utilities), Vitest with Testing Library (jsdom), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md` (on branch `docs/redesign-specs`; work on a branch made from it, or merge it first). Sections used: "Visual foundations", "Top bar" (chips), "Inspector" (tabs), "Menus, pickers, full diff review and small states" (popover style, toasts), "Accessibility", "Suggested phases".

## Global Constraints

- UI font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`. Code font stays Geist Mono. Instrument Sans leaves the UI (the logo wordmark is an SVG asset and keeps it).
- Type sizes: `ui` 13px (line 18px), `ui-sm` 12px (16px), `caption` 11px (16px), `body` 14px (22px), `micro` 10px (14px, badges only).
- Chips: 24px tall, 11px text, radius 6px (`rounded-md`). `radius-full` stays for status dots only.
- Popover style: `surface-3`, `border`, `shadow-popover`, `rounded-lg` (8px), 6px padding; options 30px tall, `rounded` (4px); the selected option has a check and `surface-hover`.
- Colors only from tokens (`design-tokens.test.ts` rejects raw colors); every focusable control gets `focus-ring`.
- Every status is a word next to its dot; color never carries meaning alone.
- Copy: sentence case, short declarative sentences, "you".
- Run `pnpm lint` and `pnpm test` (no cargo: nothing under `src-tauri/` changes).
- Conventional Commits; stage explicit paths only (other sessions share checkouts); add one `CHANGELOG.md` line under Unreleased.

## Review Focus

1. A popover closed with Escape must give focus back to its trigger, or keyboard users lose their place. (Task 5 test.)
2. A toast with a long message (a path or an error text) must wrap inside its 340px card, not overflow it. (Task 6 test.)
3. `Tabs` with a zero count must not render a "0" badge, and Home/End must reach the first and last tab. (Task 4 tests.)
4. A `Chip` with `onClick` must be a real `<button type="button">` with `focus-ring`, and one without must not be focusable. (Task 3 test.)
5. Removing the Instrument Sans package must leave no `"Instrument Sans"` reference in `src/` (fonts silently fall back otherwise). (Task 1 test.)

---

### Task 1: SF Pro and the type scale

**Files:**
- Modify: `src/styles/globals.css` (the `@theme` block: `--font-sans`, new `--text-*` tokens)
- Modify: `src/main.tsx:7` (drop `import "@fontsource-variable/instrument-sans";`)
- Modify: `package.json` (drop `@fontsource-variable/instrument-sans`; run `pnpm install` so `pnpm-lock.yaml` follows)
- Modify: `docs/design-system/tokens.json` (`type.families.sans`; App group styles)
- Modify: `docs/design-system/README.md` ("Type" section: SF Pro for UI, the sizes above, bundling note now only for Geist Mono)
- Modify: `CHANGELOG.md` (Unreleased: "The app uses the Mac's system font (SF Pro) for its interface.")
- Test: `src/test/design-system-docs.test.ts`

**Interfaces:**
- Produces: Tailwind utilities `text-ui`, `text-ui-sm`, `text-caption`, `text-body`, `text-micro` (each with its line height), and `font-sans` resolving to the SF Pro stack. Later tasks use only these names.

- [ ] **Step 1: Write the failing tests** in `design-system-docs.test.ts`, in the `tokens.json` describe block:
  - `it("uses the same sans stack as globals.css")`: read `--font-sans:` from `globals.css`; expect it to equal `tokens.type.families.sans`, and to start with `-apple-system`.
  - `it("has the type scale globals.css declares")`: for each of `ui` (13px/18px), `ui-sm` (12px/16px), `caption` (11px/16px), `body` (14px/22px), `micro` (10px/14px), expect `globals.css` to declare `--text-<name>: <size>` and `--text-<name>--line-height: <line>`, and the App group style of that name in `tokens.json` to carry the same `fontSize` and `lineHeight`.
  - `it("leaves no Instrument Sans in the app")`: read every `.ts`, `.tsx` and `.css` under `src/` (skip `src/test/`) and expect none to contain `Instrument Sans` or `instrument-sans`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/design-system-docs.test.ts`. Expected: the three new tests FAIL.
- [ ] **Step 3: Implement.** In `@theme`: `--font-sans` as in Global Constraints; `--text-ui: 13px; --text-ui--line-height: 18px;` and the same pair for `ui-sm`, `caption`, `body`, `micro`. In `tokens.json`: `families.sans` to the same string; App group: set `ui` to 13px/18px and add `ui-sm` (12px/16px, usage "Composer chips, tool rows, small buttons."). Drop the import and the package. Update the README's Type section and the changelog.
- [ ] **Step 4: Run** `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css src/main.tsx package.json pnpm-lock.yaml docs/design-system/tokens.json docs/design-system/README.md CHANGELOG.md src/test/design-system-docs.test.ts
git commit -m "feat: use SF Pro for the interface and add the type scale"
```

### Task 2: StatusLine

**Files:**
- Create: `src/components/ui/StatusLine.tsx`
- Create: `docs/design-system/components/StatusLine/README.md`, `docs/design-system/components/StatusLine/preview.html`
- Test: `src/test/ui-primitives.test.tsx`

**Interfaces:**
- Produces: `export type Status = "running" | "attention" | "unread" | "merged" | "danger" | "idle";` and `export function StatusLine(props: { status: Status; children: ReactNode; className?: string }): JSX.Element`.

- [ ] **Step 1: Write the failing tests** (`describe("StatusLine")`):
  - `it("puts the word next to a dot in the status color")`: `<StatusLine status="attention">Waiting for you</StatusLine>` renders the text; its dot has `aria-hidden="true"` and classes `rounded-full`, `size-1.5`, `bg-status-attention`.
  - `it("maps every status to its token")`: running → `bg-status-running`, unread → `bg-status-unread`, merged → `bg-status-merged`, danger → `bg-danger`.
  - `it("pulses only while running, and only when motion is allowed")`: the running dot has `motion-safe:animate-pulse`; the attention dot does not.
  - `it("shows no dot when idle")`: `status="idle"` renders the text and no element with `aria-hidden`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/ui-primitives.test.tsx -t StatusLine`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `StatusLine` as an inline-flex `span` (`gap-1.5 items-center`) with the dot first. Write the README (what it is; the consumer provides the word; the status-to-token list) and a preview in the format of `docs/design-system/components/StatusDot/preview.html`, one line per status, styled only with `bundle.css` classes and token variables.
- [ ] **Step 4: Run** `pnpm vitest run src/test/ui-primitives.test.tsx src/test/design-system-docs.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** the three new files and the test, message `feat: add StatusLine primitive`.

### Task 3: Chip

**Files:**
- Create: `src/components/ui/Chip.tsx`
- Modify: `docs/design-system/components/Chip/README.md`, `docs/design-system/components/Chip/preview.html` (add the plain and outline variants next to the attachment and code chips)
- Test: `src/test/ui-primitives.test.tsx`

**Interfaces:**
- Produces: `export function Chip(props: { variant?: "plain" | "outline"; icon?: ReactNode; onClick?: () => void; label?: string; className?: string; children: ReactNode }): JSX.Element`. Default variant `outline`. `label` becomes `aria-label` when the visible text is not enough (the diff chip).

- [ ] **Step 1: Write the failing tests** (`describe("Chip")`):
  - `it("is a button only when it has an action")`: with `onClick` the role is `button`, `type="button"`, class `focus-ring`, and a click calls the handler; without `onClick` there is no button and nothing in it is in the tab order.
  - `it("uses the chip size and radius")`: classes `h-6`, `text-caption`, `rounded-md`.
  - `it("draws a border only in the outline variant")`: outline has `border-border`; plain has `border-transparent`.
  - `it("hides its icon from assistive tech")`: the `icon` wrapper has `aria-hidden="true"`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/ui-primitives.test.tsx -t Chip`. Expected: FAIL.
- [ ] **Step 3: Implement** `Chip` (inline-flex, `gap-1.5 px-2 border`, `text-fg-secondary`; a button adds `enabled:hover:bg-surface-hover transition-colors`). Extend the Chip README with "Plain: session info in the top bar (branch, pull request). Outline: contextual chips you can click (Plan, background tasks, diff)." and the preview with one of each.
- [ ] **Step 4: Run** `pnpm vitest run src/test/ui-primitives.test.tsx src/test/design-system-docs.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** message `feat: add Chip primitive`.

### Task 4: Tabs

**Files:**
- Create: `src/components/ui/Tabs.tsx`
- Create: `docs/design-system/components/Tabs/README.md`, `docs/design-system/components/Tabs/preview.html`
- Test: `src/test/ui-primitives.test.tsx`

**Interfaces:**
- Produces: `export interface TabItem<T extends string> { id: T; label: string; count?: number }`, `export function tabIds(prefix: string, id: string): { tab: string; panel: string }` (`${prefix}-tab-${id}` and `${prefix}-panel-${id}`), and `export function Tabs<T extends string>(props: { tabs: readonly TabItem<T>[]; selected: T; onSelect: (id: T) => void; label: string; idPrefix: string; className?: string }): JSX.Element`. The consumer renders the panel with `id={tabIds(prefix, selected).panel}` and `aria-labelledby` the tab id.

- [ ] **Step 1: Write the failing tests** (`describe("Tabs")`, three tabs: Changes with count 3, Activity, Files):
  - `it("marks the selected tab")`: `role="tablist"` named by `label`; the selected tab has `aria-selected="true"`, `tabIndex` 0, classes `border-fg` and `text-fg`; the others `aria-selected="false"`, `tabIndex` -1, `text-fg-muted`; the selected tab's `aria-controls` is its panel id.
  - `it("moves and selects with the arrow keys, wrapping")`: ArrowRight on the last tab calls `onSelect` with the first and focuses it; ArrowLeft on the first goes to the last (the behavior of today's `SettingsTabs`).
  - `it("jumps with Home and End")`.
  - `it("shows a count only when it is above zero")`: "3" is shown for Changes; a tab with `count: 0` shows no number.
- [ ] **Step 2: Run** `pnpm vitest run src/test/ui-primitives.test.tsx -t Tabs`. Expected: FAIL.
- [ ] **Step 3: Implement** `Tabs` (buttons with `role="tab"`, `border-b-2`, `focus-ring`, `text-ui`, count in `text-caption text-fg-muted`). README: active tab underline, where it is used (inspector, MCP servers' Yours and Discover), the consumer owns the panel. Preview: the inspector's four tabs.
- [ ] **Step 4: Run** `pnpm vitest run src/test/ui-primitives.test.tsx src/test/design-system-docs.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** message `feat: add Tabs primitive`.

### Task 5: Popover

**Files:**
- Create: `src/components/ui/Popover.tsx`
- Create: `docs/design-system/components/Popover/README.md`, `docs/design-system/components/Popover/preview.html`
- Test: `src/test/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: `useDismiss(ref, isOpen, onClose)` from `src/hooks/useDismiss.ts`.
- Produces:
  - `export function Popover(props: { isOpen: boolean; onClose: () => void; trigger: ReactNode; label: string; role?: "menu" | "listbox" | "dialog"; side?: "bottom" | "top"; align?: "start" | "end"; className?: string; children: ReactNode }): JSX.Element`: a `relative` wrapper holding the trigger and, while open, the panel (`absolute z-50`; bottom: `top-full mt-1`; top: `bottom-full mb-1`; start: `left-0`; end: `right-0`; the classes from Global Constraints). Defaults: `role="menu"`, `side="bottom"`, `align="start"`.
  - `export function PopoverHeader(props: { children: ReactNode }): JSX.Element` (`text-caption font-medium text-fg-muted px-2 pt-1 pb-1.5`).
  - `export function PopoverOption(props: { selected?: boolean; onSelect: () => void; description?: string; trailing?: ReactNode; disabled?: boolean; children: ReactNode }): JSX.Element`: a button whose role is `option` inside a listbox popover and `menuitem` inside a menu popover (read from a context `Popover` provides); `aria-selected` on options; a check icon when `selected`.

- [ ] **Step 1: Write the failing tests** (`describe("Popover")`, a trigger button "Mode" that toggles `isOpen`):
  - `it("renders its panel only while open, named by label")`.
  - `it("closes on Escape and gives focus back to the trigger")`: open, focus an option, press Escape; `onClose` is called, and after the rerender with `isOpen=false` the trigger has focus.
  - `it("closes on a click outside but not inside")`: `mousedown` on `document.body` calls `onClose`; on an option it does not.
  - `it("opens above the trigger when side is top")`: the panel has `bottom-full` and `mb-1`.
  - `it("marks the selected option")`: in a listbox popover the selected `PopoverOption` has `role="option"`, `aria-selected="true"`, `bg-surface-hover` and a check; in a menu popover the role is `menuitem`.
  - `it("does not select a disabled option")`: clicking it does not call `onSelect`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/ui-primitives.test.tsx -t Popover`. Expected: FAIL.
- [ ] **Step 3: Implement** with `useDismiss` on the wrapper ref; when it goes from open to closed while focus was inside the panel, focus the first focusable element of the trigger. README: the one popover style, the roles, that the consumer places it inside an ancestor that does not clip, and that `DiffViewHeader`, `OptionDropdown`, `FolderPicker`, `AgentMultiPicker`, `SlashCommandMenu`, `MentionMenu`, `PlanMenu` and `BackgroundTasksMenu` move onto it in their phases. Preview: the composer's mode menu with one selected option and one described option.
- [ ] **Step 4: Run** `pnpm vitest run src/test/ui-primitives.test.tsx src/test/design-system-docs.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** message `feat: add Popover primitive`.

### Task 6: Toast, and the notice banner on it

**Files:**
- Create: `src/components/ui/Toast.tsx`
- Modify: `src/components/AppPlaceholders.tsx` (remove `NoticeBanner`)
- Modify: `src/App.tsx:11` and `src/App.tsx:968` (render the notice as a `Toast` in a `ToastStack` inside the main area instead of `NoticeBanner`)
- Create: `docs/design-system/components/Toast/README.md`, `docs/design-system/components/Toast/preview.html`
- Test: `src/test/ui-primitives.test.tsx`; existing tests that query "Dismiss notice" must keep passing unchanged.

**Interfaces:**
- Consumes: `Button` (`variant="outline"`) and `IconButton` from `src/components/ui/`.
- Produces: `export function Toast(props: { tone?: "info" | "warning" | "error"; message: string; action?: { label: string; onClick: () => void }; onDismiss: () => void }): JSX.Element` and `export function ToastStack(props: { children: ReactNode }): JSX.Element` (`absolute right-5 bottom-5 z-40 flex flex-col gap-2.5`, placed by `App.tsx` inside the main area's `relative` container). Default tone `warning`.

- [ ] **Step 1: Write the failing tests** (`describe("Toast")`):
  - `it("shows the message with a dismiss button")`: the text is visible; a button named "Dismiss notice" calls `onDismiss`.
  - `it("speaks errors as alerts and the rest as status")`: `tone="error"` gives `role="alert"` and class `border-danger`; `warning` and `info` give `role="status"`.
  - `it("runs its action")`: `action={{ label: "Try again", onClick }}` renders a button "Try again" that calls `onClick`.
  - `it("wraps a long message inside the card")`: with a 300-character message, the card has `w-[340px]` and the message `break-words`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/ui-primitives.test.tsx -t Toast`. Expected: FAIL.
- [ ] **Step 3: Implement** `Toast` (`bg-surface-3 border border-border rounded-[10px] shadow-popover p-3`; icon by tone: attention-colored for warning, `fg-muted` for info, danger for error; the action as an outline `Button`; dismiss as `IconButton` labelled "Dismiss notice"). In `App.tsx`, replace `NoticeBanner` with `<ToastStack><Toast message={notice} onDismiss={() => setNotice(null)} /></ToastStack>`, then delete `NoticeBanner`. README and preview: a warning, and an error with Try again.
- [ ] **Step 4: Run** `pnpm lint` then `pnpm test`. Expected: both PASS, including the existing notice tests.
- [ ] **Step 5: Commit** message `feat: show notices as toasts`.

### Task 7: Check the phase

- [ ] **Step 1:** `pnpm lint` and `pnpm test` from a clean tree. Expected: PASS.
- [ ] **Step 2:** `pnpm design-system` and open `http://localhost:5180`: the StatusLine, Chip, Tabs, Popover and Toast cards render in both themes in the system font.
- [ ] **Step 3:** `pnpm tauri dev`: the app renders in SF Pro; long session titles and paths still truncate rather than overflow; a notice (for example after a failed save) shows bottom right and dismisses.
- [ ] **Step 4:** Review the branch diff (`/code-review --fix` in Claude Code) before pushing.
- [ ] **Step 5:** After the phase merges, republish the Zorvo Design System artifact (https://claude.ai/artifact/8w2xRW4Fs8KZV7SyLYddpJ) from `docs/design-system/`, as its README says: each changed file at the same path under `project/` (`tokens.json`, `README.md`, the new and changed `components/<Name>/README.md` and `preview.html`, `components/bundle.css`), the index last. The artifact is never updated ahead of the repository.
