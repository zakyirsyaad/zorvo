# Compare agents — design

Date: 2026-11-01
Branch: `feat/compare-agents`, from `main` at d271dfd.

## Goal

One prompt, several agents, one winner. The user writes one task, picks two to four agents, and
each works on it in its own git worktree. A summary panel shows how each is doing, lets the user
answer what they ask, and picks the result to keep.

This is the feature that makes "every coding agent, one desktop" something a single-vendor app
cannot do. It also has to stay true to Zorvo's other promise: every agent starts in the safest
mode it offers, and nothing is lost by accident.

Success: from one prompt to one winner on its own branch, without leaving Zorvo, without approving
anything on the agent's behalf, and with the numbers on screen telling the truth about what each
agent changed.

## Decisions

Made with the user on 2026-11-01:

- **Comparing is a summary panel,** not chats side by side. At the default 1200 px window a fourth
  column would be too narrow for diffs. Chat columns can be added on top of this later.
- **Pick stops and archives the others.** Their work stays in their worktrees, so nothing is lost.
- **It starts from the new-session composer.** The Agent chip takes several agents, up to four.
  With one agent everything works as it does today.

## What changes for the user

### Starting

In a new-session draft in a git repository, the Agent chip lets the user tick up to four agents.
Ticking a second one:

- turns Worktree on, and it stays on while two or more are ticked;
- hides the Permission mode, Model, Effort and other per-agent chips and the slash command menu,
  since each of those belongs to one agent;
- shows a note under the composer: "Runs in 3 worktrees. Each agent uses its own quota."

An agent whose sidebar chip reads **Sign in** cannot be ticked, and neither can one that is not
installed or has no build for this Mac. Each says why. An agent that reads **Not checked** can be
ticked: that is most agents, and Zorvo cannot know without opening a session. A refusal shows on
its row.

Outside a git repository the chip stays single-choice.

### Running

Send makes one session per agent and opens the panel. The sessions are ordinary sessions: each has
its own chat, transcript, worktree, branch and agent process. Agents never see each other.

The worktrees are made one at a time, since `git worktree add` takes a lock on the repository.
A worktree that cannot be made skips that agent, and a notice names it. When only one session
started it is a normal session and the panel does not open. When none started the message goes
back in the composer, as it does today.

### The panel

The sidebar shows the run as one group, with one row per agent. Clicking the group opens the panel:

| Column | Shows |
|---|---|
| Agent | Logo and name. Clicking the row opens its chat. |
| Status | Starting, Working, Needs you, Needs sign-in, Failed, Done or Stopped |
| Changes | Files changed, lines added and removed |
| Action | **Pick** |

When an agent asks for permission the row shows the request itself, with the agent's own options,
so the user can answer without opening four chats. Zorvo never answers on its own, and a risky
option looks the way it does in the chat. A form or a web page (elicitation) is too big for a row:
the row reads "Needs you" and opening it shows the form in the chat.

The numbers refresh when a turn ends.

### Picking

Pick asks first when another agent is still running: "Stop 2 agents and keep Claude Code's work?"
Then the other agents are stopped and archived, and the winner opens as a normal session on its
branch, ready for more chat, a commit and a pull request.

An agent that cannot be stopped stays listed and a notice names it, which is what archiving does
today, so nothing runs out of sight. The run's group stays until it has gone too, and Pick can be
pressed again.

### After a restart

The run is still there, built from its sessions. Their agents have ended, so the rows read Stopped.
Opening one continues it the way any ended session continues. The panel starts nothing by itself.

## Architecture

### Data

A run is not a stored thing. It is the sessions that share `compareRunId`:

```ts
interface Session {
  /** The compare run this session belongs to. */
  compareRunId?: string | null;
}

interface SessionWorktree {
  /** The commit the worktree started from; what its changes are counted against. */
  startCommit?: string;
}
```

A group shows while two or more **listed** sessions share a run id. So picking needs no stored
winner: archiving the others leaves one listed session, and it reads as a normal session. Deleting
or archiving by hand works the same way, and so does unarchiving a loser: it is a normal session.

There is no migration, and `STATE_VERSION` stays. Old sessions have neither field.

The backend must learn both fields, or it drops them on save: `SessionRecord` and
`SessionWorktreeRecord` in `store.rs` are typed structs. `compare_run_id` uses the `lenient_*`
pattern of its neighbours, so a bad value is dropped and never loses the session. `start_commit`
is `#[serde(default)]`, since sessions saved before it have none. `lib/persistence.ts` checks both
on load, next to `isWorktree`.

### Counting changes

Neither existing target can do this. `head` misses what an agent committed, and `base` measures
from the default branch, so a run started from a feature branch charges that branch's commits to
every agent alike.

- `create_session_worktree` returns `startCommit`: the commit the new worktree checked out.
- A new command, `session_diff_stats_since(path, commit)`, counts the working tree and any commits
  against that commit. It calls `ensure_known_workspace`, requires `commit` to be 40 or 64 hex
  characters, and checks with `git cat-file -e <commit>^{commit}` that it exists, before it reaches
  a git command. It shares `diff_stats`'s body.
- A session with no `startCommit` cannot be in a run, so the panel never falls back to another target.

### Attachments

The composer sends absolute paths, so an attachment or an `@` mention names a file in the main
folder even when the agent runs in a worktree. An agent told to edit that file edits the main
checkout, which breaks the isolation this feature depends on.

A new command, `worktree_attachment_paths(repoPath, cwd, paths)`, returns each path re-rooted in
the worktree. A path outside `repoPath` stays, like a picture from Downloads. A path whose file
does not exist in the worktree stays too, which is an untracked file: the agent can still read it.
Both folders go through `ensure_known_workspace`. The webview has no file access, hence a command.

`handleNewSession` uses it as well, since a single worktree session has the same bug.

### Frontend

- `lib/compare-run.ts`, pure and tested: which sessions form a run, each row's status, whether a
  run has settled, and what Pick must stop.
- `hooks/useCompareRun.ts`: starts a run and picks a winner. `App.tsx` calls it rather than growing.
- `components/compare/CompareRunPanel.tsx` and `CompareRunRow.tsx`: the panel. A row holds its own
  `useDiffStats`, which takes the new command when given a commit.
- `components/sidebar/SessionList.tsx`: the group.
- `App.tsx`: `activeRunId` beside `activeSessionId`. The panel takes the chat's place.

Three things in `App.tsx` assume one draft agent, and a run must not inherit them:

- `startChoices` is computed for the draft agent, so a run computes
  `withPreferred(NO_CHOICES, agentOptions[id])` for each agent. Otherwise one agent's model id is
  sent to another.
- `startSession` selects the session it starts. A run needs a way not to, or focus jumps per agent.
- `useDraftAgentCheck` and `draftNeedsSignIn` watch one agent. With two or more ticked the probe
  does not run, since a probe can open a session in the agent, and the chip's state decides.

### Sign-in

This is the riskiest part. `authRequest` is one slot shared by the draft panel, sessions and
Settings, and a refused prompt today takes that slot and puts the message back in the composer.

Several agents can be refused at once, so inside a run a refused prompt does neither. The session
keeps its message, and the row reads **Needs sign-in**. Opening the row shows the sign-in panel for
that agent the normal way, and `retryAfterSignIn` sends the message. `requestSignIn` still refuses
while another sign-in runs, and the caller says so.

The review must trace interleavings with the existing callers of `authRequest`: a run starting
while a draft's sign-in is open, two refusals in one tick, and Settings' sweep during a run.

### Notifications

A run's sessions send no "finished" notification. The run sends one when all have settled:
"Compare finished: 3 agents are done." Requests for attention still notify one by one, since each
is a different thing to answer.

## Security

- The webview sends ids and folders, never a command. Agents are launched through `launch_for` as
  they are today, with the same safest-mode logic.
- Nothing approves a permission for the user. The panel's buttons are the chat's buttons.
- A worktree is not a sandbox. An agent can still reach anything its process can. This feature adds
  no reach, and the attachment fix removes one way to leave a worktree by accident.
- `commit` from the UI is validated before it reaches git, the same care `branches.rs` takes with
  branch names, and it comes from a state file that may have been edited.

## Limits accepted in this version

- **Quota multiplies.** The composer's note says so.
- **A new worktree has no `node_modules`.** An agent that wants to run tests installs first.
- **Worktrees pile up.** A loser's work is usually uncommitted, and `remove_worktree` refuses
  those, even when the session is deleted. A **Discard results** action is the first follow-up.

## Out of scope

Chat columns, one message to all agents, a model pick per agent, automatic ranking, merging a
winner for the user, and the panel in popout windows. A follow-up message goes through each
agent's own chat.

## Testing

- `compare-run.test.ts`: grouping, statuses, "two or more listed", and what Pick stops.
- Composer: ticking, the limit, disabled agents and their reasons, chips hidden and restored.
- Panel: each status, an inline permission answer reaching the right session, Pick with and without
  running agents, Pick when an agent cannot be stopped.
- Run start: a worktree failing for one agent, for all but one, for all. Each agent gets its own
  choices. Focus lands on the panel.
- Persistence: both fields survive a save and a load through the Rust structs, and a bad value is
  dropped without losing the session.
- Rust: `session_diff_stats_since` counts commits and uncommitted changes from a feature branch,
  refuses a bad hash and an unknown folder. `worktree_attachment_paths` covers inside, outside,
  untracked and subfolder workspaces.
- End to end: two `FAKE_ACP` agents through the real app, from Send to Pick.
