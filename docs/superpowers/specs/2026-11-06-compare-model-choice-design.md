# Choosing each agent's model in a compare run

Date: 2026-11-06. Branch: `feat/compare-models`, cut from `feat/redesign-match-composer` (PR #147, phase 8b2). It rebases onto `main` once #147 lands.

## What the user wants

In a new-session draft in a repository, ticking two or more agents starts a compare run. Today the composer hides its model, mode and effort chips while a run is drafted (`App.tsx`: `controls={compare.isCompare ? {} : composer.controls}`). Each agent then starts on the model last picked for it (`withPreferred` in `useCompareRun.ts`), in its safest mode (`applySafeMode`).

The user wants to choose each agent's model before starting a run.

The user's decisions (2026-11-06):

- **Agents.** A run compares different agents, each with the model you choose. The same agent twice with two models is out of scope.
- **Unknown models.** An agent whose model list Zorvo does not know yet (never run, never probed) is asked only when its chip is opened, never when it is ticked.
- **Where.** In the composer's control row, one chip per ticked agent, where the model chip sits in a single-agent draft. Not in the agent menu.
- **Scope.** Model only. Mode stays the safest one, and effort stays as remembered, both hidden as today.

## Success criteria

- With two or more agents ticked, the row shows one model chip per agent, in run order. Each chip leads with the agent's logo and shows the model that agent will start on.
- Picking a model in a chip makes that agent's session start on it. The other agents keep theirs.
- A chip for an agent with an unknown list says "Default". Opening it asks that one agent, and fills the list in the open menu.
- No agent process starts unless you open its chip.
- An agent that turns out to need a sign-in leaves the run, and a notice says why.
- A failed ask never blocks Start: the agent starts on its own default.

## Design

### What you see

- **The row.** In a compare draft, after the paperclip, there is one chip per ticked agent, then the compare note, then **Start N sessions**.
  - A chip looks like the composer's other chips: 28px, borderless, `radius-md`, `ui-sm` in `fg-secondary`, with a 12px chevron in `fg-muted`.
  - It leads with the agent's 16px logo (`AgentLogo`). Its accessible name is "<Agent> model: <model>", for example "Codex model: gpt-5".
  - With four agents the row wraps; the note moves to the next line.
- **What a chip shows:**
  - **A known list:** the model the agent will start on. That is its remembered pick when the agent still offers it, otherwise the agent's current default.
  - **An unknown list:** "Default".
- **Opening a chip.** Its menu opens downward, like every draft menu. It has the 8b2 rows: the check on the left, search over 10 models, and a provider-tag grouping.
  - With an unknown list, the menu shows "Asking <Agent> for its models…" over three skeleton rows while the agent is asked. The rows fill in place when it answers.
  - If the ask fails, the menu says "Could not ask <Agent> for its models." with a **Try again** row. The chip stays "Default".
- **Picking a model** closes the menu. The chip shows the new model.

### How it works

- **No new state.** A pick is the same "remembered model for this agent" a single-agent draft already keeps:
  - `rememberModelPick(agentId, modelId)` for a model from the `models` field;
  - `rememberPick(agentId, configId, value)` for a `model` config option.
  - Both live in `AgentOptions`. `useCompareRun` already starts each session with `withPreferred(NO_CHOICES, agentOptions[agent.id])`, so the run needs no change. `STATE_VERSION` stays as it is.
  - On purpose: a pick made here is also that agent's model in its next single-agent draft. It is one remembered choice per agent.
- **Building the chips.** `compareModelControls(agentIds, agentOptions, names, actions)` in `src/lib/compare-models.ts` returns one `CompareModelControl` per ticked agent, in order:
  - `{ profileId, name, control?, state }`, where `state` is `'known' | 'unknown' | 'asking' | 'failed'`.
  - `control` is built with `acpControls(draftInfo(options, withPreferred(NO_CHOICES, options)), …).model`. A `model` config option and the `models` field both work, as in a single-agent draft.
  - `control` is absent when the list is unknown.
- **Asking on open.** `useCompareModelProbe({ cwd, agentOptions, onProbed, onSignedIn, onNeedsSignIn })` in `src/hooks/useCompareModelProbe.ts`:
  - `ask(profileId)` calls `acp_probe_agent` with `needsOptions: true` and reads the answer with `parseProbeAnswer`. Then:
    - it stores the options with `onProbed` (App's `rememberProbed`);
    - when the answer shows someone signed in, it calls `onSignedIn` (`markSignedIn`);
    - when it is refused with a sign-in (`parseAuthRequired`), it calls `onNeedsSignIn` (`markNeeded`).
  - It asks one agent at a time. An `ask` made while one runs waits in a queue.
  - It does not ask an agent whose list is known, or one already asked this draft (unless that ask failed and Try again was pressed).
  - It exposes `stateOf(profileId)`: `'asking'`, `'failed'` or `undefined`.
  - Its probes are separate from the draft's own probe of its primary agent, which stops when compare starts (`App.tsx`: the `useDraftAgentCheck` agent is `undefined` while `compare.isCompare`). The backend has no lock, so two probes that overlap during the switch only start two processes.
- **A sign-in found by an ask.** `markNeeded` makes the agent untickable, and `useCompareDraft` already drops untickable agents, so it leaves the run and its chip goes away. App shows the notice "<Agent> needs a sign-in, so it left the run. Pick it alone to sign in." No sign-in panel opens in a run's draft.
- **Rendering.**
  - `ComposerDock` takes `compareModels?: CompareModelControl[]` and `onOpenCompareModel?: (profileId: string) => void`. Each entry renders an `OptionDropdown` with `icon` (the logo), `chipClassName` (`COMPOSER_CHIP`), `side="bottom"`, `label="<Agent> model"`, and an open-state key `model:<profileId>`.
  - `OptionDropdown` gains two props:
    - `onOpen?: () => void`, called when its menu opens;
    - `status?: ReactNode`, drawn in place of the rows (the asking skeleton, or the failure and Try again).
  - App passes `compareModels` only while `compare.isCompare`; `controls` stays `{}` then.

### Failures and edge cases

- **Ask fails or times out.** The chip stays "Default", the menu offers Try again, and Start is not blocked. The agent starts on its default.
- **Agent unticked, or draft closed, during an ask.** The answer is still stored for that agent; no chip shows.
- **Remembered model the agent no longer offers.** `withPreferred` drops it, so the agent starts on its default and the chip shows that default.
- **Effort tied to a model.** Effort stays hidden. A remembered effort the agent no longer offers is dropped by `withPreferred`.
- **Agents that cannot report their sign-in** (Gemini CLI, Qwen Code). Their ask opens a session that may stay in the agent's own history, as a single-agent draft's probe does. No extra warning, same as there.
- **Keyboard.** Opening a chip from the keyboard asks the same way. Focus stays in the menu while it loads.

## Testing

- `compareModelControls` (`src/test/compare-models.test.ts`):
  - one entry per ticked agent, in order;
  - a model config option and a `models` field both give a control;
  - a remembered pick is selected;
  - a stale remembered pick falls back to the default;
  - an unknown list gives `state: 'unknown'` and no control;
  - an asking or failed probe state carries through.
- `useCompareModelProbe` (`src/test/use-compare-model-probe.test.tsx`):
  - asks only on `ask`;
  - one at a time, queued;
  - never twice for an agent;
  - stores the answer;
  - an answer showing a sign-in calls `onSignedIn`;
  - a sign-in refusal calls `onNeedsSignIn`;
  - a failure sets `'failed'`, and `ask` after it tries again.
- `OptionDropdown`: `onOpen` fires once on opening; `status` replaces the rows.
- Composer row (`src/test/compare-model-chips.test.tsx`):
  - one chip per agent, each with its logo and the name "<Agent> model: <model>";
  - "Default" for an unknown list;
  - opening an unknown chip calls `onOpenCompareModel` and shows the asking skeleton;
  - menus open downward.
- App flow (in `compare-run-start.test.tsx`):
  - picking a model for one agent makes that agent's session apply it before its first prompt (`acp_set_model` or `acp_set_config_option` for that session), and the other agent's session does not;
  - an ask that finds a sign-in drops the agent from the run and shows the notice.

## Out of scope

- The same agent twice with different models.
- Mode or effort per agent in a run.
- Probing ticked agents before their chip is opened.
- Any backend change.
