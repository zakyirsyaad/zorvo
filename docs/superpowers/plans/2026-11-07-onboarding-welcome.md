# Onboarding as one welcome screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First run (and Settings → Run setup again) shows one welcome screen instead of the three-step wizard. You tick the agents you'll use, pick a project folder, and press Start, which opens a new-session draft in that folder with the default agent.

**Architecture:**
- **Rules** are pure helpers in `src/lib/onboarding.ts`:
  - which agents show, and in what order;
  - each row's words;
  - the default agent;
  - when Start is allowed, and its note.
- **The screen** is `src/components/Onboarding.tsx` (same export, new props), drawing `onboarding/Wordmark.tsx`, `onboarding/AgentChoices.tsx` (section 1) and `onboarding/FolderChoice.tsx` (section 2).
- **Ticking** goes through the app's existing `catalogActions.addAgent`, which enables the agent and installs it when needed: the same `install_agent` path as Settings.
- **Unticking** only takes the agent out of use (`withAgentRemoved`) and cancels a running install. It never deletes Zorvo's copy.
- **`App.tsx`** passes the catalog, the sign-in store and these actions, and Start opens the draft.

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-04-onboarding-settings-redesign-design.md`, section "Onboarding" ("Suggested phases" step 3).

**Artboard:** `project/Onboarding.dc.html` in https://claude.ai/artifact/3phT51j88Vx28KT2EpXjjz (copy in the scratchpad, `canvas/project/`). The artboard decides the look; the spec decides behavior.

**Branch:** `feat/redesign-onboarding`, from main 18400c5, in the `redesign-foundations` worktree.

## Global Constraints

- **The Settings plans' constraints hold:**
  - the token mapping;
  - no raw colours in components;
  - `Button` sizes through `size` only;
  - outline labels in `span.text-fg`;
  - `focus-ring` on everything focusable;
  - sentence-case copy;
  - explicit `git add` paths.
- **Accessibility:**
  - the checkboxes are real `<input type="checkbox">`;
  - Start's note is linked with `aria-describedby`;
  - progress is `role="status"`, and bars carry their values. `InstallStatus` and `InstallBar` already do both.
- **Sign-in is not required** to finish onboarding. An agent that needs one asks in the draft, as the main window does already.
- **Never store keys**, and never delete an agent's copy from onboarding.

## Rulings made while planning (the user can overturn them at plan review)

1. **No sign-in or setup buttons on the welcome screen.**
   - The spec lists "Needs setup" with **Open setup** and "a sign-in button" per row, but it also says sign-in is not required here and that the draft asks.
   - Rows say the state in words: "Ready", "Not checked", "Sign in when you start" for an agent seen needing one, and "Set up when you start" for an agent whose only way in is its own setup (Qwen Code, through the phase 7 helper the draft's setup card uses).
   - This keeps one place for sign-in and setup, the draft's cards from phases 6 and 7, instead of a third copy.
2. **The wordmark is the brand lockup.**
   - The double-prompt symbol, inlined from `docs/brand/assets/zorvo-symbol.svg` with `currentColor`, beside `zorvo`, set as the canvas shows: 28/28, 600, `-0.04em`, in Instrument Sans, which the brand brief names.
   - The app bundles only Geist Mono, and the CSP forbids downloading a font. So the plan adds `@fontsource/instrument-sans` (weight 600 only, bundled the way Geist Mono is) and uses it for the wordmark alone.
   - This is a new dependency. The alternative is the system font.
3. **Suggested and recent folders stay.**
   - The canvas draws only the chosen folder with **Change**. Today's setup also offers the folders it found under `~/developer` and the recent ones, which saves a dialog on first run ("keep a function, restyle it").
   - With no folder chosen, the card lists up to 4 of them (recent first), each with **Use**, then a row "Another folder" with **Open folder**.
   - Once a folder is chosen, the card is the canvas's single row with **Change**.
   - Run setup again starts with the most recent folder chosen.
4. **Which agent Start uses.**
   - The default is `settings.defaultAgentId` when that agent is ticked, else the first ticked row.
   - Start uses the default when it is ready, else the first ticked agent that is ready, and saves that agent as `defaultAgentId`.
   - This matches the canvas's "Codex is still installing. You can start with Claude Code now."
5. **"Ready" means runnable now**: `isAgentRunnable(profile)`, availability `ready`. An agent Zorvo would still have to install does not enable Start. The old wizard's `isAgentUsable` counted installable agents too.
6. **Rows shown first.**
   - First the agents in use or found on this Mac, then the popular ones in this order: `POPULAR_AGENT_IDS = ["claude-acp", "codex-acp", "gemini", "qwen-code"]`, until 5 rows show.
   - **Show all agents** reveals the rest.
   - `unsupported`, `waiting` and unavailable agents are never offered.
7. **Make default** shows on a ticked row that is not the default while the row is hovered or holds focus (spec). It stays in the Tab order, so keyboard users can reach it.

## Review Focus

Most likely first:

1. **Unticking an agent while it installs**: the install is cancelled, the agent leaves use, and nothing is deleted. *Task 5: "unticking an installing agent cancels it and keeps its files".*
2. **The default agent is unticked**: the Default tag moves to the next ticked row, and Start's agent follows. *Task 1: "the default moves to the first ticked agent when it is unticked".*
3. **Start while another ticked agent installs**: the draft opens with a ready agent, and the install keeps running. *Task 5: "Start opens a draft with the ready agent while another installs".*
4. **Run setup again with recent folders and sessions**: the most recent folder is chosen, and no session is lost. *Task 5: "Run setup again picks the most recent folder".*
5. **The folder dialog is cancelled or fails**: the choice stays, and a failure says why. *Task 4: "a failed dialog says so and keeps the choice".*

---

### Task 1: The welcome screen's rules

**Files:** Create `src/lib/onboarding.ts`. Test: `src/test/onboarding-rules.test.ts`.

**Interfaces (produces):**
- `POPULAR_AGENT_IDS: readonly string[]`.
- `visibleAgents(catalog: readonly CatalogAgent[], enabledIds: readonly string[], showAll: boolean): CatalogAgent[]`:
  - drops `unsupported` and `waiting`;
  - puts in-use or found agents first (in `enabledIds`, or status `by_zorvo`/`on_your_mac`), in catalog order;
  - then `POPULAR_AGENT_IDS` in order;
  - then the rest by name;
  - without `showAll`, cuts at 5, but never cuts an agent in use.
- `hasMoreAgents(catalog, enabledIds): boolean`.
- `rowWords(agent: CatalogAgent, signIn: SignInState, isSetupOnly: boolean): string`:
  - a `not_installed` agent reads "Zorvo installs it when you tick it";
  - otherwise "{source} · {sign-in}":
    - source: "On this Mac", "Installed by Zorvo", or "Runs with {distribution}";
    - sign-in: "Ready", "Not checked", "Sign in when you start", or "Set up when you start" when `isSetupOnly` and not ready.
- `defaultOf(ticked: readonly string[], preferred: string | null): string | null`.
- `startAgentOf(ticked: readonly string[], preferred: string | null, isReady: (id: string) => boolean): string | null`.
- `startGate({ ticked, defaultId, folder })`, where `ticked: readonly { id: string; name: string; isReady: boolean; isInstalling: boolean }[]`, returns `{ canStart: boolean; note: string }`. The notes, first match wins:

  | Situation | Note |
  | --- | --- |
  | Nothing ticked | "Tick an agent to continue." |
  | None ready, one installing | "{Name} is still installing." |
  | None ready, several installing | "Your agents are still installing." |
  | None ready, none installing | "Install one of these agents to continue." |
  | No folder | "Choose a project folder." |
  | Ready, while another ticked agent installs | "{Installing} is still installing. You can start with {Start agent} now." |
  | Otherwise | "", and `canStart` is true |

- [ ] **Step 1: Failing tests**:
  - each note above;
  - `visibleAgents`: order, the cut at 5, agents in use never cut, unavailable agents dropped;
  - `rowWords` in every state;
  - `defaultOf`: "the default moves to the first ticked agent when it is unticked";
  - `startAgentOf`: a ready agent over an installing default.
- [ ] **Step 2: Run** `pnpm vitest run src/test/onboarding-rules.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/lib/onboarding.ts src/test/onboarding-rules.test.ts && git commit -m "feat: the welcome screen's rules"`

### Task 2: The wordmark

**Files:**
- Create `src/components/onboarding/Wordmark.tsx`.
- Modify:
  - `package.json` and `pnpm-lock.yaml` (`pnpm add @fontsource/instrument-sans`);
  - `src/main.tsx` (`import "@fontsource/instrument-sans/600.css"`);
  - `src/styles/globals.css`: add `--font-brand: "Instrument Sans", var(--font-sans)` to `@theme`;
  - `docs/design-system/tokens.json`, to match (`design-system-docs.test.ts` fails on drift).
- Test: `src/test/onboarding-welcome.test.tsx` (new).

**Interfaces:** Produces `Wordmark()`:
- the container is a `div`: `flex items-center gap-2.5`, `role="img"`, `aria-label="Zorvo"`;
- the symbol is an inline `svg`: `viewBox="0 0 40 40"`, the three paths of `zorvo-symbol.svg`, `stroke="currentColor"`, `strokeWidth={3.6}`, round caps and joins, `size-7 text-fg`, `aria-hidden`;
- `zorvo` is a span: `font-brand text-[28px] leading-7 font-semibold tracking-[-0.04em] text-fg`, `aria-hidden`.

- [ ] **Step 1: Failing test** `the wordmark is the symbol beside zorvo`: the img "Zorvo" holds an svg with three paths, and the text "zorvo" has `font-brand`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/onboarding-welcome.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the package, the import, the token in both files, and the component.
- [ ] **Step 4: Run** `pnpm vitest run src/test/onboarding-welcome.test.tsx src/test/design-system-docs.test.ts src/test/design-tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add package.json pnpm-lock.yaml src/main.tsx src/styles/globals.css docs/design-system/tokens.json src/components/onboarding/Wordmark.tsx src/test/onboarding-welcome.test.tsx && git commit -m "feat: the zorvo wordmark for the welcome screen"`

### Task 3: Section 1, agents you'll use

**Files:**
- Create `src/components/onboarding/AgentChoices.tsx`.
- Modify `src/components/settings/SettingsGroup.tsx`: `SettingsRow` gains `className?: string`.
- Test: `src/test/onboarding-welcome.test.tsx`.

**Interfaces:** Produces `AgentChoices` with these props:
- `catalog: readonly CatalogAgent[]`;
- `enabledIds: readonly string[]`;
- `defaultId: string | null`;
- `signInStateOf: (id: string) => SignInState`;
- `isSetupOnly: (id: string) => boolean`;
- `onTick: (id: string) => void`;
- `onUntick: (id: string) => void`;
- `onMakeDefault: (id: string) => void`.

Each row reads its job with `useAgentInstall(id)`.

**Canvas values:**
- **Section**: `flex flex-col gap-2.5`, headed by an `h2` (`flex items-center gap-2 text-ui font-semibold text-fg`):
  - a `size-5 rounded-full border border-border-strong text-caption text-fg-secondary` number "1" (`aria-hidden`);
  - then "Agents you'll use".
- **Card**: the Settings card (`rounded-xl border border-border bg-surface-2`) holding a `ul` with `aria-label="Agents you'll use"`.
- **Each row** is a `SettingsRow isTight className="group"`.
  - **Leading**:
    - a checkbox: `input type="checkbox"` with `appearance-none size-4 rounded border-[1.5px] border-border-strong checked:border-fg checked:bg-fg focus-ring`, a `Check` icon (11px, stroke 3, `text-bg`) drawn over it while ticked, and `aria-label="Use {name}"`;
    - then the Agents rows' 28px logo tile.
  - **Label**: the name. On the default row it is followed by a "Default" tag: `inline-flex h-4.5 items-center rounded border border-border px-1.5 text-[10px] font-medium text-fg-muted`.
  - **Description**:
    - normally `rowWords`, with a still `StatusLine status="ready"` dot when Ready;
    - while installing, `InstallStatus isCompact` plus `InstallBar` (`mt-1.5`);
    - after a failed install, its words in `text-danger`, with **Retry** (`job.install`) as the control.
  - **Control**: on a ticked row that is not the default, **Make default** (ghost md, `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`).
- **Show all agents / Show fewer agents**: a button with `self-start h-6.5 px-1 text-ui-sm text-fg-muted focus-ring` and `aria-expanded`, shown when `hasMoreAgents`.

- [ ] **Step 1: Failing tests**, rendering `AgentChoices` with `fakeCatalog`:
  - `rows are real checkboxes named by the agent`;
  - `ticking calls onTick, unticking onUntick`;
  - `the default row carries a Default tag and the others Make default`;
  - `a ready agent says where it runs and that it is ready`;
  - `an agent that needs a sign-in says it will ask when you start`;
  - `an agent not installed says Zorvo installs it when you tick it`;
  - `an install shows its step and bar in the row`, through `startInstall` with a pending backend, as `settings-agents-look.test.tsx` does;
  - `Show all agents reveals the rest`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/onboarding-welcome.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run src/test/onboarding-welcome.test.tsx src/test/settings-parts.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/onboarding/AgentChoices.tsx src/components/settings/SettingsGroup.tsx src/test/onboarding-welcome.test.tsx && git commit -m "feat: the welcome screen's agent list"`

### Task 4: Section 2, project folder

**Files:**
- Create `src/components/onboarding/FolderChoice.tsx`.
- Delete `src/components/onboarding/FolderStep.tsx`.
- Test: `src/test/onboarding-welcome.test.tsx`.

**Interfaces:** Produces `FolderChoice` with these props:
- `folder: FolderOption | null`;
- `recentFolders` and `suggestedFolders`;
- `onChoose: (folder: FolderOption) => void`;
- `onPickFolder: () => Promise<FolderOption | null>`.

**Look:**
- **Heading**: as in section 1, numbered "2", "Project folder".
- **A folder chosen**: one row, made of:
  - a `size-7 rounded-[7px] bg-surface-hover text-fg-secondary` tile holding a 14px `Folder` icon;
  - the name;
  - the path in `font-mono text-caption`;
  - **Change** (outline md), which calls `onPickFolder`.
- **None chosen**:
  - up to 4 rows from `recentFolders`, then `suggestedFolders`, deduplicated by path, each with **Use** (outline md, `aria-label="Use {name}"`);
  - then a row "Another folder" with **Open folder**;
  - when both lists are empty, only that last row shows.
- **A failed dialog** shows "Couldn't open the folder dialog. Try again." (`role="alert"`, `text-ui-sm text-danger`) under the card. A cancelled dialog changes nothing.

- [ ] **Step 1: Failing tests**:
  - `a chosen folder shows its path and Change`;
  - `with none chosen, recent and suggested folders are offered once each, then Open folder`;
  - `Use chooses a folder`;
  - `a failed dialog says so and keeps the choice`;
  - `a cancelled dialog changes nothing`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/onboarding-welcome.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, then delete `FolderStep.tsx`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git add src/components/onboarding/FolderChoice.tsx src/components/onboarding/FolderStep.tsx src/test/onboarding-welcome.test.tsx && git commit -m "feat: the welcome screen's folder choice"`

### Task 5: The screen and its wiring

**Files:**
- Rewrite `src/components/Onboarding.tsx`; modify `src/App.tsx`.
- Delete `src/components/onboarding/AgentsStep.tsx` and `DefaultAgentStep.tsx`.
- Tests: rewrite `src/test/onboarding.test.tsx` for the screen; update `src/test/onboarding-flow.test.tsx` and add App cases there; port any other test that reads the wizard's "Check your agents" or "Continue".

**Interfaces:**
- **`OnboardingProps`**:
  - `catalog: AgentCatalog | null`;
  - `agents: readonly AgentProfile[]` (for readiness);
  - `settings: Settings`;
  - `signInStateOf(id)` and `isSetupOnly(id)`;
  - `onTick(id)`, `onUntick(id)` and `onMakeDefault(id)`;
  - `recentFolders`, `suggestedFolders` and `onPickFolder`;
  - `onComplete(result: OnboardingResult)`. `OnboardingResult` stays `{ defaultAgentId, folder }`.
- **Screen**:
  - `main`: `relative flex h-screen w-full justify-center overflow-y-auto bg-bg px-6 py-16 text-fg-secondary`, with a top drag strip (`absolute inset-x-0 top-0 h-12`, `data-tauri-drag-region`);
  - the column: `flex w-full max-w-[640px] flex-col gap-7`;
  - the header: `flex flex-col gap-3`, holding the `Wordmark`, an `h1` "Every coding agent. One desktop." (`text-[28px] leading-[34px] font-semibold tracking-[-0.03em] text-fg`), and "Pick the agents you'll use and a project folder. You can change all of this later in Settings." (`text-sm leading-[22px] text-fg-muted`);
  - then `AgentChoices` and `FolderChoice`;
  - the footer: `flex items-center gap-3 pt-2`, holding the note (`id`, `role="status"`, `flex-1 text-ui-sm text-fg-subtle`) and **Start** (`Button variant="primary" size="lg"`, disabled unless `canStart`, `aria-describedby` set to the note while it has text).
  - Folder state starts at `recentFolders[0]` when there is one.
- **`App.tsx`**:
  - `onTick` is `catalogActions.addAgent`;
  - `onUntick(id)` runs `cancelInstall(id)` when its job is `installing`, then `updateState` with `withAgentRemoved(settings, id, enabledAgentIds(settings))`;
  - `onMakeDefault(id)` sets `defaultAgentId`;
  - `signInStateOf` is `signInStatus.stateOf`;
  - `isSetupOnly(id)` is `isSetupOnly(settingsSignIn.methodsOf(id))`, using `isSetupOnly(methods)` from `lib/acp-auth.ts` (phase 7). The methods are known only once the agent has been asked, so an agent never asked reads its plain sign-in words;
  - `handleOnboardingComplete` also calls `openNewSession(folder.path, defaultAgentId)` after `rememberFolder`.

- [ ] **Step 1: Failing tests**:
  - `onboarding.test.tsx`:
    - the header copy and the wordmark;
    - `Start says why it is off`, one case per note;
    - `Start is on with a ready agent and a folder`;
    - `the default row is the saved default when ticked`.
  - `onboarding-flow.test.tsx` (App):
    - `ticking an agent puts it in use and Start opens a draft in the folder with it`;
    - `Start opens a draft with the ready agent while another installs`;
    - `unticking an installing agent cancels it and keeps its files`: `cancel_agent_install` is called, and `remove_agent_install` is not;
    - `Run setup again picks the most recent folder`.
  - Port the wizard tests to the screen.
- [ ] **Step 2: Run** `pnpm vitest run src/test/onboarding.test.tsx src/test/onboarding-flow.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**: the screen, the `App.tsx` wiring, and the deletions.
- [ ] **Step 4: Run** `pnpm vitest run src/test/onboarding.test.tsx src/test/onboarding-flow.test.tsx src/test/onboarding-welcome.test.tsx src/test/agents-in-use.test.tsx && pnpm lint`. Expected: PASS, lint clean.
- [ ] **Step 5: Commit**: `git add src/components/Onboarding.tsx src/components/onboarding src/App.tsx src/test/onboarding.test.tsx src/test/onboarding-flow.test.tsx && git commit -m "feat: onboarding as one welcome screen"`

### Task 6: Docs and the whole suite

**Files:**
- Create `docs/design-system/components/Onboarding/README.md` and `preview.html` (token variables only).
- Modify `CHANGELOG.md`, adding under Unreleased: "First run is one welcome screen: tick the agents you'll use (Zorvo installs the ones that need it), pick a folder, and Start."
- Modify `CLAUDE.md`:
  - the "Agent catalog" paragraph, which says onboarding renders the catalog: it now renders the welcome screen's own rows;
  - any other mention of the wizard (`grep -n -i "onboarding" CLAUDE.md`).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `pnpm vitest run src/test/design-system-docs.test.ts && pnpm test`. Expected: PASS, whole suite green. Port and ledger any other test that read the wizard.
- [ ] **Step 3: Commit**: `git add docs/design-system/components/Onboarding CHANGELOG.md CLAUDE.md <tests ported> && git commit -m "docs: the welcome screen"`
