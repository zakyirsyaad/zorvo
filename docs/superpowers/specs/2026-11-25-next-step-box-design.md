# Next step at the end of a turn

Date: 2026-11-25. Status: design approved in conversation, spec awaiting review.

Artboards: section 20 of the canvas "Zorvo redesign v2"
(https://claude.ai/artifact/NkShdh56RavBM73MEb9WbU, `NextStepChat` and `NextStepStates`, canvas
Version 74). The artboards own the look and the copy. This spec owns the behaviour.

## Goal

When an agent's turn ends, the user should not have to read a long reply to learn where things
stand and what to do next. A box under the last reply says it in two or three sentences, asks
the one question that is the user's to answer, and offers buttons that answer it. This is the box
Claude Code desktop shows at the end of a turn. The user ranked it the most important feature to
take from that app.

## Decisions made

1. **Two sources, one box.** Zorvo writes the facts and the buttons that fit the repository's
   state. The agent adds a recap, a question, its pick among those buttons and up to two reply
   buttons, through a new tool `wrap_up` on Zorvo's tool server. When the agent does not call it,
   the box still shows, with Zorvo's part only.
2. **Every button sends a message**, exactly as if the user had typed its words in the composer
   and pressed Send. The agent then does the work (commit, push, pull request, merge) with its own
   tools and under its own permission mode. Zorvo runs no `git` or `gh` for a button. The two
   exceptions only open a page and send nothing: **Open in Zorvo's browser** and **Open PR**.
3. **Actions in the first version:** Commit, Create PR, Merge, Turn on auto-merge, Open in Zorvo's
   browser, Open PR, plus the agent's reply buttons. The agent's pick among them is the primary
   button, shown first.
4. **The box lives in the chat.** It is part of the turn's last reply and is saved in the
   transcript. A box from an earlier turn stays readable, with its buttons disabled and one line
   saying what the user answered.
5. **Workers get no box.** A worker's turn ends in a report to its coordinator, so committing and
   opening pull requests is decided in the coordinator's session. (Proposed in conversation, not
   objected to. Change it here if the review disagrees.)

## Where the box appears

A box is drawn under a reply when all of these hold:

- the reply is the last reply of a turn that ended normally (`end_turn`); a cancelled, failed or
  exited turn has its own notice instead;
- the session is a plain session, a fork, or a session another agent opened; not a worker, not a
  compare-run session (its panel replaces the chat), not a private session that has not been
  checked yet (see "Open points");
- the main window shows it. A popout shows the recap and the question with no buttons, and the
  line "Answer in the main window.", as visuals do today.

A box is **active** when its reply is the newest message of the session and the session is idle
(no turn under way, nothing waiting for the user). Otherwise it is **inert**: buttons disabled,
the facts row hidden (facts read now would describe a later state), and, when the user answered
from it, a line "You answered {label}".

## What the box holds

From top to bottom, as on `NextStepChat`:

1. **Source line.** The Zorvo symbol and "Next step". Without a recap it reads "{Agent} finished".
2. **Recap** (agent, optional). Plain text, at most 300 characters.
3. **Facts** (Zorvo, active box only). Chips, each shown only when Zorvo knows it:
   - the branch name;
   - uncommitted changes: "N files +A −D", then "Not committed";
   - commits not pushed: "N commits not pushed" (or "Not pushed" for a branch with no upstream);
   - the session's pull request: "PR #N · Open", its checks ("9 checks passed", "4 of 9 checks
     done", "2 checks failed"), and "Conflicts" when GitHub reports them;
   - a dev server the agent started: "localhost:PORT" and its command.
4. **Question** (agent, optional). One sentence, at most 100 characters.
5. **Buttons.** Primary first, then the rest. A reply button is borderless with a reply icon. When
   the agent picked one, a small line at the end reads "{Agent} suggests {label}".

## Which buttons Zorvo offers

Zorvo decides the action buttons from the facts. The agent cannot add an action that the facts do
not allow; a pick that is not offered is dropped, and the box shows Zorvo's order.

| Facts | Buttons offered | Message sent |
|---|---|---|
| Uncommitted changes | **Commit** | "Commit these changes." |
| Uncommitted changes, or commits not pushed, and no open PR for the branch | **Create PR** | "Commit, push and open a pull request." |
| Open PR, every check passed, no conflicts, `mergeStateStatus` is `CLEAN` | **Merge** | "Merge the pull request." |
| Open PR, checks still running, no conflicts | **Turn on auto-merge** | "Turn on auto-merge for the pull request." |
| Open PR | **Open PR** | none: opens the PR in the default browser |
| A live dev server port | **Open in Zorvo's browser** | none: opens `http://localhost:PORT` in the Browser panel |

On `main` (or the repository's default branch), Create PR is still offered. The agent is expected
to make a branch first; the message does not name one.

Reply buttons come only from the agent, at most two, each at most 24 characters. Their label is the
message.

Order: the agent's pick first (when offered), then Zorvo's buttons in the table's order, then the
reply buttons. At most five buttons in all; Zorvo's buttons are cut before the agent's pick or its
replies.

## Pressing a button

- A message button sends its message through the composer's own Send path (`sendFromComposer`),
  so the secret guard, the queue and every Send rule apply unchanged. The message shows in the
  chat as the user's message.
- When the composer's Send is blocked (a sign-in, a review slot held by another session, a removed
  agent), the box's message buttons are disabled with the same note (`composerNote`).
- What the composer holds is left alone: the button's message is sent on its own, and the typed
  draft stays in the box.
- The box records the answer on its reply (`answered: { label, at }`) as soon as the send is
  accepted, and turns inert as the new turn starts. A send the agent did not take is given back as
  today; the box stays active and records nothing.
- Pressing twice sends once: the buttons disable while the send is in flight.
- Open in Zorvo's browser goes through `requestBrowserOpen` as a manual action. Open PR goes through
  `open_external_url`. Neither records an answer.

## The `wrap_up` tool

Added to the coordinator's tools in `src-tauri/src/agent_tools/tools.rs` (`TOOL_NAMES` grows to
twelve; not in `WORKER_TOOL_NAMES`), reachable by MCP and by `zorvo tools wrap_up` on the command
path.

```json
{
  "name": "wrap_up",
  "description": "Call once at the end of a turn that changed files or leaves the user a decision. recap: two or three short sentences on what is now true and what is not done. ask: the one decision that is the user's, as a question. pick: the action you recommend, if Zorvo offers it. replies: up to two short answers the user may give. Then end your turn.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "recap": { "type": "string", "maxLength": 300 },
      "ask": { "type": "string", "maxLength": 100 },
      "pick": { "type": "string", "enum": ["commit", "create_pr", "merge", "auto_merge", "open_preview", "open_pr"] },
      "replies": { "type": "array", "maxItems": 2, "items": { "type": "string", "maxLength": 24 } }
    },
    "required": ["recap"],
    "additionalProperties": false
  }
}
```

- `validate` checks the shape, trims strings, refuses empty ones and anything longer than the
  limits, with a sentence that never repeats what was sent.
- `useAgentTools` answers it with no card and no grant, like `show_visual`: it cleans every string
  with `escapeVisible`, stores the result on the turn's open reply (`nextStep`), and answers
  "Shown at the end of your turn." A second call in the same turn replaces the first.
- A call from a session that gets no box (a worker never has the tool; a compare-run session has
  no tools) is answered with the existing `NO_SESSION` sentence.

**Telling the agent.** `MCP_PATH_CONTEXT` and `COMMAND_PATH_CONTEXT` gain one sentence: "At the end
of a turn that changed files or leaves the user a decision, call wrap_up with a short recap, the
question that is theirs, and the action you recommend." The existing rule that a slash command
goes out without the note is unchanged.

## Data

- `ChatMessage.nextStep?: { recap?: string; ask?: string; pick?: NextStepAction; replies?: string[];
  answered?: { label: string; at: number } }` on the turn's last reply. `normalizeTranscript` keeps
  it only when every field has its shape and limit; anything else is dropped, not repaired.
  `STATE_VERSION` stays 2. Rust keeps transcripts as opaque JSON.
- Facts are never stored. They are read live for the active box only.
- A reply with no `wrap_up` call has no `nextStep`. Its box, when one is drawn, is Zorvo's part
  alone; there is nothing to save but `answered`, which is then stored as `nextStep: { answered }`.

## Reading the facts

`hooks/useNextStepFacts.ts` (main window, active box only) reads, when the box becomes active and on
window focus while it stays active:

- **Uncommitted changes** from the HEAD stats the inspector already reads (`session_diff_stats`).
- **Branch, upstream and commits not pushed** from a new command `session_branch_state(cwd)`
  (`branch_state.rs`, async): `ensure_known_workspace` first, then `git rev-parse --abbrev-ref
  HEAD`, `git rev-parse --abbrev-ref @{upstream}` (none is an answer, not an error) and `git
  rev-list --count @{upstream}..HEAD`. It returns `{ branch, upstream, ahead, isDefaultBranch }`,
  never a path. Every git call goes through `spawn::command`.
- **The pull request** from `useWorkspacePullRequests`' list, matched by `sessionPullRequestOf`.
  The list's `gh pr list --json` fields gain `mergeStateStatus` and `mergeable`, so Merge is offered
  only for `CLEAN`.
- **A dev server** from `useBackgroundTasks`' `portsFor` for the session.

Each read that fails leaves its chips out. A box with no facts and no agent part is not drawn.

## Code

- `src/lib/next-step.ts`: pure. `offeredActions(facts)`, `buttonsOf(nextStep, offered)` (order,
  cut, the pick dropped when not offered), `messageOf(action)`, `isActiveBox(...)`,
  `parseNextStep` for the transcript and the tool's arguments.
- `src/components/chat/NextStepBox.tsx`: the box, drawn by `MessageRow` for a reply with a turn end.
  A `<section aria-label="Next step">`; real buttons; the pick line is the primary button's
  `aria-describedby`. Copy and look from the artboards.
- `src/hooks/useNextStepFacts.ts`, `src-tauri/src/branch_state.rs` (registered in `lib.rs`).
- `useAgentTools.ts` (`wrap_up`), `tools.rs`, `agent-tools-context.ts`, `types/index.ts`,
  `persistence.ts` (`normalizeTranscript`), `pull_requests.rs` (two fields).
- CHANGELOG line under Unreleased; CLAUDE.md gets a paragraph under **Agent tools** and a short
  **Next step** section.

## Testing

- `next-step.test.ts`: every row of the button table, the order and the cut, a pick that is not
  offered, inert vs active, the messages.
- `tools.rs` unit tests: the schema, `validate` for each limit, `TOOL_NAMES` is twelve and workers
  do not list `wrap_up`.
- `use-agent-tools` test: `wrap_up` stores `nextStep` on the open reply, a second call replaces it,
  escaping, the answer text.
- `next-step-box.test.tsx`: Zorvo-only box, agent box, the pick line, a press sends through
  `sendFromComposer` with the right text, blocked Send disables the buttons, inert box shows
  "You answered".
- `persistence.test.ts`: `nextStep` kept when well formed, dropped otherwise.
- `branch_state.rs` tests against a scratch repository: no upstream, ahead count, default branch,
  an unknown folder refused.
- `tauri-contract.test.ts` covers the new command by itself.

## Not built

- A status line in the sidebar from the recap (considered and not chosen).
- Zorvo running `git` or `gh` for a button.
- Watching a pull request and waking the agent to fix CI (Auto-fix): a separate feature.
- Buttons in a popout.

## Open points

1. **Private sessions.** Whether a private launch hands Zorvo's tools to Qwen Code has to be
   checked before building. If it does not, a private session gets Zorvo's part only.
2. **Agents that do not call `wrap_up`.** Qwen Code 0.25 and 0.27 did not read tool descriptions
   before answering. The context sentence should fix that; if a spike shows an agent still skips
   it, the box falls back to Zorvo's part, which is the designed behaviour, not a failure.
