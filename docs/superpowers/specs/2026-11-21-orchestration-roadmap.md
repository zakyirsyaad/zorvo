# Orchestration: roadmap

Date: 2026-11-21
Status: stage 1 merged on 2026-11-21 (pull requests 277, 278, 284, 286 and 287), except its screens. Stages 2 and 3 are not started.
Builds on: `2026-11-08-delegate-to-agent-design.md`, `2026-11-13-zorvo-mcp-tools-design.md`
Reference: stablyai/orca at commit `80bb6517` (2026-11-20, MIT). Its orchestration skill, CLI docs, database schema, worker preamble, turn-stop wording, Crew panel and settings were read. Its federation, SSH, terminal and bot code was not.
Revised: 2026-11-21, after a review of competing apps and of ACP's subagent sessions. The Crew panel moved ahead of messages, and two stages were deferred. "What changed in this revision" lists the changes and the reasons.

## Goal

One agent in a Zorvo session splits a job, starts other agents as workers, and gets their results back without the user carrying messages between them. The user asked for the capability Orca's orchestration has. Three stages are planned, built in order. Two more are deferred until the first three are in use.

Success, in a Claude Code session:

1. The user writes "split this into three parts and work on them in parallel".
2. Claude Code starts three workers, each in its own worktree, and ends its turn.
3. Each worker reports that it succeeded or failed. A worker that stops without reporting is reported by Zorvo.
4. Claude Code reads the reports as one message and tells the user the result.

## Decisions

Made with the maintainer on 2026-11-21, and revised the same day at the maintainer's request.

- **Three stages now, two deferred.** Each stage gets its own spec and its own pull requests. Tasks, and depth and control, are described under "Deferred" and are not committed. This replaces "full parity with Orca's orchestration, in five stages".
- **Workers replace delegates.** The `delegate` tool becomes `start_worker`, and the `@Agent` mention and the Delegate dialog start a worker. The limit of one open delegate per agent goes away. Saved delegate sessions keep working.
- **`start_session` stays** as the handoff: a session that reports to nobody.
- **Approval once per session.** The first worker a session starts shows Zorvo's card. After Allow, that session starts workers without one. If depth is built later, a worker's own workers would run under the same grant.
- **State is derived from sessions.** A worker is an ordinary session that carries a link to its coordinator. No separate orchestration store. `STATE_VERSION` stays 2.
- **An agent's own subagents are separate work.** Zorvo reads them from ACP's standard form in a change of its own, outside these stages. See "An agent's own subagents".

Stage 1 replaces one decision of 2026-11-13 and part of another: one open delegate per agent, and no Zorvo tools in a session an agent opened. Two others stand: one level, and an agent never choosing a model. They change only if the deferred work is taken up.

## Terms

- **Coordinator**: a session that started at least one worker.
- **Worker**: a session a coordinator started, which reports back.
- **Handoff**: a session opened with `start_session`. Unchanged.

A session can be a coordinator unless it is private, part of a compare run, a handoff, or a worker.

## Stages

| Stage | What it adds | What the user gets |
|---|---|---|
| 1. Core loop | `start_worker` in place of `delegate`. Several workers of one agent. A worker in its own worktree. `done` with an outcome. Reports for a worker that stopped without one, failed, was stopped, or whose agent exited. `send` to an idle worker. A worker's agent process ends two minutes after its turn. | "Split this in three and run them in parallel" works |
| 2. Crew panel | An inspector tab that lists a session's workers under Needs you, Working, Idle and Failed, with its agent's own subagents in the same list. A worker stopped at a permission request is under Needs you. Keeping a worker's agent running past the two minutes. A setting for the limit of four. | One place to see who waits for you |
| 3. Messages | `ask` and `reply`. `send` to a worker that is working, held until its turn ends. `send` to every worker at once. Mail that survives a reload. A worker's question shows under Needs you. | A worker can ask its coordinator, and the coordinator can steer it mid-task |

The panel comes second because stage 1 already produces what it shows: outcomes, failures, and workers stopped at a permission request. Four workers in a safe mode can mean four chats to visit, and the panel is where the user finds them. Messages then add questions to a panel that exists.

## Deferred

Not committed. Look at these again once stages 1 to 3 have been in use.

| Work | What it would add | Why it waits |
|---|---|---|
| Tasks (was stage 4) | A task list with dependencies, retry of a failed task up to three times, decision gates. | Orca is the only host app found with it. Claude Code's agent teams have a task list with dependencies, experimental and off by default. ACP's plan operations let a client show an agent's own plan, which may cover part of the need. |
| Depth and control (was stage 5) | Workers that start workers. A coordinator that answers its workers' permission requests. | Orca is again the only reference, and Claude Code's agent teams do not allow a team inside a team. A coordinator that answers permission requests works against starting every agent in its safest mode. |
| A coordinator picking a worker's model and effort | The coordinator passes a model and an effort to `start_worker`. | Small, and separate from depth. It can follow stage 1 as a change of its own when someone needs it. |

Each of the first two is large for one maintainer. A rough guess, not an estimate from a plan, is more than a month each. Orca is built by a company and ships almost daily, so matching it feature for feature is a target that moves.

## An agent's own subagents

ACP made subagent sessions and plan operations stable on 2026-11-20 ([RFD](https://agentclientprotocol.com/rfds/subagents), read on 2026-11-21). In that design the agent creates and owns its subagents. The client watches them through `subagent_update` in `session/update`, and can cancel one only when the child says it can be cancelled. A client cannot start a subagent, and nothing lets one agent's session start an agent of another vendor. No RFD was found for a client that coordinates different agents.

So workers stay a Zorvo feature built on its own tools, as planned here. What changes is how Zorvo learns of the subagents inside one agent. Today it reads them from the `_meta` fields of Claude Code and Qwen Code (`lib/acp-subagents.ts`), and it does not read the standard form.

Reading the standard form gets its own spec and pull requests. Stage 2's panel lists workers and subagents together, so that work should land before stage 2 or with it.

One thing to check first. The RFD names the Claude adapter at 0.109.0 and the Codex adapter at 2.8.0 as sending subagent sessions. The registry history bundled with Zorvo holds 0.93.0 and 2.2.2 as of this revision, and Zorvo offers a version seven days after the registry lists it.

## Limits and defaults

- **Four sessions at work at once per coordinator**: in a turn, waiting for an answer, or being started, with workers and handoffs counted together. This replaces `MAX_RUNNING_OPENED` (3). A fifth start is refused with a sentence that tells the agent to start it when one finishes. Settings can change the number from stage 2.
- **One level.** A worker cannot start workers. If depth is built later, it gets a setting with a default of 1 and a maximum of 4.
- **The user answers every permission request.** No coordinator answers for a worker.
- **A worker starts in its agent's safest mode**, as a delegate does today.
- **Private sessions and compare-run sessions get no orchestration**, for the reasons they get no delegation today.

Two defaults differ from Orca on purpose. Orca's nesting depth defaults to 4, and Zorvo has one level, because every worker is an agent process on the user's Mac. Orca starts agents with their permission-bypass flags unless the user changes that ([Orca's docs](https://orca.dev/docs/agents/supported), read on 2026-11-21), and a Zorvo worker asks first.

## Not copied from Orca

Paired servers, SSH and WSL hosts, agents in a terminal, bots, the `orchestration` CLI, and `reset`. Each serves something Zorvo does not have. Zorvo's agents reach the same tools through its MCP server, and Pi through `zorvo tools`.

Orca also tracks whether a worker's process is alive with states such as `start_unknown` and `stop_unknown`, because it types into terminals it does not own. Zorvo holds each session's ACP connection and is told when a turn ends and when the process exits, so it needs none of that.

## Known costs

- A card shows only the calls that wait on it. An agent that calls tools one after another waits for the first answer, so the card shows the first task and the later ones start unread. This is the approval the maintainer chose.
- Workers in a safe mode stop at permission requests. Four workers can mean four chats to visit. Stage 1 names the waiting workers in the coordinator's chat, and stage 2's panel lists them in one place. Nothing answers for the user.
- Nothing forces a coordinator to end its turn. An agent can call `read_session` in a loop while it waits. The tool descriptions and the hidden context tell it to end its turn. Orca relies on text for this too.
- Every worker is another session on the user's own account with that agent's vendor. Anthropic's [legal page for Claude Code](https://code.claude.com/docs/en/legal-and-compliance) limits how third-party products use plan credentials, and [Antigravity's terms](https://antigravity.google/terms) limit third-party software that reaches the service (both read on 2026-11-21). Zorvo holds no credentials, and each agent signs in with its own tools. Neither page says where an app that starts an ACP adapter stands. Read both again before stage 3 ships, and before any deferred work that runs agents with less of the user present.

## What changed in this revision

- **The Crew panel moved from stage 3 to stage 2**, and it now lists an agent's own subagents with the workers. Stage 1 already produces what the panel shows, and the cost it answers (four chats to visit) starts with stage 1.
- **Messages moved from stage 2 to stage 3.**
- **Tasks, and depth and control, are deferred.** Stage 1 is where the other hosts are: Conductor 0.95.0 (2026-11-16) lets an agent create workspaces and start other agents ([changelog](https://www.conductor.build/changelog)). For task lists, nesting and a coordinator that answers permissions, Orca was the only host found.
- **A coordinator picking a worker's model and effort** is split from depth and listed on its own.
- **ACP's subagent sessions** have a section, because they became stable the day before this roadmap was written and the panel shows them.
- **The vendor terms** are listed under known costs.

The review read docs, READMEs and changelogs on 2026-11-21. No app was run.
