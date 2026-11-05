# Redesign phase 8b2: composer, draft and pickers as drawn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the composer, the new-session draft, its folder, branch and agent pickers, and the composer's menus match the design canvas.

**Architecture:** Restyle only. Behavior, props that carry data, and the one-`ComposerDock` rule (CLAUDE.md "Messages that did not reach the agent", "Diff comments") stay as they are. Start with the shared `ui/Popover` row and search field, since every menu here uses them. Then the composer's chips and row, then the draft's chips, layout and pickers, then the session list. Each task pins its artboard values with Testing Library class and text assertions in a new test file, and migrates the old assertions it breaks.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-05-canvas-conformance-audit.md`, section "8b", the bullets **Composer**, **New-session draft**, **Draft pickers** and **Composer menus**. The artboards are `NewSession.dc.html`, `DraftPickers.dc.html` and `ComposerMenus.dc.html`, plus the composer in `Main.dc.html` (lines 100–113), all in the "Zorvo redesign layouts" Design artifact (https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz, `project/`). Behavior comes from `docs/superpowers/specs/2026-11-04-main-window-redesign-design.md` ("Composer", "New-session draft").

## Global Constraints

- The artboard decides the look; the spec decides behavior. The user's earlier choices stand: the agent chip stays in the composer, chips use radius 6, and branch and PR chips are borderless.
- Canvas variable → token: `--s1` `surface-1`, `--s2` `surface-2`, `--s3` `surface-3`, `--hover` `surface-hover`, `--line` `border`, `--strong` `border-strong`, `--fg2` `fg-secondary`, `--muted` `fg-muted`, `--subtle` `fg-subtle`, `--att` `status-attention`. Type: 13/18 `text-ui`, 12 `text-ui-sm`, 11 `text-caption`, 14/22 `text-body`.
- No raw colours in components (`design-tokens.test.ts`). No new colour tokens are needed.
- Every focusable control keeps `focus-ring` (or `focus-ring-within` on a wrapper whose input has none).
- Use `ui/Button`, `ui/IconButton` and `ui/Popover` before hand-styling.
- In Tailwind 4, two utilities for one property on one element have no reliable winner. Expose an option (`size`, `tone`, `variant`) instead of overriding a primitive's class.
- UI copy: sentence case, "you", name the agents.
- No keyboard shortcuts and no voice input.
- Run the targeted test files while working. Run the full suite once, at the end.

## Review Focus

1. **A crowded draft agent chip.** With four agents ticked, each with a long name, the chip must truncate its names inside the row and never widen it. The `max-w-full` and `truncate` behavior from today stays. Task 6, test "truncates four long names".
2. **A risky mode after the icons go.** Dropping the chips' leading icons must not drop the risky-mode warning. A risky selected mode keeps a `ShieldAlert` on its chip, now after the label. Task 3, test "marks a risky mode after its name".
3. **The agent menu by keyboard.** The checkbox moves to the left of the name. The arrow keys must still step through every enabled button. A disabled agent's checkbox must still say why, now through the status word on its row (`aria-describedby`). Task 8, tests "arrow keys reach the checkbox and the name" and "a blocked agent's checkbox is described by its status".
4. **Continue, from the keyboard.** The session list's Continue shows on hover. It must also show on keyboard focus. Its text must not repeat in the row's accessible name. Task 9, test "Continue shows on focus and is not read twice".
5. **A placeholder that follows the request.** While a permission or question card waits, the placeholder reads "Answer the request above to continue". Once the card is answered it goes back to "Reply to <Agent>". A popout, which knows no waiting card, reads "Reply to <Agent>". Task 4, tests in `composer-state.test.ts` and "a popout replies to its agent".

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/components/ui/Popover.tsx` | The check on the left, subtle descriptions, `PopoverSearch`, and `PopoverHeader`'s `aside` | 1 |
| `src/components/composer/OptionDropdown.tsx` | Mode/model menus: heading, risky shield after the name, search field, width | 2, 3 |
| `src/components/composer/SlashCommandMenu.tsx`, `MentionMenu.tsx` | The `/` and `@` rows as drawn | 2 |
| `src/components/composer/chip-style.ts` | `COMPOSER_CHIP` (in the card's row) and new `DRAFT_CHIP` (above the card) | 3, 5 |
| `src/components/ComposerDock.tsx` | The card, the row, the session agent chip, Send/Stop, the note in the row | 3, 4, 5 |
| `src/components/composer/ContextMeter.tsx`, `AttachmentChips.tsx` | "38% of context" text, the remove button inside the thumbnail | 4 |
| `src/lib/composer-state.ts` | Placeholders while running; the compare note's words | 4, 5 |
| `src/components/composer/DraftChips.tsx`, `FolderPicker.tsx`, `BranchPicker.tsx` | Draft chips and the branch menu | 5, 7 |
| `src/components/composer/AgentMultiPicker.tsx`, `src/lib/composer-controls.ts` | The agent chip's logos and names, the agent menu | 6, 8 |
| `src/hooks/useBranchPicker.ts` | `BranchControl.checkedOut` | 7 |
| `src/components/workspace/NewSessionView.tsx`, `AgentSessionList.tsx` | The draft's column and the session list | 5, 9 |
| `src/App.tsx` | Composer wrapper padding, `sessionAgent`, placeholder inputs, `noteInRow` | 3, 4, 5 |
| `docs/design-system/components/{Composer,Popover}/{README.md,preview.html}`, `CHANGELOG.md` | Docs | 10 |

---

### Task 1: Popover rows and search field as drawn

The artboard values (`ComposerMenus.dc.html` `.opt`/`.d`/`.hd`, `DraftPickers.dc.html` `.opt`/`.srch`) are:

- **An option:** `gap:8px; padding:7px 8px; border-radius:4px`, at 30px tall when it has one line. A checkable row keeps a 14px slot on the left, holding the check (`color: var(--fg)`, `margin-top:2px`) or nothing.
- **A description:** 11px, line-height 15px, `--subtle`.
- **A heading:** `padding:6px 8px 4px; 11px/500 --muted`. The agent menu's heading has an aside at weight 400 in `--subtle`.
- **The search field:** `height:30px; gap:8px; padding:0 8px; border-radius:4px; background --s2; border 1px --line; color --subtle`. It holds a 12px search icon and a 12px input in `--fg`.

**Files:**
- Modify: `src/components/ui/Popover.tsx`
- Test: `src/test/popover-rows.test.tsx` (new). Migrate the check-position assertions in `src/test/ui-primitives.test.tsx` if any break.

**Interfaces:**
- Produces:
  - `PopoverOption`'s `selected?: boolean` now defaults to `undefined`. A row with `selected !== undefined` or `isRadio` is checkable and gets the left slot; menu items that never pass `selected` (top bar, session menu, new-session menu) get no slot.
  - `PopoverHeader({ children, aside }: { children: ReactNode; aside?: ReactNode })`.
  - `PopoverSearch(props: { value: string; onChange: (value: string) => void; placeholder: string; type?: "search" | "text"; autoFocus?: boolean; inputRef?: Ref<HTMLInputElement>; onKeyDown?: KeyboardEventHandler<HTMLInputElement> })`. Its `aria-label` is `placeholder`, and `type` defaults to `"text"`.

- [ ] **Step 1: Write the failing tests** in `src/test/popover-rows.test.tsx`:

```tsx
it("puts a checkable row's check on the left, in a 14px slot", () => {
  render(<Popover isOpen onClose={() => {}} label="Mode" role="listbox" trigger={<button>Mode</button>}>
    <PopoverOption selected onSelect={() => {}}>Ask</PopoverOption>
    <PopoverOption selected={false} onSelect={() => {}}>Plan</PopoverOption>
  </Popover>);
  const [ask, plan] = screen.getAllByRole("option");
  const slot = ask.firstElementChild as HTMLElement;
  expect(slot).toHaveAttribute("data-check-slot");
  expect(slot).toHaveClass("w-3.5", "shrink-0");
  expect(slot.querySelector("svg")).not.toBeNull();
  expect((plan.firstElementChild as HTMLElement).querySelector("svg")).toBeNull();
  expect(ask.lastElementChild?.querySelector("svg")).toBeNull(); // no check on the right any more
});

it("gives a plain menu item no check slot", () => {
  render(<Popover isOpen onClose={() => {}} label="Actions" trigger={<button>⋯</button>}>
    <PopoverOption onSelect={() => {}}>Rename</PopoverOption>
  </Popover>);
  expect(screen.getByRole("menuitem").querySelector("[data-check-slot]")).toBeNull();
});

it("writes a description at 11/15 in fg-subtle and tops the row", () => {
  render(/* listbox with one option, description "Reads and plans." */);
  const option = screen.getByRole("option");
  expect(option).toHaveClass("items-start", "py-1.75", "px-2", "rounded", "gap-2");
  expect(screen.getByText("Reads and plans.")).toHaveClass("text-caption", "leading-[15px]", "text-fg-subtle");
});

it("draws the search field 30px with its icon", () => {
  render(<PopoverSearch value="" onChange={() => {}} placeholder="Search branches" />);
  const input = screen.getByRole("textbox", { name: "Search branches" });
  const field = input.closest("label")!;
  expect(field).toHaveClass("focus-ring-within", "flex", "h-7.5", "items-center", "gap-2", "rounded", "border", "border-border", "bg-surface-2", "px-2", "text-fg-subtle", "mb-1");
  expect(field.querySelector("svg")).not.toBeNull();
  expect(input).toHaveClass("min-w-0", "flex-1", "bg-transparent", "text-ui-sm", "text-fg", "outline-none");
});

it("keeps type search when asked", () => {
  render(<PopoverSearch type="search" value="" onChange={() => {}} placeholder="Search model" />);
  expect(screen.getByRole("searchbox", { name: "Search model" })).toBeInTheDocument();
});

it("puts a header's aside on the right in fg-subtle", () => {
  render(<PopoverHeader aside="Pick more than one to compare">Agents</PopoverHeader>);
  const aside = screen.getByText("Pick more than one to compare");
  expect(aside).toHaveClass("font-normal", "text-fg-subtle");
  expect(aside.parentElement).toHaveClass("flex", "pt-1.5", "pb-1", "px-2", "text-caption", "font-medium", "text-fg-muted");
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/test/popover-rows.test.tsx`. Expected: FAIL (no `data-check-slot`, no `PopoverSearch`).
- [ ] **Step 3: Implement it in `Popover.tsx`:**
  - `OPTION`: replace `items-center py-1` with `py-1.5`. A row with a description gets `items-start py-1.75`; any other row gets `items-center`.
  - The check slot is `<span data-check-slot="" aria-hidden="true" className="flex w-3.5 shrink-0 justify-center pt-0.5">`, holding `Check` (`size-3.5 text-fg`) when selected. It replaces the right-hand check.
  - The description becomes `text-caption leading-[15px] text-fg-subtle`.
  - The header becomes `flex items-baseline gap-2 px-2 pt-1.5 pb-1 text-caption font-medium text-fg-muted`, with the children in a `flex-1` span and the aside as `<span className="font-normal text-fg-subtle">`.
  - `PopoverSearch`: a `label` with the classes the test names, then `Search` (12px, `aria-hidden`), then the input.
- [ ] **Step 4: Run** `pnpm vitest run src/test/popover-rows.test.tsx src/test/ui-primitives.test.tsx`. Expected: PASS. Migrate any `ui-primitives` assertion that pinned the old header padding or the right-hand check, and nothing else.
- [ ] **Step 5: Commit:** `git add src/components/ui/Popover.tsx src/test/popover-rows.test.tsx src/test/ui-primitives.test.tsx` then `git commit -m "feat: popover rows check on the left, with a 30px search field"`.

---

### Task 2: Mode, model, slash and mention menus as drawn

The artboard values (`ComposerMenus.dc.html`):

- **Mode:**
  - a "Mode" heading;
  - a risky mode's shield comes *after* its name, 12px in `--att`, as `role="img" aria-label="Lets the agent act without asking"`;
  - its subtle line reads "Edits files without asking. Lets the agent act without asking.".
- **Model:**
  - the search field;
  - matches in bold 600;
  - "2 of 14 models" in 11px `--subtle` with `padding:6px 8px 2px`;
  - width 300.
- **Slash:**
  - the heading "Commands from Claude Code";
  - each row stacks the command (mono 12, `--fg`) over its description (11/15, `--subtle`).
- **Mentions:**
  - the heading "Files in agent-desktop";
  - a 14px file icon in `--subtle` with `margin-top:2px`;
  - the name in mono 12 with the match in bold;
  - the folder in mono 11/15 `--subtle`.

**Files:**
- Modify: `src/components/composer/OptionDropdown.tsx`, `src/components/composer/chip-style.ts` (`RISKY_LINE`), `src/components/composer/SlashCommandMenu.tsx`, `src/components/composer/MentionMenu.tsx`, `src/components/ComposerDock.tsx` (pass `heading="Mode"` for the permission control)
- Test: `src/test/composer-menus.test.tsx` (new). Migrate `src/test/option-dropdown.test.tsx` (the risky-line assertions), `src/test/composer-mentions.test.tsx:49` and `src/test/composer-slash.test.tsx`.

**Interfaces:**
- Consumes: `PopoverSearch` and `PopoverHeader` from Task 1.
- Produces:
  - `OptionDropdownProps.heading?: string`, a visible `PopoverHeader` over the options.
  - `RISKY_LINE` keeps its words, "Lets the agent act without asking", which the shield's `aria-label` also uses.

- [ ] **Step 1: Write the failing tests** in `src/test/composer-menus.test.tsx`:
  - **Mode menu.** Render `OptionDropdown` open with `heading="Mode"` and the options Ask (described "Asks you before it changes a file or runs a command."), Plan, and Accept edits (risky, described "Edits files without asking.").
    - `getByText("Mode")` is inside a `PopoverHeader`.
    - The Accept edits option's name text node is followed by `getByRole("img", { name: "Lets the agent act without asking" })` (its `compareDocumentPosition` puts it after the name) with `text-status-attention`.
    - `getByText("Edits files without asking. Lets the agent act without asking.")` has `text-fg-subtle`.
    - No element in the option has `text-danger`.
  - **Model menu.** Render it with 14 options.
    - The panel (`getByRole("dialog", { name: "Model" })`) has `w-75`.
    - Typing "son" in the searchbox "Search model" leaves `getByText("2 of 14 models")` with `text-fg-subtle` and `pt-1.5`.
    - A match is a `mark` with `font-semibold`.
  - **Width.** A menu whose options have no descriptions and no search (Low, Medium, High) keeps `w-max`, `min-w-40` and `max-w-80`.
  - **Slash row.** For `{ name: "review", description: "Review the changes on this branch" }`:
    - the option has `flex-col` and `py-1.75`;
    - `getByText("/review")` has `font-mono`, `text-ui-sm` and `text-fg`;
    - the description has `text-caption`, `leading-[15px]` and `text-fg-subtle`.
  - **Mention row.** For `src/components/sidebar/SessionList.tsx` with query "Session":
    - the option has `items-start`, `gap-2` and an `svg` first child;
    - `getByText("src/components/sidebar")` has `font-mono`, `text-caption` and `text-fg-subtle`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/composer-menus.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it:**
  - **`OptionDropdown`:**
    - `heading` renders `<PopoverHeader>` first.
    - `detailOf` returns one string: the description and `${RISKY_LINE}.` joined by a space, or the risky line alone when there is no description.
    - The shield moves after the label span.
    - `SearchableOptions` uses `PopoverSearch type="search"`, and its count line is `px-2 pt-1.5 pb-0.5 text-caption text-fg-subtle`.
    - The panel class is `w-75` when `hasSearch || options.some((o) => o.description || o.risky)`, else `w-max min-w-40 max-w-80`.
  - **`SlashCommandMenu` and `MentionMenu`:** the rows as the tests say, with the mention icon `FileText` (14px, `text-fg-subtle`, `mt-0.5`).
- [ ] **Step 4: Run** `pnpm vitest run src/test/composer-menus.test.tsx src/test/option-dropdown.test.tsx src/test/composer-mentions.test.tsx src/test/composer-slash.test.tsx src/test/composer-dropdown-renders.test.tsx`. Expected: PASS after the migrations.
- [ ] **Step 5: Commit** those files with `feat: the composer's mode, model, slash and mention menus as drawn`.

---

### Task 3: The composer card and its row as drawn

The artboard values (`Main.dc.html` 100–113):

- **The wrapper:** `padding: 0 24px 20px`.
- **The card:**
  - `max-width:680px`;
  - `flex-direction:column; gap:10px; padding:12px; border-radius:12px`;
  - `--s2` fill, a `--line` border and the pop shadow.
- **The textarea:** `rows=2`, 14/22, `padding:0 4px`.
- **The row:** `display:flex; align-items:center; gap:4px`, with **no** divider above it.
- **Attach:** a 28px button, radius 6, in `--muted`, with a paperclip icon.
- **A chip:**
  - `height:28px; gap:6px; padding:0 8px; border:0; border-radius:6px; background:transparent; color:--fg2; font-size:12px`;
  - a 12px chevron in `--muted`;
  - no leading icon, except the agent chip's 16px logo;
  - when open, `--hover` fill and `--fg` text (`ComposerMenus.dc.html`).
- **Send:** a 28px button, radius 8, with an arrow-up icon. Disabled, it has a `--hover` fill and `--muted` text.
- **The chip order:** Agent → model → mode → ⋯.

**Files:**
- Modify:
  - `src/components/composer/chip-style.ts`;
  - `src/components/composer/OptionDropdown.tsx` (the chip: chevron, no icon slot when `icon` is absent);
  - `src/components/ComposerDock.tsx`;
  - `src/App.tsx` (the wrapper at `App.tsx:1113`, and passing `sessionAgent`).
- Test: `src/test/composer-card.test.tsx` (new). Migrate `src/test/option-dropdown.test.tsx:66`, `src/test/draft-chips.test.tsx:38` (it moves to `DRAFT_CHIP` in Task 5; until then keep it passing against `COMPOSER_CHIP`), and `src/test/composer-dock.test.tsx` where it pins `Plus`/`CornerDownLeft` or the divider.

**Interfaces:**
- Produces:
  - `COMPOSER_CHIP` = `"focus-ring inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover aria-expanded:text-fg"`. It is borderless, and `rounded-md` is 6px.
  - `ComposerDockProps.sessionAgent?: { profileId: string; name: string }`. It is the running session's agent, drawn first in the row.
  - `OptionDropdownProps.icon` becomes optional. Its trailing mark, `ShieldAlert` (12px, `text-status-attention`, `data-testid="risky-permission-icon"`), comes from a new `trailing?: ReactNode` prop.

**Rulings to carry:**
- **The agent chip in a running session** is a static `<span>` styled like the chip (logo plus name, no chevron, not a button). An ACP session cannot change its agent, and a button that opens nothing would lie. It is drawn only when `sessionAgent` is set and no draft agent control is. *Cost if wrong:* the user expects a menu there, which would be one more task.
- **A risky mode** keeps a `ShieldAlert` on its chip, after the label, in `text-status-attention` (it was a red shield before the label). A safe mode's green `Shield` goes away with the other leading icons.
- **A single-agent draft's Send** stays an arrow icon. Only a compare run's Send has words ("Start 2 sessions"), as today.

- [ ] **Step 1: Write the failing tests** in `src/test/composer-card.test.tsx` (render `ComposerDock` alone, like `composer-dock.test.tsx`):
  - **The card.** `screen.getByRole("textbox", { name: "Prompt" }).closest("[data-composer-card]")`:
    - has `flex`, `flex-col`, `gap-2.5`, `p-3`, `rounded-xl`, `border`, `border-border`, `bg-surface-2` and `shadow-popover`;
    - the textarea has `rows` 2, `min-h-11`, `px-1` and `text-body`;
    - the footer has `max-w-chat` and `w-full`, and does not have `px-4`.
  - **The row.** The element holding "Add attachment" `closest("[data-composer-row]")`:
    - has `gap-1`;
    - its `className` contains neither `border-t` nor `pt-2`.
  - **Attach.** It is a 28px ghost IconButton in `text-fg-muted` with a paperclip icon (`svg.lucide-paperclip`).
  - **Send.** It has `svg.lucide-arrow-up` and no `lucide-corner-down-left`. Stop has `svg.lucide-square`, which has no `fill` attribute and has `width` 11.
  - **A chip.** With `controls.model` set (selected "Opus"):
    - the button "Model: Opus" has `h-7`, `rounded-md`, `px-2`, `text-ui-sm` and `text-fg-secondary`, and no `border`;
    - its first child is the label span, not an svg;
    - its last child is an svg chevron of width 12 with `text-fg-muted`;
    - once opened, it has `aria-expanded="true"` and the classes `aria-expanded:bg-surface-hover` and `aria-expanded:text-fg`.
  - **Marks a risky mode after its name.** With `permission` selected on a risky option, `getByTestId("risky-permission-icon")` comes after the label text and has `text-status-attention`.
  - **The session agent chip.** With `sessionAgent={{ profileId: "claude-acp", name: "Claude Code" }}`:
    - `getByText("Claude Code").closest("[data-agent-chip]")` is not a button;
    - it has `h-7`, `gap-1.5`, `px-2` and `text-fg-secondary`;
    - it comes after "Add attachment" and before "Model: Opus" in document order.
  - **The compare Send.** With `sendLabel="Start 2 sessions"`, the button "Start 2 sessions" has `h-7`, `text-ui` and `font-medium`, and its last child is `svg.lucide-arrow-up` of width 12.
- [ ] **Step 2: Run** `pnpm vitest run src/test/composer-card.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it:**
  - **The row's icons.** Drop the leading icons from the `agentControls` entries (`Sparkles`, `Shield`, `Gauge`, `SlidersHorizontal`).
  - **The risky mark.** Pass the risky mark as `trailing`.
  - **The chevron.** `ChevronDown size={12} className="shrink-0 text-fg-muted"`.
  - **The card:**
    - add `data-composer-card` and `flex flex-col gap-2.5`;
    - the textarea gets `rows={2}`, `min-h-11` and `px-1`;
    - the row gets `data-composer-row` and `flex flex-wrap items-center gap-1 text-ui-sm` (the old `mt-2 … border-t border-border pt-2` goes);
    - attachments and the note lose their `mb-2`/`mt-1` and sit in the column gap.
  - **The leading group.** Attach, then the session agent chip, then the inline controls, then ⋯.
  - **Send and Stop.**
    - Send and Stop use `ArrowUp size={14}` and `Square size={11}` (stroke only).
    - The labelled Send renders `{sendLabel}<ArrowUp size={12} aria-hidden="true" />`.
  - **App.**
    - The wrapper at `App.tsx:1113` becomes `flex justify-center px-6 pb-5`.
    - `App` passes `sessionAgent={activeSession && activeAgent ? { profileId: activeAgent.id, name: activeAgent.name } : undefined}`.
- [ ] **Step 4: Run** `pnpm vitest run src/test/composer-card.test.tsx src/test/composer-dock.test.tsx src/test/option-dropdown.test.tsx src/test/draft-chips.test.tsx src/test/composer-overflow.test.ts src/test/compare-composer.test.tsx`. Expected: PASS after the migrations.
- [ ] **Step 5: Commit:** `feat: the composer card and its chips as drawn, with the agent first`.

---

### Task 4: Context, attachments and placeholders as drawn

The artboard and spec values:

- **The context.** "38% of context" in 11px `--subtle`, as plain text with `margin-right:8px` and no ring.
- **The attachment remove button.** An 18px circle inside the thumbnail.
- **The placeholders.** "Answer the request above to continue" while a request waits, else "Reply to <Agent>".

**Files:**
- Modify: `src/components/composer/ContextMeter.tsx`, `src/components/composer/AttachmentChips.tsx`, `src/lib/composer-state.ts`, `src/components/ComposerDock.tsx` (the default placeholder), `src/App.tsx` (the placeholder inputs)
- Test: `src/test/composer-details.test.tsx` (new). Also `src/test/composer-state.test.ts` (extend it), and migrate `src/test/context-meter.test.tsx` and `src/test/composer-attachments.test.tsx:32`.

**Interfaces:**
- Produces:
  - `composerPlaceholder` takes `isAwaitingAnswer?: boolean`. While `isRunning` it returns `COMPOSER_PLACEHOLDERS.answerRequest`, which is `"Answer the request above to continue"`, when `isAwaitingAnswer` is set, and `undefined` otherwise.
  - `ComposerDock`'s default placeholder is `` `Reply to ${agentName}` ``, or `"Reply to the agent"` without one. `PLACEHOLDER` and `PLACEHOLDER_WITH_COMMANDS` are removed.

**Ruling:** the context ring goes, as drawn. The text keeps its warning tones (`text-status-attention` from 80%, `text-danger` from 95%) and its details popover.

- [ ] **Step 1: Write the failing tests:**
  - **`composer-state.test.ts`.**
    - `composerPlaceholder({ ...IDLE, isRunning: true, isAwaitingAnswer: true })` is `"Answer the request above to continue"`.
    - `composerPlaceholder({ ...IDLE, isRunning: true })` is `undefined`.
  - **`composer-details.test.tsx`, the placeholder.**
    - `ComposerDock` with `agentName="Codex"` and no placeholder shows a textbox with placeholder `"Reply to Codex"`.
    - Without `agentName` it reads `"Reply to the agent"`.
    - **A popout replies to its agent:** `PopoutApp` rendered with a running Codex session has the placeholder `"Reply to Codex"`. Reuse the setup in `src/test/popout.test.tsx`.
  - **`composer-details.test.tsx`, the context meter.** `ContextMeter used={38} size={100}`:
    - the button "Context details" has `mr-2`, `text-caption` and `text-fg-subtle`, and contains no `svg`;
    - its text is "38% of context";
    - at `used={85}` the meter has `text-status-attention`.
  - **`composer-details.test.tsx`, the remove button.** On an image thumbnail, "Remove shot.png" has `absolute`, `right-1`, `top-1`, `size-4.5` and `rounded-full`, and its parent is the `li` with `relative`, not a span outside it.
- [ ] **Step 2: Run** `pnpm vitest run src/test/composer-details.test.tsx src/test/composer-state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it:**
  - **The meter.** Drop the ring svg from `Gauge`. Its tone class replaces `text-fg-muted`, defaulting to `text-fg-subtle`.
  - **The remove button.** `RemoveButton` takes `placement?: "inside" | "inline"`:
    - inside: `absolute right-1 top-1 flex size-4.5 items-center justify-center rounded-full bg-surface-3 text-fg-secondary`, with `X size={10}`;
    - inline: as today;
    - the thumbnail's wrapper `span` goes.
  - **App.** Pass `isAwaitingAnswer: isAwaitingUser(currentMessages)` into `composerPlaceholder`.
- [ ] **Step 4: Run** the two new files, plus `src/test/context-meter.test.tsx`, `src/test/composer-attachments.test.tsx` and `src/test/popout.test.tsx`. Expected: PASS after the migrations.
- [ ] **Step 5: Commit:** `feat: context use as text, the remove button inside the thumbnail, and placeholders that name the agent`.

---

### Task 5: The draft's chips, note and column as drawn

The artboard values (`NewSession.dc.html`):

- **The column:** from `padding:120px 24px 24px`, `max-width:680px`, left-aligned, `gap:16px`.
- **The heading:** 20/28, weight 600, `letter-spacing:-0.02em`.
- **The chips row:** `flex-wrap; gap:8px`.
- **A draft chip:**
  - `height:28px; gap:6px; padding:0 10px; border:1px solid --line; border-radius:8px; background:--s1; color:--fg2; font-size:12px`;
  - a 12px leading icon and a 12px chevron, both in `--muted`;
  - open (`DraftPickers.dc.html`): `--hover` fill, a `--strong` border and `--fg` text.
- **The branch chip:** mono 11 name, then "· new worktree" in `--subtle`.
- **The compare note:** inline in the control row after attach, 11px `--subtle`, `padding-left:4px`. It reads "Each agent starts in its safest mode, in its own worktree."
- **The session list:** `margin-top:24px` below the card.

**Files:**
- Modify:
  - `src/components/composer/chip-style.ts` (`DRAFT_CHIP`);
  - `src/components/composer/DraftChips.tsx` (`mb-4`, `gap-2`);
  - `src/components/composer/FolderPicker.tsx`, `BranchPicker.tsx` and `AgentMultiPicker.tsx` (their chips use `DRAFT_CHIP`);
  - `src/components/ComposerDock.tsx` (the outside-repository agent `OptionDropdown` gets the draft chip look, and `noteInRow`);
  - `src/lib/composer-state.ts` (`COMPARE_NOTE`);
  - `src/components/workspace/NewSessionView.tsx`;
  - `src/App.tsx` (the wrapper's draft padding, `noteInRow`).
- Test: `src/test/draft-layout.test.tsx` (new). Migrate:
  - `src/test/draft-chips.test.tsx:38`;
  - the `QUOTA_NOTE` strings in `src/test/compare-composer.test.tsx:39,193,540` and `src/test/compare-run-start.test.tsx:553`;
  - `src/test/new-session.test.tsx` where it pins the centered heading.

**Interfaces:**
- Consumes: `COMPOSER_CHIP` from Task 3.
- Produces:
  - `DRAFT_CHIP` = `"focus-ring inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-1 px-2.5 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg aria-expanded:border-border-strong aria-expanded:bg-surface-hover aria-expanded:text-fg"`.
  - `OptionDropdownProps.chipClassName?: string` (defaults to `COMPOSER_CHIP`). `ComposerDock` passes `DRAFT_CHIP` and `align="left"` for the draft's agent chip, and drops its `Bot` icon for `<AgentLogo profileId={agent.selected ?? ""} name="" size={16} />`.
  - `ComposerDockProps.noteInRow?: boolean`. When set, the note renders as `<p id={noteId} className="pl-1 text-caption text-fg-subtle">` inside the row after the leading group, and not under the textarea.
  - `COMPARE_NOTE` = `"Each agent starts in its safest mode, in its own worktree."`.

**Rulings to carry:**
- **The compare note's words.** They follow the artboard and the audit, so "and uses its own quota" is dropped. *Cost if wrong:* the quota warning comes back as one string.
- **The note's place.** Only the compare note sits in the row (`App` passes `noteInRow={note === COMPARE_NOTE}`). Every other note, whether a blocked Send's reason or a loading line, stays under the prompt, since those are sentences the row has no room for.

- [ ] **Step 1: Write the failing tests** in `src/test/draft-layout.test.tsx`. Render the app on a draft in a repository folder, as `new-session.test.tsx` does.
  - **The heading.**
    - `getByRole("heading", { name: "New session in agent-desktop" })` has `text-xl`, `font-semibold` and `tracking-[-0.02em]`.
    - Its wrapper has `mx-auto`, `w-full`, `max-w-chat`, `px-6`, `pt-[120px]` and `pb-4`, and neither `flex-1` nor `items-center`.
  - **The chips.**
    - The chip "Branch: main" has `h-7`, `rounded-lg`, `border-border`, `bg-surface-1`, `px-2.5` and `text-ui-sm`.
    - `within(chip).getByText("main")` has `font-mono` and `text-caption`.
    - The chips row has `gap-2` and `mb-4`.
  - **The compare note.** With two agents ticked, `getByText("Each agent starts in its safest mode, in its own worktree.")`:
    - has `text-caption`, `text-fg-subtle` and `pl-1`;
    - has `closest("[data-composer-row]")` not null.
  - **The session list's place.** The session list's wrapper (`NewSessionBelow`) has `flex-1`, `px-6` and its inner `mx-auto w-full max-w-chat mt-6`.
  - **The draft's composer wrapper.** It has `px-6` and no `pb-5`. A running session's wrapper has `pb-5`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/draft-layout.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it:**
  - **`NewSessionHeading`.** `mx-auto w-full max-w-chat px-6 pt-[120px] pb-4`, holding the `h1` (`text-xl font-semibold tracking-[-0.02em] text-fg`) and the reason `p` (`mt-1 text-ui text-fg-muted`), left-aligned.
  - **`NewSessionBelow`.** `flex flex-1 flex-col overflow-y-auto px-6 pb-6`, with the inner `mx-auto mt-6 w-full max-w-chat`.
  - **The composer wrapper.** `px-6`, plus `pb-5` only when `!isNewSessionDraft`.
  - **The branch chip.** `<span className="min-w-0 truncate font-mono text-caption">`, then `<span className="shrink-0 text-fg-subtle"> · new worktree</span>`.
  - **The chips' icons.** Leading icons are `size={12} className="shrink-0 text-fg-muted"`, and chevrons are `size={12} className="shrink-0 text-fg-muted"`.
- [ ] **Step 4: Run** `pnpm vitest run src/test/draft-layout.test.tsx src/test/draft-chips.test.tsx src/test/new-session.test.tsx src/test/compare-composer.test.tsx src/test/compare-run-start.test.tsx src/test/composer-state.test.ts`. Expected: PASS after the migrations.
- [ ] **Step 5: Commit:** `feat: the new-session draft's column, chips and compare note as drawn`.

---

### Task 6: The draft's agent chip with logos and names

The artboard values (`NewSession.dc.html` line 35):

- overlapping 16px logos, the second at `margin-left:-4px`;
- "Claude Code, Codex", then "· compare" in `--subtle`.

With one agent it is the logo and the name.

**Files:**
- Modify: `src/components/composer/AgentMultiPicker.tsx` (the trigger only)
- Test: `src/test/agent-picker.test.tsx` (new; Task 8 extends it). Migrate `src/test/draft-chips.test.tsx` and `src/test/compare-composer.test.tsx` where they read the chip's name (`"Agent: 2 agents"`).

**Interfaces:**
- Produces: the chip's accessible name is `` `Agent: ${names}` `` with `names` joined by ", ", and `` `Agent: ${names}, compare` `` with two or more.

**Ruling:** real logos have no box, so the artboard's 2px ring (a stand-in for the box's edge) is not drawn. Only the overlap is.

- [ ] **Step 1: Write the failing tests:**
  - **Two agents.** With Claude Code and Codex ticked:
    - the button `getByRole("button", { name: "Agent: Claude Code, Codex, compare" })` holds two logo elements, the second with `-ml-1`;
    - `getByText("Claude Code, Codex")` has `truncate` and `min-w-0`;
    - `getByText("· compare")` has `text-fg-subtle` and `shrink-0`.
  - **One agent.** With one ticked, the name is "Agent: Claude Code", and there is no "· compare".
  - **Truncates four long names.** With four agents named 40 characters each, the chip has `max-w-full` and the names span has `truncate`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-picker.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it:**
  - Replace `chipLabel` with `chipNames(options, selected): string[]`, giving the ticked agents' `name`s in the order they were picked.
  - Render the logos in `<span aria-hidden="true" className="flex shrink-0">`. Each is an `AgentLogo` at 16px, and every one after the first has `-ml-1`.
  - Then the names span, then the " · compare" span when two or more, then the chevron.
- [ ] **Step 4: Run** `pnpm vitest run src/test/agent-picker.test.tsx src/test/draft-chips.test.tsx src/test/compare-composer.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: the draft's agent chip shows each ticked agent`.

---

### Task 7: The branch and folder menus as drawn

The artboard values (`DraftPickers.dc.html` 31–48):

- **The panel:** 360 wide, with the search field from Task 1 and the "Local branches" heading.
- **A branch row:**
  - 30px;
  - the check on the left;
  - the name in mono 12;
  - "checked out" on the folder's own branch, 11px `--muted`.
- **The separator:** `height:1px; margin:6px 0; --line`.
- **The worktree switch:**
  - a `label` with `align-items:flex-start; gap:10px; padding:6px 8px`;
  - the 28×16 switch on the left (`margin-top:1px`);
  - then, stacked, "New worktree" in `--fg` and the description in 11px `--subtle`.

**Files:**
- Modify: `src/components/composer/BranchPicker.tsx`, `src/components/composer/FolderPicker.tsx` (its search field, and `BranchControl.checkedOut`), `src/hooks/useBranchPicker.ts`
- Test: `src/test/branch-menu.test.tsx` (new). Migrate `src/test/draft-chips.test.tsx` where it pins the switch layout.

**Interfaces:**
- Consumes: `PopoverSearch` and the check slot (Task 1), and `DRAFT_CHIP` (Task 5).
- Produces: `BranchControl.checkedOut: string`, the folder's checked-out branch. `useBranchPicker` fills it from its `checkedOut` argument.

- [ ] **Step 1: Write the failing tests** in `src/test/branch-menu.test.tsx`. Render `BranchPicker` open with `current: "main"`, `checkedOut: "main"`, `branches: ["main", "fix/transcript-save-interval"]` and the worktree on.
  - **The panel.** `getByRole("dialog", { name: "Choose a branch" })` has `w-90`, and the field "Search branches" is a `PopoverSearch` (a `closest("label")` with `h-7.5`).
  - **The rows.**
    - The option "main" has a check slot with an svg.
    - `within(option).getByText("main")` has `font-mono` and `text-ui-sm`.
    - `within(option).getByText("checked out")` has `text-caption` and `text-fg-muted`.
    - The other option has no "checked out".
  - **A picked base.** With `current: "feat/x"` and `checkedOut: "main"`, the check is on "feat/x" and "checked out" is on "main".
  - **The switch.** `getByRole("switch", { name: "New worktree" })`:
    - has `flex`, `items-start`, `gap-2.5`, `px-2` and `py-1.5`;
    - its first child is the track (`h-4`, `w-7`, `mt-px`);
    - `getByText("Works on its own copy from main. Your checkout stays as it is.")` has `text-caption` and `text-fg-subtle`, and comes after `getByText("New worktree")` inside the same switch.
  - **The separator.** It is `my-1.5 h-px bg-border`, between the list and the switch.
- [ ] **Step 2: Run** `pnpm vitest run src/test/branch-menu.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it:**
  - Rows pass `trailing={name === branch.checkedOut ? "checked out" : undefined}`, with the children `<span className="font-mono text-ui-sm">{name}</span>`.
  - The switch's track comes first, with the two-line text after it.
  - The `lockedReason` replaces the description as today.
  - `FolderPicker`'s search field becomes `PopoverSearch` with `autoFocus`.
- [ ] **Step 4: Run** `pnpm vitest run src/test/branch-menu.test.tsx src/test/draft-chips.test.tsx src/test/new-session.test.tsx src/test/branch-picker.test.tsx`. If `branch-picker.test.tsx` does not exist, run the files that `grep -l useBranchPicker src/test` lists. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: the branch menu as drawn, with the checked-out branch named`.

---

### Task 8: The agent menu as drawn

The artboard values (`DraftPickers.dc.html` 50–64):

- **The panel:** 380 wide.
- **The heading:** "Agents", with the aside "Pick more than one to compare".
- **A row:**
  - `height:30px; gap:8px; padding:0 8px; border-radius:4px`;
  - in order: a 14px checkbox (`border:1.5px solid --strong; radius 3px`, filled `--fg` with a 10px `--bg` check, stroke 3, when ticked), the 16px logo, the name (`flex:1`) and the status.
- **The status:**
  - "Ready" in 11px `--muted`;
  - "Not checked" in `--subtle`;
  - "Needs sign-in" in `--att`, after a 6px `--att` dot;
  - "Not installed" in `--subtle`.
- **An unavailable row:** `opacity:.55`.
- **The footer:** a separator, then "With two or more agents, each runs in its own worktree in its safest mode." in 11px `--subtle`, `padding:4px 8px 6px`.

**Files:**
- Modify: `src/components/composer/AgentMultiPicker.tsx` (the panel), `src/lib/composer-controls.ts`
- Test: extend `src/test/agent-picker.test.tsx`. Migrate `src/test/draft-chips.test.tsx:178` (the Qwen row's `text-fg-muted`) and `src/test/compare-composer.test.tsx` (the old intro and footer strings).

**Interfaces:**
- Consumes: `PopoverHeader`'s `aside` (Task 1).
- Produces: `AgentChoice.blockedBy?: "install" | "sign-in"`, set by `compareAgentOptions` next to `disabledReason`.

**Ruling:** a row blocked by an install or a sign-in shows only its status word, which is the checkbox's `aria-describedby`. The old reason sentences ("You need to install it first.") are no longer drawn, and `disabledReason` stays for that `aria-describedby` fallback and for `title`. "Set up <Agent> first." and the compare limit are not statuses, so they keep their caption line under the row.

- [ ] **Step 1: Write the failing tests** (extend `agent-picker.test.tsx`). Use these options:
  - Claude Code: ticked, `signIn` ready;
  - Codex: ticked, ready;
  - Gemini CLI: `signIn` unchecked;
  - Qwen Code: `blockedBy` "sign-in", with `disabledReason`;
  - Pi: `blockedBy` "install", with `disabledReason`.

  The tests:
  - **The panel and heading.** The panel has `w-95`. `getByText("Agents")` has the sibling aside "Pick more than one to compare".
  - **A row's order.** In the Claude Code row the order is checkbox → logo → name → "Ready".
    - The checkbox `getByRole("checkbox", { name: "Compare Claude Code" })` holds a `span` with `size-3.5`, `rounded-[3px]`, `border-[1.5px]`, `bg-fg`, `border-fg` and `text-bg`.
    - "Ready" has `text-caption` and `text-fg-muted`.
  - **Gemini CLI.** Its "Not checked" has `text-fg-subtle`, and its checkbox box has `border-border-strong` and no `bg-fg`.
  - **Qwen Code.**
    - Its row has `opacity-55`.
    - "Needs sign-in" has `text-status-attention`, and its previous sibling is a `size-1.5 rounded-full bg-status-attention` dot.
    - **A blocked agent's checkbox is described by its status:** the checkbox's `aria-describedby` is the id of the element that holds "Needs sign-in".
    - There is no "You need to sign in first." text.
  - **Pi.** It reads "Not installed" in `text-fg-subtle`, and its row has `opacity-55`.
  - **The name.** It is the plain `name` ("Pi"), never "(not installed)".
  - **The footer.** `getByText("With two or more agents, each runs in its own worktree in its safest mode.")` has `text-caption`, `text-fg-subtle`, `px-2`, `pt-1` and `pb-1.5`.
  - **Arrow keys reach the checkbox and the name.** From Claude Code's checkbox, ArrowDown focuses Claude Code's name button, and the next ArrowDown focuses Codex's checkbox.
- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-picker.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it:**
  - **The row.** It becomes `flex h-7.5 items-center gap-2 rounded px-2 hover:bg-surface-hover`, plus `opacity-55` when `blockedBy`. In order it holds:
    - the checkbox button (`focus-ring flex size-5 -ml-0.75 items-center justify-center rounded`) around the 14px box;
    - the name button (`focus-ring flex min-w-0 flex-1 items-center gap-2 text-left text-ui`, in `text-fg` when ticked and `text-fg-secondary` otherwise), holding the 16px logo and `option.name`;
    - the status span with its `id`.
  - **The status word.** `statusOf(option)` in `AgentMultiPicker.tsx` returns `{ word, tone: "muted" | "subtle" | "attention" }` from `blockedBy`, then `signIn` (`ready` → "Ready"/muted, `unchecked` → "Not checked"/subtle).
  - **The footer.** It has a separator before it.
  - **Arrow keys.** `moveFocus` stays as it is: DOM order now gives checkbox, then name.
- [ ] **Step 4: Run** `pnpm vitest run src/test/agent-picker.test.tsx src/test/draft-chips.test.tsx src/test/compare-composer.test.tsx src/test/composer-controls.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: the agent menu as drawn, with each agent's status on its row`.

---

### Task 9: The session list as drawn

The artboard values (`NewSession.dc.html` 48–53):

- **The list:** `flex-direction:column; gap:4px`.
- **The header row:** `padding:0 12px 6px`, with "Continue a session from Claude Code" (11/500 `--muted`, `flex:1`) and "3 in this folder" (11px `--subtle`).
- **A row:**
  - `height:44px; gap:12px; padding:0 12px; border-radius:8px`;
  - the title `flex:1` in `--fg2`, and `--fg` on the hovered row with a `--hover` fill;
  - the time in 11px `--subtle` (`--muted` when hovered);
  - Continue as an outline button on the hovered row (`height:26px; padding:0 10px; border:1px solid --strong; radius 6; --fg; 12px`).

**Files:**
- Modify: `src/components/workspace/AgentSessionList.tsx`
- Test: `src/test/session-list-rows.test.tsx` (new). Migrate `src/test/agent-session-list.test.tsx` and `src/test/session-import.test.tsx` only where they look up rows by the old outline button's classes. Their names stay, since the row is still one button.

**Interfaces:**
- Produces: each loaded session is a single `<button>` whose accessible name is the title and the time. The "Continue" inside it is `aria-hidden`.

**Ruling:** before the list is asked for, the idle state stays a **Continue a session from <Agent>** button. Asking starts the agent's process (`acp/session_list.rs`), so it must stay something you choose. The artboard draws the list after it loaded.

- [ ] **Step 1: Write the failing tests** in `src/test/session-list-rows.test.tsx`. Render `AgentSessionList` loaded with three sessions.
  - **The header.**
    - `getByText("Continue a session from Claude Code")` has `flex-1`, `text-caption`, `font-medium` and `text-fg-muted`.
    - `getByText("3 in this folder")` has `text-caption` and `text-fg-subtle`.
    - Their row has `px-3` and `pb-1.5`.
  - **A row.** `getByRole("button", { name: /Refactor the composer dock/ })`:
    - has `group`, `flex`, `h-11`, `items-center`, `gap-3`, `rounded-lg`, `px-3`, `text-ui`, `text-fg-secondary`, `hover:bg-surface-hover`, `hover:text-fg` and `focus-ring`;
    - its time span has `text-caption`, `text-fg-subtle` and `group-hover:text-fg-muted`.
  - **Continue shows on focus and is not read twice.**
    - `within(row).getByText("Continue")` has `aria-hidden="true"`, `hidden`, `group-hover:inline-flex`, `group-focus-visible:inline-flex`, `h-6.5`, `rounded-md`, `border`, `border-border-strong`, `px-2.5`, `text-ui-sm` and `text-fg`.
    - The row's accessible name does not contain "Continue".
  - **The list.** The `ul` has `flex`, `flex-col` and `gap-1`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/session-list-rows.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement it** as the tests say. Keep the loading, empty, truncated, incomplete and failed states as they are. The header shows only when there is at least one session.
- [ ] **Step 4: Run** `pnpm vitest run src/test/session-list-rows.test.tsx src/test/agent-session-list.test.tsx src/test/session-import.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: the draft's session list as drawn, with Continue on the row`.

---

### Task 10: Design-system docs and changelog

**Files:**
- Modify:
  - `docs/design-system/components/Composer/README.md` and `preview.html`;
  - `docs/design-system/components/Popover/README.md` and `preview.html`;
  - `CHANGELOG.md`.

- [ ] **Step 1: The Composer docs.**
  - **The README:**
    - the chip is 28px, borderless and radius 6, with no leading icon and filled while open;
    - the order is Agent, model, mode, ⋯;
    - attach is a paperclip and Send an arrow-up;
    - Stop is an outline with an 11px square;
    - the context is text, the remove button sits inside the thumbnail, and the placeholders name the agent;
    - the draft chips are 28px, radius 8, on `surface-1`;
    - the compare note sits in the row;
    - the agent menu's statuses;
    - the session list's rows.
  - **The preview.** Draw the same, with tokens only (`design-tokens.test.ts` scans previews).
- [ ] **Step 2: The Popover docs.** The check on the left, subtle descriptions, `PopoverSearch`, and `PopoverHeader`'s aside.
- [ ] **Step 3: The CHANGELOG.** Add under Unreleased: "**The composer and the new-session draft match their design.** Chips are quieter and the agent comes first, menus put the check on the left, the agent menu shows each agent's status, and the session list continues a session from its row."
- [ ] **Step 4: Run** `pnpm vitest run src/test/design-system-docs.test.ts src/test/design-tokens.test.ts src/test/theme-contrast.test.ts`, then `pnpm lint`, then `pnpm test > .superpowers/full-suite.log 2>&1; tail -20 .superpowers/full-suite.log`. Expected: all green, and lint clean.
- [ ] **Step 5: Commit:** `docs: the composer and draft as drawn`.
