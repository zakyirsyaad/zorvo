# Zorvo tools for agents (MCP) — design

Date: 2026-11-13
Status: draft, waiting for the maintainer's review

## Goal

An agent in a Zorvo session can, by itself, give a task to another agent, give a further task to a
delegate it already has, and open a new session with a brief. The user asks for it in plain words
("then have Qwen review it", "start this in a new session") and the agent does it through tools Zorvo
gives it.

Today the user must do each of these by hand: the `@Agent` mention or the Delegate dialog starts a
delegation, a second task for the delegate is typed in the delegate's own composer, and an agent
asked to open a session can only answer that it cannot.

Success looks like this, in a Pi session:

1. The user writes "agree with option 1, then have Qwen review the fix".
2. Pi does the work and calls `delegate` with Qwen Code and the review task.
3. The first time in this session, Zorvo shows a card; the user allows it for the session.
4. A Qwen Code session starts under Pi's in the sidebar. Its answer comes back to Pi as a report.
5. Later the user writes "ask Qwen to review again". Pi calls `delegate` again; the task goes to the
   same Qwen Code session, with no card.

## Decisions

Made with the maintainer on 2026-11-13.

- **Agents get tools, through MCP.** Zorvo runs its own MCP server and passes it to agents in ACP's
  `mcpServers`. This replaces the 2026-11-08 delegation spec's "An agent cannot delegate on its own:
  Zorvo runs no MCP server for this (`mcpServers` stays `[]`)".
- **Approval once per session.** The first `delegate` or `start_session` call of a session shows a
  Zorvo card. After Allow, that session's later calls run without one. The maintainer chose this over
  a card per call, knowing that later tasks start unread.
- **Two kinds of session, the agent picks per call.** A delegate reports every finished turn back and
  can be given further tasks. An independent session starts from a brief and never reports back.
- **One open delegate per agent.** A session may hold an open delegate for each agent at once (Qwen
  Code and Codex, say), never two of the same agent. "Send to Qwen" therefore needs no session id.
  This replaces "A's open delegation: there is at most one."
- **One level.** A session an agent opened gets no Zorvo tools, so it cannot open sessions.
- **Zorvo never reads a delegation out of free text.** Unchanged. The agent decides, by calling a tool.

## Transport

A stdio bridge. ACP requires every agent to accept stdio MCP servers, so this reaches all of them;
HTTP would reach only agents that declare `mcpCapabilities.http`, and would open a port any local
process can reach.

- `mcpServers` gets one entry, built in Rust: `name: "zorvo"`, `command`: the running Zorvo
  executable (`std::env::current_exe`), `args: ["mcp-bridge"]`, `env`: `ZORVO_MCP_SOCKET` (a path)
  and `ZORVO_MCP_TOKEN`.
- `main` checks for the `mcp-bridge` argument before anything of Tauri starts. In that mode the
  process opens no window, reads no store and writes no file: it connects to the socket, sends the
  token, and copies newline-delimited JSON-RPC between its stdio and the socket until either side
  closes. It holds no logic, so the tools change without a new bridge.
- The backend listens on a Unix socket in the app data dir, created with mode 0600 in a directory
  with mode 0700, and removed on exit. A stale socket file from a crash is replaced at start.
- A token is 32 random bytes, hex, made per app session id when the session's params are built, kept
  in memory only, and dropped when the session stops. A connection that sends no known token within
  2 seconds is closed. The token is how the backend knows which session calls; nothing the agent
  sends names the caller.
- The entry is sent with `session/new` (`acp/manager.rs`), `session/fork`, and `session/load` /
  `session/resume` (`acp/manager/reopen.rs`). The probe (`acp/probe.rs`) keeps `[]`: it runs no turn.
- Not sent: to a session an agent opened (delegate or independent), to a session with a
  `compareRunId`, and when the setting is off. A session delegated by the user, by `@Agent` or the
  dialog, is also a delegate and gets none.
- The MCP server itself (`initialize`, `tools/list`, `tools/call`) is implemented in Rust behind the
  socket, in a new `src-tauri/src/agent_tools/` module: `socket.rs` (listener, tokens),
  `protocol.rs` (the MCP subset), `tools.rs` (schemas and argument validation), `commands.rs`.
  Threads and blocking I/O, as `acp/connection.rs` does; no new dependency is expected.

Under `pnpm tauri dev` the executable is the dev binary, which works the same way.

## Tools

All three take and return plain JSON; errors are MCP tool errors with a sentence the agent can act on.

### `list_agents()`

Returns the agents this session can address: `{ id, name, status }` for each agent in use that can
start, with `status` one of `ready`, `not-checked`, `needs-sign-in`, and, for an agent this session
has an open delegate of, `delegate: { state: "idle" | "working" | "needs-answer", task }`. The
caller's own agent is listed; delegating to the same agent is allowed, as the dialog allows it.

### `delegate({ agent, task })`

- `agent`: an id from `list_agents`. A name is accepted when it matches exactly one agent,
  case-insensitively, since agents will pass what the user typed.
- `task`: non-empty text, at most 20,000 characters, not starting with `/` (a slash command would not
  be at the start of the delegate's prompt, the existing rule).
- No open delegate of that agent: one starts, exactly as `useDelegation.start` starts one today
  (handoff file, the source's `cwd` and `worktree`, remembered choices, safe mode unless a mode was
  picked).
- An open, idle delegate of that agent: the task is sent to it as its next prompt.
- An open delegate that is working or waiting for an answer: an error, "Qwen Code is still working on
  the previous task."
- Returns at once: `{ started: true, session: "<title>", note: "The answer arrives as a message when
  Qwen Code finishes." }`. It never waits for the delegate: agents cap a tool call at minutes, and a
  delegated task can run far longer.

### `start_session({ agent, brief, title? })`

- Opens an independent session of `agent` in the caller's `cwd` (and worktree, if it has one), with
  `brief` as its first message. No handoff file: the brief is all the new session knows, and the tool's
  description tells the agent to make it self-contained.
- `title`: optional, at most 60 characters; else the brief's first line, cut as
  `delegateSessionName` cuts.
- The session records `openedBy: { sessionId, at }` and shows "Opened by Pi" where a delegate shows
  "Delegated from". It sends no reports and is not counted as a delegate.
- At most 3 sessions opened by the same session may be running a turn at once; the fourth call is an
  error that says so.
- The new session is not selected: the user stays where they are.

### What an agent can never send

A folder, a worktree, a command, a mode, a model or a session id. Folder and worktree are the
caller's. This is the same boundary as agent profiles: text and an agent id only.

## From tool call to session

The rules and the session engine live in the webview (`useDelegation.ts`, `lib/delegation.ts`,
`App.tsx`'s `startSession`), and the main window is the single writer. The backend does not
duplicate them.

1. The backend validates the token and the arguments' shape, then emits `agent-tool-call`
   `{ callId, sessionId, tool, args }`.
2. A new hook, `src/hooks/useAgentTools.ts`, handles it in the main window: checks the rules
   (`src/lib/agent-tools.ts`, pure), asks for approval if the session has none, and runs the action
   through the existing `useDelegation` and `startSession`.
3. It answers with the command `agent_tool_respond(callId, result)`; the backend writes the MCP
   result to the bridge.
4. No answer within 10 minutes (the card was left open), or the caller's session stopping, ends the
   call with an error and withdraws the card. A call for a session the webview does not know is an
   error. A webview reload fails every open call (`end_orphaned_sessions` already ends the agents).

`list_agents` takes the same path, since readiness and delegate state are webview state.

## Approval

- The first `delegate` or `start_session` of a session shows an `ActionCard` in that session's chat,
  made by Zorvo, not by the agent's `session/request_permission`: some agents allow MCP tools without
  asking, and the card must not depend on that.
- The card names the calling agent, the target agent, the folder and the task or brief in full
  (through `escapeVisible`, as text), with **Allow for this session** and **Deny**.
- Allow records the grant in memory, keyed by session id, for both tools. It is not persisted: after
  a restart the next call asks again. Ending the session's grant: the ⋯ menu gets **Stop allowing
  delegation** while a grant exists.
- Deny answers the call with an error ("The user declined.") and records nothing; the next call asks
  again.
- A session not on screen with a pending card raises attention as a permission request does
  (`onAttention('needs-answer')`).
- If the agent also asks its own permission for the tool, the user sees that card first and Zorvo's
  second, once. This is accepted.
- `list_agents` needs no approval: it starts nothing and returns agent names and states only.

## Changes to the delegation rules

In `src/lib/delegation.ts`, each with its tests:

- `openDelegateOf(sourceId, sessions)` becomes `openDelegatesOf` (all) and
  `openDelegateOf(sourceId, agentId, sessions)` (one). `delegateBlockedReason` blocks only when the
  target agent already has an open delegate that is busy; for an idle one the action is a follow-up.
- A follow-up: `useDelegation.sendTask(sourceId, delegateId, task)` prompts the delegate through the
  engine's `send`, marked so the chat shows it as a task from the source ("Task from Pi"), and
  updates the link's `task`, which the next report quotes.
- The user's `@Agent` mention and the Delegate dialog use the same rule: for an agent with an open,
  idle delegate they send a follow-up; the dialog's copy says which session it goes to.
- Reports queue. Today a report that arrives while the source cannot be prompted is given back into
  its composer. With agent-started delegations the source is usually still in the turn that made
  the call, so a report now waits in `pending` and is sent when the source's turn ends; reports from
  several delegates are sent one per turn, oldest first. Giving back stays for a send the agent
  refuses.
- `sendBlockedReason`: the user's Send in the source is no longer blocked while a delegate works
  (the source's agent may have several, and the user must be able to steer it). The delegate's Send
  stays blocked while the source works on its report.
- One level stays: `delegateBlockedReason` keeps "A delegated session can't delegate", and such a
  session has no tools to try.

`STATE_VERSION` stays 2: `openedBy` is an optional field read leniently, as `delegatedFrom` is, in
`store.rs` and `lib/persistence.ts`.

## UI

- Sidebar: a source's delegates nest under it as today, now possibly several; an independent session
  is a normal row.
- Chat of the caller: the tool call shows as the agent's own tool row. Zorvo adds nothing but the
  approval card.
- Chat of a delegate: `DelegatedFromLine` as today; a follow-up shows the "Task from" label.
- Chat of an independent session: an "Opened by" line in `DelegatedFromLine`'s place, linking to the
  opener.
- Settings → Agents: one switch, **Let agents delegate and open sessions**, on by default, with a
  line saying a card asks first in each session. Off means `mcpServers` is `[]` for new and reopened
  sessions; running sessions keep their tools until they stop.
- Popouts: a popout forwards actions and never handles a tool call; the main window does, and the
  approval card shows in the main window's chat for that session.
- Copy follows `docs/design-system/README.md`; the card and lines reuse the delegate artboards
  (`docs/superpowers/specs/2026-11-08-delegate-artboards`). New artboards are not planned.

## Security

- Prompt injection is the main risk: text the agent read can ask it to call `delegate`. The first
  call per session shows the task to the user. After Allow, later tasks in that session are not
  shown; this is the maintainer's choice, and the card says "for this session" so the grant's reach
  is clear. Delegates and independent sessions start in the agent's safe mode unless the user chose
  otherwise, as today.
- A report is still another agent's output sent to the source unread, with the existing framing line.
- The socket accepts only this user's processes and only known tokens. A token gives exactly the
  three tools, for one session. Tokens and task text are never logged.
- Fan-out is bounded: one level, one delegate per agent, three running independent sessions per
  opener.
- The bridge mode runs the app's own binary and takes nothing from the webview.

## Not built

- An agent stopping, reading or listing other sessions, or choosing a folder, worktree, mode or model.
- Waiting for a delegate inside the tool call.
- Tools in compare-run sessions, and in sessions an agent opened.
- An `@Agent` mention anywhere but the start of the message: the agent now reads the request itself.
- The user's own MCP server list (Customize). This spec adds the place `mcpServers` is built; the
  list is its own project.
- HTTP transport.

## Risk to settle first

Whether each agent honours ACP's `mcpServers` is not verified: Pi through `pi-acp`, Qwen Code,
Codex, Claude Code, Gemini CLI. The plan's first task is a spike: a throwaway stdio MCP server with
one `ping` tool, passed to each of the five in a real session, recording whether the tool is listed
and callable, the agent's tool-call timeout, and whether it asks its own permission. If Pi ignores
`mcpServers`, the maintainer decides before any product code whether to go on for the others.

## Phases

One spec, three PRs:

1. **Backend.** `agent_tools/`, the bridge mode, tokens, `mcpServers` in the four requests, the
   event and the respond command, the setting. Tested with the fake agent: a new
   `FAKE_ACP_MCP_CALL` flag makes it start the `mcpServers` entry it was given and call a tool, so
   the Rust integration tests cover socket, token, timeout and a stopped session.
2. **Delegation.** `useAgentTools`, the approval card, `delegate` and `list_agents`, several
   delegates, follow-ups, queued reports, the changed Send rule, the user's `@Agent` follow-up.
3. **Independent sessions.** `start_session`, `openedBy`, the "Opened by" line, the cap.

## Testing

- Rust unit tests: token handling, argument validation (lengths, unknown agent, a leading `/`),
  the MCP subset. Integration tests in `tests/it/` for the full path with the fake agent.
- `src/test/tauri-contract.test.ts` covers the new command and event.
- Vitest: `agent-tools.ts` rules; the approval card (allow, deny, withdrawn on timeout, grant reused,
  grant gone after reload); several delegates; follow-up to an idle and to a busy delegate; a report
  that arrives mid-turn and is sent at turn end; two reports in order; the changed Send rule.
- A real-app check with the E2E harness (fake agents, scratch HOME): a fake agent calls `delegate`
  twice and `start_session` once.
- `CLAUDE.md` gets an "Agent tools" paragraph and the delegation paragraph it still lacks; the
  README's privacy section says agents can start other agents after the user allows it.
