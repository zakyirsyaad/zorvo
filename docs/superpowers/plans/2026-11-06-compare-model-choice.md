# Choosing each agent's model in a compare run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a compare draft, show one model chip per ticked agent in the composer row, so each agent starts on the model you choose.

**Architecture:** No new state. A pick is the remembered per-agent model that a single-agent draft already keeps (`rememberModelPick` / `rememberPick` in `AgentOptions`), and `useCompareRun` already starts each session with `withPreferred`. New pieces:
- a pure builder, `compareModelControls`;
- a probe-on-open hook, `useCompareModelProbe`, one agent at a time;
- two props on `OptionDropdown` (`onOpen`, `status`);
- one prop pair on `ComposerDock` (`compareModels`, `onOpenCompareModel`).

**Tech Stack:** React 19, Tailwind 4, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-06-compare-model-choice-design.md`

## Global Constraints

- **Model only.** Mode stays the safest one and effort stays as remembered, both hidden in a compare draft (`controls={}` stays).
- **No asking on tick.** An agent is asked (`acp_probe_agent`, `needsOptions: true`) only when its chip is opened and its list is unknown (`!hasReportedOptions(agentOptions[id])`).
- **Chip asks run one at a time.** An agent is asked at most once per App mount, except Try again after a failure.
- **No backend change.** `STATE_VERSION` does not change.
- **Copy, verbatim:**
  - "Default";
  - "Asking <Agent> for its models…";
  - "Could not ask <Agent> for its models.";
  - "Try again";
  - "<Agent> needs a sign-in, so it left the run. Pick it alone to sign in.";
  - the accessible chip name "<Agent> model: <model>".
- **Chip look:** `COMPOSER_CHIP`, a 16px `AgentLogo` as `icon`, `side="bottom"`.
- **Style rules:** no raw colours; `focus-ring` on every control; sentence case.
- **Tests:** run the targeted files while working, and the full suite once at the end.

## Review Focus

1. **Two chips opened quickly.** Opening a second unknown chip while the first is asked must queue, not start a second process, and each chip must end in its own state. Task 3: "queues a second ask behind the first".
2. **An agent unticked during its ask.** The answer is still remembered. A sign-in refusal still marks it "needed", but the "left the run" notice must not show, since it already left. Task 5: "says nothing about leaving when the agent was already unticked".
3. **A pick in a compare chip changes the agent's single draft.** After picking "Qwen fast" for Qwen Code in a compare and then making Qwen Code the only agent, its single draft's model chip shows "Qwen fast". Task 5: "the pick is that agent's model in its next single draft".
4. **A long model list in a compare chip.** Over 10 models gets the search field, grouping and Return-picks-first, as in a single draft. Task 4: "a long list searches like the single draft's".
5. **Try again after a failure.** Pressing Try again asks again and leaves the failed state, instead of doing nothing because the agent was "already asked". Task 3: "asks again after a failure".

---

### Task 1: `OptionDropdown` can tell its opener and show a status

**Files:**
- Modify: `src/components/composer/OptionDropdown.tsx`
- Test: `src/test/option-dropdown-status.test.tsx` (new)

**Interfaces:**
- Produces:
  - `OptionDropdownProps.onOpen?: () => void`. It is called once each time the menu goes from closed to open: when `isOpen` becomes true, in an effect keyed on `isOpen`.
  - `OptionDropdownProps.status?: ReactNode`. When set, it is drawn in place of the rows and the search, the panel is `w-75`, and the `heading` still shows.

- [ ] **Step 1: Write the failing tests:**
  - **"calls onOpen when the menu opens, once":**
    - Render with `isOpen={false}`, then rerender with `isOpen`. Expect `onOpen` called 1 time.
    - Rerender `isOpen` again with no change: still 1.
    - Close, then open again: 2.
  - **"draws the status in place of the rows":**
    - With `status={<p>Asking Codex for its models…</p>}` and one option, `getByText("Asking Codex for its models…")` exists.
    - `queryAllByRole("option")` has length 0.
    - The panel (`getByRole("listbox", { name: "Model" })`) has `w-75`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/option-dropdown-status.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the two props. `status` wins over `hasSearch`.
- [ ] **Step 4: Run** the new file plus `src/test/option-dropdown.test.tsx` and `src/test/composer-menus.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: an option dropdown can tell its opener and show a status in place of its rows`.

---

### Task 2: `compareModelControls`

**Files:**
- Create: `src/lib/compare-models.ts`
- Test: `src/test/compare-models.test.ts` (new)

**Interfaces:**
- Consumes: `acpControls` (`lib/composer-controls`), and `draftInfo`, `withPreferred`, `NO_CHOICES`, `hasReportedOptions` (`lib/acp-draft`).
- Produces:

```ts
export type CompareModelState = 'known' | 'unknown' | 'asking' | 'failed';
export interface CompareModelControl {
  profileId: string;
  name: string;
  state: CompareModelState;
  /** Present only when the agent's list is known. */
  control?: ComposerControl;
}
export function compareModelControls(
  agents: readonly { id: string; name: string }[],
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined,
  askStateOf: (profileId: string) => 'asking' | 'failed' | undefined,
  actions: {
    pickModel: (profileId: string, modelId: string) => void;
    pickConfig: (profileId: string, configId: string, value: string) => void;
  },
): CompareModelControl[];
```

- **The state rule:**
  - `known` when `hasReportedOptions(options)` and the built `acpControls(...).model` exists;
  - otherwise the ask state, else `unknown`.
- **Building `control`:** `acpControls(draftInfo(options, withPreferred(NO_CHOICES, options)), { setMode: () => {}, setModel: (id) => pickModel(profileId, id), setConfigOption: (cid, v) => pickConfig(profileId, cid, v) }).model`.

- [ ] **Step 1: Write the failing tests** (fixtures shaped like `compare-run-start.test.tsx`'s `modelsOf`):
  - **"one entry per agent, in order"** for `[claude, qwen]`.
  - **"a models field gives a control with the remembered pick selected":** `preferredModelId: "qwen-fast"` gives `control.selected === "qwen-fast"`.
  - **"a model config option gives a control":**
    - `configOptions: [{ id: "model", category: "model", currentValue: "a", options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] }]` with `preferredConfig: { model: "b" }` gives `selected === "b"`;
    - its `onChange("a")` calls `pickConfig("codex", "model", "a")`.
  - **"a stale pick falls back to the default":** `preferredModelId: "gone"` gives `selected === currentModelId`.
  - **"an unknown list is unknown, with no control"** for `agentOptions` missing the agent.
  - **"the ask state carries through":** `askStateOf` returns `'asking'` and then `'failed'` for an unknown agent, and the entry's `state` follows.
- [ ] **Step 2: Run** `pnpm vitest run src/test/compare-models.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `src/lib/compare-models.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: build one model control per agent of a compare run`.

---

### Task 3: `useCompareModelProbe`

**Files:**
- Create: `src/hooks/useCompareModelProbe.ts`
- Test: `src/test/use-compare-model-probe.test.tsx` (new; mock `invoke` the way `src/test/use-agent-probe.test.tsx` does)

**Interfaces:**
- Consumes: `parseProbeAnswer` (`hooks/useAgentProbe`), `parseAuthRequired` (`lib/acp-auth`), `hasReportedOptions`, `ProbedOptions`.
- Produces:

```ts
export interface CompareModelProbeDeps {
  cwd: string | undefined;
  agentOptions: Readonly<Record<string, AgentOptions>> | undefined;
  onProbed: (profileId: string, probed: ProbedOptions) => void;
  onSignedIn: (profileId: string) => void;
  onNeedsSignIn: (profileId: string) => void;
}
export function useCompareModelProbe(deps: CompareModelProbeDeps): {
  ask: (profileId: string) => void;
  stateOf: (profileId: string) => 'asking' | 'failed' | undefined;
};
```

- **Rules:**
  - `ask` is a no-op when `cwd` is undefined, when the list is known, when the agent is being asked or queued, or when it was asked successfully this mount.
  - An `ask` for an agent in `'failed'` asks again.
  - Asks run one at a time from a FIFO queue.
  - An answer calls `onProbed`, and `onSignedIn` when `facts.signInChecked`.
  - A rejection with `parseAuthRequired(error) !== null` calls `onNeedsSignIn` and clears the state.
  - Any other rejection, or an unreadable answer, sets `'failed'`.
  - Callbacks are read through refs (`useLatest`), so a re-render never re-asks.

- [ ] **Step 1: Write the failing tests:**
  - **"asks nothing until ask":** no `acp_probe_agent` call after render.
  - **"asks one agent with needsOptions true":** the call is `{ profileId: "codex", cwd: "/w/repo", needsOptions: true }`, `stateOf("codex") === "asking"` until it settles, and then `onProbed` is called with the parsed options.
  - **"queues a second ask behind the first"** (Review Focus 1): with a deferred first answer, `ask("codex")` then `ask("gemini")` gives one call. After the first settles, the second call follows. `stateOf("gemini")` is `"asking"` while queued.
  - **"never asks a known agent or one asked already":** a known list gives no call; a second `ask` after success gives no call.
  - **"marks a signed-in answer":** `facts.signInChecked` true calls `onSignedIn("codex")`.
  - **"a sign-in refusal marks the agent as needing one":** rejecting with `ACP_AUTH_REQUIRED:[{"id":"x","name":"X"}]` calls `onNeedsSignIn("codex")`, and `stateOf` is `undefined`.
  - **"asks again after a failure"** (Review Focus 5): reject with `"boom"`, so `stateOf === "failed"`; then `ask("codex")` makes a second call.
- [ ] **Step 2: Run** `pnpm vitest run src/test/use-compare-model-probe.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook.
- [ ] **Step 4: Run** it, plus `src/test/use-agent-probe.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: ask one compare agent for its models when its chip opens`.

---

### Task 4: The compare model chips in the composer

**Files:**
- Modify: `src/components/ComposerDock.tsx`
- Test: `src/test/compare-model-chips.test.tsx` (new)

**Interfaces:**
- Consumes: `CompareModelControl` (Task 2), and `onOpen` / `status` (Task 1).
- Produces:
  - `ComposerDockProps.compareModels?: CompareModelControl[]`.
  - `ComposerDockProps.onOpenCompareModel?: (profileId: string) => void`.
  - `OpenDropdown` gains `` `model:${string}` ``.
- **Each entry** renders after attach (and after the skeletons), before the inline controls:
  - an `OptionDropdown` with `label={`${name} model`}`, `align="left"`, `side="bottom"`, `icon={<AgentLogo profileId name="" size={16} />}`, and open key `model:<profileId>`;
  - `onOpen={() => state !== "known" && onOpenCompareModel?.(profileId)}`;
  - when `state === "known"`, `{...dropdownProps(key, control)}`;
  - otherwise `options={[{ value: undefined, label: "Default" }]}`, `selected={undefined}`, `onSelect` that only closes, and `status` set to:
    - `unknown` or `asking`: a `p` "Asking <name> for its models…" (`px-2 pt-1 pb-1.5 text-caption text-fg-muted`), then three `span`s, each `aria-hidden`, `data-skeleton-row`, `my-0.5 block h-7.5 rounded bg-surface-hover motion-safe:animate-pulse`;
    - `failed`: a `p` "Could not ask <name> for its models." (same classes, `text-fg-secondary`), then a ghost `Button size="sm"` "Try again" that calls `onOpenCompareModel(profileId)`.

- [ ] **Step 1: Write the failing tests:**
  - **"one chip per agent, each with its logo":** with entries for Claude Code (known, `Opus`) and Codex (unknown):
    - `getByRole("button", { name: "Claude Code model: Opus" })` and `getByRole("button", { name: "Codex model: Default" })` both exist;
    - each `querySelector("[aria-hidden='true']")` is not null (the logo);
    - both come after "Add attachment".
  - **"opening an unknown chip asks it and shows the skeleton":**
    - click "Codex model: Default"; `onOpenCompareModel` is called with `"codex"`;
    - "Asking Codex for its models…" exists;
    - there are 3 `[data-skeleton-row]`;
    - the panel has `top-full`.
  - **"a failed ask offers Try again":** with `state: "failed"`, open it. "Could not ask Codex for its models." exists, and clicking "Try again" calls `onOpenCompareModel("codex")`.
  - **"opening a known chip asks nothing":** click "Claude Code model: Opus"; `onOpenCompareModel` is not called, and the option "Opus" exists.
  - **"a long list searches like the single draft's"** (Review Focus 4): a known control with 12 models gives `getByRole("searchbox", { name: "Search claude code model" })`.
- [ ] **Step 2: Run** `pnpm vitest run src/test/compare-model-chips.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the chips.
- [ ] **Step 4: Run** the new file plus `src/test/composer-card.test.tsx`, `src/test/composer-menu-fixes.test.tsx` and `src/test/draft-layout.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: one model chip per agent in a compare draft's composer`.

---

### Task 5: Wire it in `App`

**Files:**
- Modify: `src/App.tsx`
- Test: `src/test/compare-run-start.test.tsx` (extend)

**Interfaces:**
- Consumes: Tasks 2–4. Also, from `App`: `rememberModelPick`, `rememberPick`, `rememberProbed`, `signInStatus.markSignedIn` / `markNeeded`, `setNotice`, `compare.agentIds`, `agents`, and `shownFolderPath`.
- **What App does:**
  - Builds `const compareModelProbe = useCompareModelProbe({ cwd: shownFolderPath ?? undefined, agentOptions: state.agentOptions, onProbed: rememberProbed, onSignedIn: signInStatus.markSignedIn, onNeedsSignIn })`.
  - `onNeedsSignIn(id)` calls `markNeeded(id)`. When `compare.agentIds` still includes `id`, it also calls `setNotice("<Agent> needs a sign-in, so it left the run. Pick it alone to sign in.")`, reading the ticked ids through a `useLatest` ref.
  - Passes to `ComposerDock`, only while `compare.isCompare`:
    - `compareModels={compareModelControls(compare.agentIds.map(...name...), state.agentOptions, compareModelProbe.stateOf, { pickModel: rememberModelPick, pickConfig: rememberPick })}`;
    - `onOpenCompareModel={compareModelProbe.ask}`.

- [ ] **Step 1: Write the failing tests** (beside "gives each agent its own remembered choices"; reuse `renderApp`, `tickAgents`, `send`, `calls`):
  - **"starts each agent on the model picked in its chip":**
    - Use agentOptions for `claude-acp` and `qwen-code` whose `availableModels` hold both `<id>-default` and `<id>-fast`, with no `preferredModelId`.
    - Tick Qwen Code, open "Qwen Code model: …", and pick "qwen fast". Then `send()`.
    - `acp_set_model` calls map to `[["qwen-code", "qwen-fast"]]` only, so Claude Code gets no model change.
  - **"the pick is that agent's model in its next single draft"** (Review Focus 3): after the pick, untick Claude Code so Qwen Code is alone. Its single draft's chip reads "Model: qwen fast".
  - **"asks a never-used agent only when its chip opens":**
    - No `agentOptions` for `qwen-code`. Tick it: no `acp_probe_agent` call for `qwen-code`.
    - Open "Qwen Code model: Default": one call with `needsOptions: true`.
  - **"an agent that needs a sign-in leaves the run with a notice":**
    - The probe for `qwen-code` rejects with `ACP_AUTH_REQUIRED:[…]`. Open its chip.
    - The chip "Qwen Code model: …" is gone.
    - The notice text "Qwen Code needs a sign-in, so it left the run. Pick it alone to sign in." shows.
  - **"says nothing about leaving when the agent was already unticked"** (Review Focus 2): with a deferred rejecting probe, open Qwen Code's chip, untick Qwen Code, then reject. No notice.
  - **"a failed ask still starts the run on the agent's default":** the probe for `qwen-code` rejects with `"boom"`; open its chip and see "Could not ask Qwen Code for its models."; `send()`. `acp_start_session` is called twice, and no `acp_set_model` call goes to the `qwen-code` session.
- [ ] **Step 2: Run** `pnpm vitest run src/test/compare-run-start.test.tsx`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run** `src/test/compare-run-start.test.tsx`, `src/test/compare-composer.test.tsx` and `src/test/acp-app.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: choose each agent's model before a compare run starts`.

---

### Task 6: Docs, changelog, full check

**Files:**
- Modify: `docs/design-system/components/Composer/README.md`, `CHANGELOG.md`

- [ ] **Step 1:** In the Composer README, under "Compare note", add a "Compare models" bullet: one chip per agent with its logo, "Default" until its list is known, asked only when opened, and a pick remembered for that agent.
- [ ] **Step 2:** Add a CHANGELOG line under Unreleased: "**Choose each agent's model in a compare run.** With several agents ticked, the composer shows a model chip per agent; an agent Zorvo has not used yet is asked for its models only when you open its chip."
- [ ] **Step 3: Run** `pnpm lint`, then `pnpm test > .superpowers/full-suite.log 2>&1; tail -6 .superpowers/full-suite.log`. Expected: lint clean, all tests pass.
- [ ] **Step 4: Commit:** `docs: choosing each agent's model in a compare run`.
