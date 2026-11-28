# Continue with another agent

Date: 2026-11-28. Status: design approved in chat, spec waiting for review.
Artboards: section 21 of the Zorvo redesign v2 canvas ("Lanjut dengan agent lain dari tengah sesi"):
`SwitchAgentOptions` (option A), `SwitchAgentComposer` (option D), `SwitchAgentResult` (the new session).
The canvas is the authority for look and copy; this spec is the authority for behaviour.

## Goal

The user wants to move a conversation to another agent in two situations:

1. **The agent is stuck** (a limit ran out, it keeps failing, it gave up): carry on from the last message with
   another agent, and say in the same breath what it should do.
2. **Trying another agent from a point**: from any agent reply, not only the last one, start another agent
   with the conversation up to there.

An ACP session belongs to one agent process, and the agent keeps the history (`~/.qwen`, `~/.claude`, …), so
the same session can never change agent. Moving to another agent always makes a **new session** that receives
the conversation through a handoff file. The UI must say so plainly.

Two entry points, picked by the user from four drawn options:

- **D, the composer:** the agent tile in a running session's composer becomes a picker. The typed message is
  the new agent's first message. Always from the last message.
- **A, the Fork button:** Fork from here under an agent reply becomes a small menu: Fork with the same agent,
  or continue with another one from that message.

Option C (an item in the ⋯ menu) is dropped: D covers the same case better. Option B (a fourth icon) is dropped.

## What exists today

- `useSessionFork(messageId, options)` (`src/hooks/useSessionFork.ts`) already takes `options.agent`: a fork to
  another agent always goes through a handoff file (`buildForkHandoff`, `write_fork_handoff`), never a native
  fork, is never private, and starts with `FORK_FIRST_MESSAGE` ("Pick up from the previous session.") plus the
  hidden `buildForkPrompt(handoffPath)` context. It works whether the source agent is alive or not.
- The only UI that passes `agent` is Private mode's credits-out card (`PrivateCreditsOut.tsx`'s
  `ContinueDialog`, wired by `usePrivateContinue` in `hooks/usePrivateWiring.ts`), which picks the new agent's
  choices with `withPreferred(NO_CHOICES, agentOptions[agentId])`.
- A running session's composer has **no agent tile**: `AgentChipRow` is drawn only in a draft.
- `MessageActionBar` has a one-click Fork from here (`onFork`), wired from `App.tsx` (`forkSession`) through
  `ChatCanvas` (`onForkBranch`) and `MessageRow`.

## Behaviour

### Who can switch

`lib/agent-switch.ts` holds the pure rules.

`switchTargets(agentsInUse, sourceProfileId, signInOf)` returns the menu rows, in the order of the agents in use:

- the source agent first, marked as this session's (`This session`, or `Private` for a private session);
- every other agent in use, with a status word: `Ready`, `Needs sign-in`, `Not checked yet` (from
  `useAgentSignInStatus`, in Settings' words `SIGN_IN_STATUS_WORDS`), or `Not installed`;
- an agent that is not runnable (`isAgentRunnable` false: not installed, unsupported, waiting) is listed but
  disabled. An agent that needs a sign-in can be picked: the new session shows the sign-in panel and sends the
  message after the sign-in, as any session does.

`switchHiddenFor(session, …)` is true, and neither entry point offers another agent, for:

- a session with no messages;
- a compare-run session (`compareRunId`);
- a delegated worker with an open link (`delegatedFrom` without `endedAt`);
- a popout (no picker, and Fork from here keeps today's one click there).

An archived session has no composer and is not a case.

### D: the composer picker

**The tile.** `components/composer/SessionAgentPicker.tsx`, the first item of the composer's chip row for a
session on screen that `switchHiddenFor` does not hide: the agent's tile, its name and a chevron, a menu
button (`aria-haspopup="menu"`). The menu is the shared `Popover` (`components/ui/Popover.tsx`) with `role="menu"` and `menuitemradio` rows
(`aria-checked` on the current pick), arrow keys, Escape back to the tile. Header "Continue in a new session
with" above the other agents; footer "This conversation goes with it. This session stays as it is." For a
private session the header reads "Continue outside the TEE with" and the other rows end in "…".

**Picking.** Picking another agent changes nothing yet. `hooks/useAgentSwitch.ts` keeps, in memory only,
`pending: Record<sessionId, agentId>`. While a session has a pending switch:

- the tile shows the picked agent;
- the composer's chips are the picked agent's, built like a draft's (`draftInfo` / `withPreferred` from
  `settings.agentOptions[agentId]`), and a pick there goes into the pending switch's choices, not into the
  source session (`acp_set_model` and friends are never sent to the source);
- above the card, in the composer's above-card slot, a status note: "Your message starts a new {Agent} session
  that continues this one. {Source agent}'s session stays as it is." with a text button **Keep {Source agent}**,
  which drops the pending switch (picking the source agent in the menu does the same);
- the placeholder reads "Message {Agent}";
- Send's accessible name is "Send to {Agent} in a new session".

The pending switch is dropped when the session is deleted or archived, when it stops being offered
(`switchHiddenFor` turns true), when the picked agent is taken out of use, and after a send that worked.
It survives switching to another session and back, like the composer's text does. It does not survive a reload.

A private session's pick first asks, with the dialog `ContinueDialog` uses today, moved out of
`PrivateCreditsOut.tsx` into `components/private/ContinueOutsideTeeDialog.tsx` and shared (the credits-out card
keeps using it). Only Continue sets the pending switch.

**Sending.** `handleSendMessage` (`hooks/useMessageDeliveryWiring.ts`) gets a branch before the mention and queue
branches: when the session on screen has a pending switch,

1. if the source is busy (`isTurnUnderWay` or `isSessionWaiting`), nothing is sent and the message stays: the
   composer cannot send (see below), so this branch only guards a race;
2. otherwise it calls `forkSession(lastMessage.id, { agent, choices, firstMessage: { text, attachments } })`;
3. on `true`, the pending switch is dropped; the new session is selected by `startSession` as forks are today;
4. on `false`, the message goes back to the source's composer through `giveBackMessage` and the pending switch
   stays.

The secret guard does not run: the new session is not private, and a private source asked before the switch.

**Send blocked.** `composerNote` (`lib/composer-state.ts`) gains a reason, `switchWaits`, ranked like the other
blocks: while the source is in a turn or waits on the user, Send is disabled and described by
"{Source agent} is still working. Wait for it to finish, or press Stop." Stop stays as it is and stops the
source's turn. There is no automatic send at the turn's end.

While the composer holds review comments for this session (`review.isHeldFor`), the picker is disabled with
"Send or clear the review comments first." as its description, so comments never go to an agent they were not
written for.

**Mentions.** While a switch is pending, an `@Agent` at the start of the message is not read as a delegation
(`delegationMentionOf` is not consulted): the note already says where the message goes.

### A: the Fork menu

`MessageActionBar`'s Fork from here (`GitBranch` with a small chevron) opens `components/chat/ForkMenu.tsx`
(the shared `Popover`, `role="menu"`): **Fork with {Agent}** first (today's fork, focused when the menu opens,
so Enter keeps it one key away), a rule, the header "Continue with another agent", then the other rows of
`switchTargets` with their status. A popout and a session `switchHiddenFor` hides keep today's one-click Fork.

Picking another agent calls `forkSession(messageId, { agent, choices })` with today's `FORK_FIRST_MESSAGE`. For
a private session it asks first with `ContinueOutsideTeeDialog`.

`MessageActionBar`'s `onFork?: () => void` becomes `fork?: { agents: SwitchTarget[]; onFork: (agentId?: string)
=> void }` (no `agentId` = the same agent). With `agents` empty (a popout, a hidden session, no other agent in
use) the button forks at once, as today, with no menu. `MessageRow` and `ChatCanvas` pass it through as
`onFork` is today.

### The new session

Built by `useSessionFork` as a handoff fork is today (same folder and worktree, the conversation up to the
message, the handoff file, the name "{source name} (fork)", not private).

`ForkOptions` gains `firstMessage?: { text: string; attachments?: readonly string[] }`: when set it replaces
`FORK_FIRST_MESSAGE` as the shown text, the attachments go with it, and the handoff prompt stays the hidden
`context`. `useSessionFork`'s returned function resolves to `boolean`: `false` when the agent is not installed,
the message is not found or the handoff could not be written (each still raises today's notice), else `true`
once `startSession` has been called. A refusal after that (a sign-in) is handled by the new session as today.

**The "Continued with" line.** Every fork that continues with **another** agent (D or A) marks its first user
message with `continuedFrom: { sessionId, agentId }` through `FirstMessage.marks` (which widens from
`Pick<ChatMessage, 'delegationTask'>` to also allow `continuedFrom`). `MessageRow` draws, above that message,
a centred line between hairlines: "Continued with {Agent} from {source name}", the source name a link that
selects it when it still exists, plain text "a deleted session" otherwise. `normalizeTranscript`
(`lib/persistence.ts`) keeps `continuedFrom` only when both ids are non-empty strings, beside
`withValidAgentMark`. Rust keeps transcripts as opaque JSON. `STATE_VERSION` stays 2. A same-agent fork gets
no line, as today.

## Files

New:

- `src/lib/agent-switch.ts`: `switchTargets`, `switchHiddenFor`, `SwitchTarget`, the copy.
- `src/hooks/useAgentSwitch.ts`: pending switches, their choices, pick, keep, drop rules.
- `src/components/composer/SessionAgentPicker.tsx`.
- `src/components/chat/ForkMenu.tsx`.
- `src/components/chat/ContinuedFromLine.tsx`.
- `src/components/private/ContinueOutsideTeeDialog.tsx` (moved out of `PrivateCreditsOut.tsx`).

Changed:

- `src/hooks/useSessionFork.ts`: `firstMessage`, `boolean` result, `continuedFrom` mark.
- `src/hooks/session-engine/useAcpEngine.ts`: `FirstMessage.marks` type.
- `src/hooks/useMessageDeliveryWiring.ts`: the switch branch.
- `src/lib/composer-state.ts`: `switchWaits` in `composerNote`.
- `src/components/ComposerDock.tsx`: the picker in the chip row, the note in the above-card slot, placeholder
  and Send name.
- `src/components/MessageActionBar.tsx`, `src/components/chat/MessageRow.tsx`, `src/components/ChatCanvas.tsx`:
  the Fork menu props, the line.
- `src/components/private/PrivateCreditsOut.tsx`: uses the moved dialog.
- `src/lib/persistence.ts`: `continuedFrom`.
- `src/types/index.ts` (`ChatMessage`): `continuedFrom?: { sessionId: string; agentId: string }`.
- `src/App.tsx`: wiring only (keep it thin; the logic lives in the hook).
- `CHANGELOG.md`: one line under Unreleased.

No Tauri command, event or Rust change, so `tauri-contract.test.ts` and the cargo checks are untouched.

## Tests

- `agent-switch.test.ts`: row order and status words, disabled rows, each `switchHiddenFor` case.
- `useAgentSwitch.test.ts`: pick, Keep, picking the source again, dropped on delete, archive, agent taken out
  of use, kept across a session switch.
- `useSessionFork.test.ts`: `firstMessage` replaces the shown text and keeps the hidden context and the
  attachments; `false` on a failed handoff write; `continuedFrom` only for another agent.
- Send branch (`useMessageDeliveryWiring` or an App-level test with the fake backend): a send that works selects
  the new session and drops the switch; a failed one gives the message back and keeps it; a busy source sends
  nothing; an `@Agent` prefix is not delegated while a switch is pending.
- `composer-state.test.ts`: `switchWaits` outranks the slash-command hint like the other blocks.
- `SessionAgentPicker.test.tsx` and `ForkMenu.test.tsx`: roles, `aria-checked`, the focused first row, disabled
  rows, Escape returns focus.
- `persistence.test.ts`: `continuedFrom` kept when well formed, dropped otherwise.
- `ContinuedFromLine` render with a live and a deleted source.
- Private: picking another agent opens the dialog; Cancel sets nothing.

Run the touched test files with `pnpm vitest run <file>`, plus `pnpm lint`.

## Not built

- Moving the same session to another agent (impossible: the agent owns the history).
- Sending automatically when the source's turn ends.
- The picker in a popout, a compare run or a delegated worker.
- Renaming the new session after the agent.
- Carrying the source's queued messages or held review comments over.
