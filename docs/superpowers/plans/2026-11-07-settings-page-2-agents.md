# Settings page, part 2 (Agents section) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → Agents is drawn as on the canvas:
- one group of rows for the agents in use, one for the agents available;
- each row one line with a logo tile, a status chip and its buttons;
- a sign-in that opens inside the row, replacing the yellow sign-in box the user rejected after trying part 1.

**Architecture:**
- The read model and actions are unchanged: `get_agent_catalog`, `useAgentCatalogActions`, `update_agent`, `useSettingsSignIn` and the sweep. Only the components under `src/components/agents/` are redrawn, plus two wording helpers in `lib/agent-catalog.ts`.
- One row component, `AgentCatalogRow`, draws every state:
  - in use: ready, sign in, not checked, not installed, installing, failed;
  - available: Add or Install.
- `AgentSignIn` becomes the panel that opens inside a row.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-04-onboarding-settings-redesign-design.md`, section "Agents". This is its "Suggested phases" step 2.

**Artboard:** `project/SettingsAgents.dc.html` in https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz (a copy is in the scratchpad under `canvas/project/`). The artboard decides the look and the spec decides behavior.

**Branch:** `feat/redesign-settings-page`, on top of part 1 and main 3e2e630 (merged in at 7295d33). It ships in the same PR as part 1, at the user's request.

## Global Constraints

- Part 1's Global Constraints still hold:
  - the token mapping;
  - no raw colours;
  - `Button` sizes only through `size`;
  - an outline label that must read `fg` is wrapped in `span.text-fg`;
  - `focus-ring` on everything focusable;
  - sentence-case copy;
  - explicit `git add` paths.
- `Button size="md"` is now 12px (PR #154), the canvas's 28px buttons. The canvas's 32px **Check again** is `size="lg"`.
- **Names the tests rely on stay.** `settings-sign-in.test.tsx` (58 tests) and `agent-catalog-ui.test.tsx` find elements by role and name:
  - the row is a `listitem` named by the agent;
  - the sign-in panel is a `group` named "{Agent} sign-in";
  - its status is a `role="status"`;
  - the buttons are "Check sign-in", "Sign in with …" / "Log in with …", "Add", "Install", "Update to x.y.z", "Retry" and "Cancel".
- Onboarding renders the same `AgentCatalogPanel` without `signIn`. It gets these rows too, with no chip and no sign-in, until onboarding's own redesign (part 3).

## Rulings made while planning (the user can overturn them at plan review)

1. **No Open setup in Settings.** The canvas draws **Open setup** on Qwen Code's row, but on 2026-11-05 the user decided the setup card shows only in the draft and the session. That earlier explicit choice stands.
2. **Every in-use agent that can start has a sign-in chevron** at its row's end, named "Show sign-in for X" or "Hide sign-in for X", with `aria-expanded`.
   - The row opens by itself while its state is **Sign in**. Opened, the row is `surface-1` and shows the methods, the session warning and **Check sign-in**.
   - The canvas draws the chevron only on the Sign in row. Without it on Ready and Not checked rows, **Check sign-in** would be lost, and part 1 still offers it.
3. **Remove moves into a ⋯ menu.** The menu is named "More actions for X" and holds one item, Remove.
   - The confirmation keeps Zorvo's words: "Remove X? Zorvo deletes its copy. Saved sessions stay readable.", plus "Its open sessions stop." when there are any. It has Cancel and a danger Remove.
   - It opens under the row's line.
4. **"Registry checked 8 hours ago" stays**, as a `caption` `fg-subtle` line under the search row. The canvas leaves it out, but it is the only place that says how fresh the list is.
5. **Group headings follow the canvas:** "In use" and "Available", without counts. "Not available (N)" keeps its count. "All agents" becomes "Available".
6. **`authCopy`'s `cliHint` and `keysNote` stay**, as `ui-sm` `fg-subtle` lines above the methods card. 8d ruled the same.
7. **A program found outside Zorvo** reads "0.64.0 · on this Mac". When Zorvo knows its location, the location is the line's `title`, not more words in the row.

## Review Focus

Most likely first:

1. **An agent that needs a sign-in while its row is closed** (for example, the sweep finds it signed out): the row opens by itself and shows the methods. *Task 3: "a row opens its sign-in when the agent needs one".*
2. **Focus after a sign-in that worked**: the panel's group takes focus back when the dialog closes and the method button is gone, which is today's `hadDialog` effect. The row stays open although the state is now Ready. *Task 2: "keeps the panel open and takes focus back after a sign-in".*
3. **Remove from ⋯ on an agent with running sessions** says they stop, and Cancel gives focus back to ⋯. *Task 3: "Remove asks under the row, naming running sessions".*
4. **An install from the Available group**:
   - the step is a live region without the bytes, followed by the 4px bar and Cancel;
   - a failure shows the error and Retry.
   
   *Task 3: "an install runs inside its row", "a failed install offers Retry".*
5. **Search** narrows both groups, and opens Not available while text is typed, as today. *Task 4: "search narrows both groups and opens Not available".*

---

### Task 1: The rows' words

**Files:** Modify `src/lib/agent-catalog.ts`. Test: `src/test/agent-catalog.test.ts` (extend).

**Interfaces:**
- Produces `sourceLine(agent: CatalogAgent): string`, the in-use row's mono line. It is the version, when known, joined with " · " to one of these:

  | `status` | Words |
  | --- | --- |
  | `by_zorvo` | "installed by Zorvo" |
  | `on_your_mac` | "on this Mac" |
  | `ready` | "runs with {distribution}" |
  | `not_installed` | "not installed" |
  | `waiting` | "not available yet", or "available from {date}" |
  | `unsupported` | "not available for this Mac" |

  An unlisted agent ends in " · no longer listed".
- Produces `availableLine(agent: CatalogAgent, plan: readonly InstallStep[] | null): string`, an available row's line:
  - the agent's description;
  - else, with a plan, "Installs {describePlan(plan)} into Zorvo's folder";
  - else, `statusLine`'s words for `waiting` or `unsupported`.
- `statusLine` stays, for the install job line.

- [ ] **Step 1: Failing tests**:
  - `sourceLine`:
    - "0.93.0 · installed by Zorvo";
    - "0.64.0 · on this Mac";
    - "runs with npx" with no version;
    - "0.2.0 · not installed";
    - an unlisted agent ends in " · no longer listed".
  - `availableLine`:
    - the description when there is one;
    - "Installs Node.js 24.11.1 (49 MB) and Pi into Zorvo's folder" with no description and a plan;
    - "Not available for this Mac" for an unsupported agent with no description.
- [ ] **Step 2: Run** `pnpm vitest run src/test/agent-catalog.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement** both helpers.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/lib/agent-catalog.ts src/test/agent-catalog.test.ts && git commit -m "feat: words for the Agents section's rows"`

### Task 2: Sign-in chip and the sign-in panel

**Files:**
- Create: `src/components/agents/SignInChip.tsx`.
- Modify: `src/components/agents/AgentSignIn.tsx`.
- Test: `src/test/settings-sign-in.test.tsx` (extend, and update any class assertions).

**Interfaces:**
- Produces `SignInChip({ state }: { state: SignInState })`:
  - a `span` with `flex h-5.5 shrink-0 items-center gap-1.25 rounded-md border px-2 text-caption`, a sr-only "Sign-in: " in front, and the words from `SIGN_IN_LABELS`;
  - Ready: `border-border text-fg-secondary`, with a `size-1.5 rounded-full bg-status-running` dot;
  - Sign in: `border-status-attention text-status-attention`, with an attention dot;
  - Not checked: `border-border text-fg-muted`, with no dot.
- `AgentSignIn({ agentId, agentName, signIn })` keeps today's props and becomes the panel inside an opened row.
  - **The group**: `role="group"`, `aria-label="{Agent} sign-in"`, `tabIndex={-1}`, `focus-ring`, `rounded-md`, laid out as `flex flex-col gap-2.5`.
  - **While the state is `needed`**: `copy.lead`, `cliHint` and `keysNote` as `text-ui-sm text-fg-subtle` lines, then the methods card.
    - The card is a `ul` with `flex flex-col overflow-hidden rounded-lg border border-border bg-surface-2`.
    - Each `li` is `flex items-center gap-2.5 border-b border-border px-3 py-2.25 last:border-b-0`.
    - A method Zorvo runs (`agent` / `terminal`) shows its name (`flex-1 text-ui text-fg`) and an outline `Button size="md"` with the label `signInButtonLabel(method)` in `span.text-fg`, with no icon.
    - An `explain` method shows its name in `text-fg-secondary` over its description (`text-ui-sm text-fg-subtle`), then "In your shell" (`text-caption text-fg-subtle`) at the end.
  - **Footer**: a `flex items-center gap-2` row. It holds the `sessionWarning(...)` text (`flex-1 text-ui-sm text-fg-subtle`, with the id **Check sign-in** uses for `aria-describedby`) and **Check sign-in** as an outline `Button size="md"` with no icon. With no warning, it is `justify-end`.
  - **Status line**: the `role="status"` line stays always mounted, with the same texts, under the footer. It is `text-ui-sm text-fg-muted`, `text-danger` on a failure, and sr-only when empty.
  - **Removed**: the yellow box (`border-attention-border bg-attention-surface`), the `LogIn` and `RefreshCw` icons, and every `text-[11px]` and `text-xs`.
  - **Unchanged**: the `hadDialog` focus-back effect.

- [ ] **Step 1: Failing tests** in a new `describe("the sign-in panel as drawn")`:
  - `methods are a bordered list with outline buttons`:
    - the `ul` has `rounded-lg border bg-surface-2`;
    - "Sign in with Claude Subscription" has `border-border-strong` and no svg;
    - no element has `bg-attention-surface`.
  - `a method Zorvo cannot run reads In your shell`: its row holds "In your shell" and no button.
  - `Check sign-in sits beside the warning`: its `aria-describedby` points at the warning, which is in the same row, and it has no svg.
  - `the chip shows each state`:
    - Ready has a `bg-status-running` dot;
    - Sign in has `border-status-attention`;
    - Not checked has no dot;
    - each reads "Sign-in: …".
  - `keeps the panel open and takes focus back after a sign-in`: after the terminal dialog closes on a sign-in that worked, the group has focus.
  
  Update the existing class assertions (`text-[11px]`, the attention box) to the new classes, keeping every role and name.
- [ ] **Step 2: Run** `pnpm vitest run src/test/settings-sign-in.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `SignInChip.tsx` and the redrawn `AgentSignIn.tsx`.
- [ ] **Step 4: Run** `pnpm vitest run src/test/settings-sign-in.test.tsx src/test/settings-sign-in-dialog.test.tsx src/test/agent-sign-in-status.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/agents/SignInChip.tsx src/components/agents/AgentSignIn.tsx src/test/settings-sign-in.test.tsx && git commit -m "feat: agent sign-in as a chip and a panel inside the row"`

### Task 3: One row per agent

**Files:**
- Modify: `src/components/agents/AgentCatalogRow.tsx` (rewrite).
- Test: create `src/test/settings-agents-look.test.tsx`; update `src/test/agent-catalog-ui.test.tsx`, where Remove now goes through ⋯.

**Interfaces:** Consumes `sourceLine` and `availableLine` (Task 1), and `SignInChip` and `AgentSignIn` (Task 2). `AgentCatalogRowProps` are unchanged.

**Canvas values:**
- **Row**: `li aria-label={agent.name}`, `flex flex-col border-b border-border last:border-b-0`. It adds `bg-surface-1` while open or installing.
- **Line**: `flex items-center gap-3 px-4 py-3`.
  - **Logo tile**: `flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-surface-hover`, holding `AgentLogo size={16}` (`aria-hidden`).
  - **Label column**: `flex min-w-0 flex-1 flex-col gap-0.5`, with the name (`truncate text-ui text-fg`) over:
    - for an agent in use, `sourceLine` (`font-mono text-caption text-fg-subtle`, `title={agent.location}` when known);
    - for an available agent, `availableLine` (`text-ui-sm text-fg-subtle`).
  - **Controls**: `flex shrink-0 items-center gap-2`, in this order. Every outline label below is in `span.text-fg`.
    - `SignInChip`, when the agent can start and `signIn` is given.
    - **Update to x.y.z** (outline md).
    - **Add** or **Install** (outline md, no icon). Install's `title` is the plan's words.
    - **Retry** (outline md) after a failure.
    - The sign-in chevron (`IconButton`, `ChevronDown` / `ChevronUp`), when the agent can start and `signIn` is given.
    - ⋯ (`IconButton` "More actions for X", `MoreHorizontal`), when `actions.remove`. It opens a `Popover` (`role="menu"`, `align="end"`) with the `PopoverOption` "Remove".
- **Installing**:
  - the label column's second line becomes `InstallStatus isCompact` (the step in a live region, the bytes outside it), followed by `InstallBar` with `mt-1.5`;
  - the controls hold only **Cancel** (ghost md), at the line's end as drawn.
- **Under the line**, indented to the label column with `ml-14 mr-4 mb-3.5` (56px = 16 + 28 + 12), in this order:
  - the opened `AgentSignIn`;
  - the remove confirmation: a `div` with `flex flex-col gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 py-2.5`, holding the question (`text-ui text-fg-secondary`), then Cancel (ghost md) and Remove (danger md, focused when it opens);
  - a failure or remove error as `text-ui-sm text-danger` (`role="alert"` for the remove error, as today).
- **Opening the sign-in**:
  - `isOpen` starts as `state === "needed"`;
  - an effect opens the row when the state becomes `needed`;
  - the chevron toggles it;
  - an open row stays open when the state turns Ready, so the result shows.

- [ ] **Step 1: Failing tests** in `settings-agents-look.test.tsx`. Render `AgentCatalog` with `fakeCatalog`, as `agent-catalog-ui.test.tsx` does, and a fake `signIn`:
  - `an in-use row is one line with a logo tile, mono source, chip and buttons`:
    - a `.size-7.bg-surface-hover` tile;
    - the mono "… · installed by Zorvo";
    - "Sign-in: Ready";
    - an outline "Update to …";
    - "More actions for …".
  - `an available row has its description and an outline Add`.
  - `a row opens its sign-in when the agent needs one`:
    - the group "… sign-in" is shown;
    - the row has `bg-surface-1`;
    - the chevron is "Hide sign-in for …" with `aria-expanded="true"`.
  - `the chevron shows and hides the sign-in of a ready agent`, with "Check sign-in" inside the panel.
  - `Remove asks under the row, naming running sessions`:
    - ⋯ → Remove shows the question ending "Its open sessions stop.";
    - the danger Remove has focus;
    - Cancel closes the question and focus returns to ⋯.
  - `an install runs inside its row`: the progress event, as in `agent-catalog-ui.test.tsx`, shows the step in a `role="status"` without bytes, the bar, and Cancel.
  - `a failed install offers Retry`, with the error in `text-danger`.
  - `onboarding's rows show no chip and no sign-in`: with no `signIn`, there is no "Sign-in:" text and no chevron.
  
  In `agent-catalog-ui.test.tsx`, the Remove steps go through ⋯ → menuitem Remove → confirm.
- [ ] **Step 2: Run** `pnpm vitest run src/test/settings-agents-look.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the rewrite.
- [ ] **Step 4: Run** `pnpm vitest run src/test/settings-agents-look.test.tsx src/test/agent-catalog-ui.test.tsx src/test/agent-install.test.tsx src/test/settings-sign-in.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/agents/AgentCatalogRow.tsx src/test/settings-agents-look.test.tsx src/test/agent-catalog-ui.test.tsx && git commit -m "feat: one row per agent in Settings, as drawn"`

### Task 4: The section: search, groups, Not available

**Files:**
- Modify: `src/components/agents/AgentCatalog.tsx` and `src/components/agents/UnavailableAgents.tsx`.
- Test: `src/test/settings-agents-look.test.tsx` (extend).

**Canvas values:**
- **Root**: `flex flex-col gap-6`, with `text-xs` gone.
- **Search row**: `flex gap-2`.
  - The search is a `label` with `flex h-8 flex-1 items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-2.5 text-fg-subtle focus-ring-within`, holding a 14px `Search` icon and the `input` (`text-ui text-fg placeholder:text-fg-subtle`, `aria-label="Search agents"`).
  - **Check again** is `Button size="lg"` with a 12px `RefreshCw` that spins while it runs.
  - Under the row: the registry line (`text-caption text-fg-subtle`), and errors as `role="alert"` `text-ui-sm text-danger`.
- **Groups**: "In use" and "Available", each `SettingsGroup` (its heading style, its card with no clip) around a `ul` of rows.
- **Not available**:
  - a toggle `button`: `flex h-7 items-center gap-1.5 self-start rounded px-1 text-ui-sm text-fg-muted focus-ring`, with a 12px `ChevronRight` / `ChevronDown`, "Not available (N)", `aria-expanded` and `aria-controls`;
  - opened, a card of rows: logo tile, name, and `unavailableReasonText` in `text-ui-sm text-fg-subtle`;
  - still open while text is typed in the search.
- **Other states keep their behavior**, now in `text-ui`: "Loading the agents…", the load error with **Try again**, and "No agents match".

- [ ] **Step 1: Failing tests**:
  - `the search row is drawn at 32px`: the search label has `h-8 border-border-strong`, and "Check again" has `h-8`.
  - `groups read In use and Available, without counts`: regions "In use" and "Available"; no "All agents"; no "(4)".
  - `search narrows both groups and opens Not available`.
  - `Not available is a quiet toggle`: `text-fg-muted`, `aria-expanded="false"`, and a click opens it.
- [ ] **Step 2: Run** `pnpm vitest run src/test/settings-agents-look.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run src/test/settings-agents-look.test.tsx src/test/agent-catalog-ui.test.tsx src/test/onboarding-flow.test.tsx src/test/agents-in-use.test.tsx && pnpm lint`. Expected: PASS, lint clean.
- [ ] **Step 5: Commit**: `git add src/components/agents/AgentCatalog.tsx src/components/agents/UnavailableAgents.tsx src/test/settings-agents-look.test.tsx && git commit -m "feat: the Agents section's search, groups and Not available, as drawn"`

### Task 5: Docs and the whole suite

**Files:** Modify `docs/design-system/components/Settings/README.md`, where the Agents bullet becomes a section with the values above and rulings 1–7, and `CHANGELOG.md`, where the Settings line gets "Agents are one row each, and their sign-in opens inside the row."

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `pnpm vitest run src/test/design-system-docs.test.ts && pnpm test`. Expected: PASS, whole suite green. Port and ledger any other test that read the old catalog DOM.
- [ ] **Step 3: Commit**: `git add docs/design-system/components/Settings/README.md CHANGELOG.md <each test ported> && git commit -m "docs: the Agents section"`
