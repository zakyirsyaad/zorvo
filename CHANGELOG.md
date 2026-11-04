# Changelog

All notable changes to Zorvo. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed

- **The app uses the Mac's system font (SF Pro) for its interface.** Code, commands and paths stay in Geist Mono.
- **Notices appear as a card in the bottom right corner** instead of a strip across the top of the chat, so they no longer push the conversation down. A long message wraps inside the card, and **Dismiss notice** closes it as before.

## [0.8.1] - 2026-11-04

### Fixed

- **Qwen Code's questions now show, and your answers reach it.** When Qwen Code asks you something with its question tool, Zorvo showed an empty permission card with a single Submit button, and Qwen Code always read it as "No valid answers were provided". The card now shows each question with its options (one pick, or several for a multi-select question) and an **Other** field for your own words. **Submit** is enabled once every question has an answer, and **Cancel** declines. What you type goes only to Qwen Code: Zorvo does not save or log it, and the answered card keeps just your choice of Submit or Cancel.
- **A long session no longer rewrites its whole conversation every second.** Zorvo saved a session's conversation in full once a second while an agent worked, so a session with a few megabytes of tool output wrote gigabytes to disk in an hour and could slow the window down. A large conversation is now saved less often while the agent streams, the larger it is the longer the wait, never more than 10 seconds apart, and at once when a turn ends or the agent asks you something; a small one is still saved every second, and everything is still saved when Zorvo closes.

## [0.8.0] - 2026-11-04

### Added

- **Select text in the chat, and reply to it.** The chat's text can now be selected and copied: replies, your messages, code and tool output, though not its buttons. Select text in a message and press **Reply** to quote it in your message, with a line under it for your question. Nothing is sent until you press Send. Reply is off, and says why, while the message box is hidden or holds review comments for another session.
- **Activity panel.** See what an agent reported in a session: the files, the commands and the permissions you answered, with a jump to each in the chat. Files git shows as changed that the agent did not report are listed apart. It is the agent's own report, and only file changes are checked.
- **Compare agents.** In a git repository, tick up to four agents on a new session's Agent chip and send one prompt to all of them. Each agent works in its own worktree and uses its own quota. One panel shows each agent's state and what it changed, you answer permissions there, and **Pick** keeps one: the others stop and are archived, and their worktrees stay.
- **Comment on lines of a diff.** Open a session's diff, or a compare row's numbers, and leave comments on the lines you want changed. **Add** puts them in your message with each file, line and quoted line, for you to read, edit and send. Comments survive a restart. A sent comment stays, dimmed, as a record until **Clear sent**, and a comment whose line changed reads **Outdated** and never moves to another line.

### Changed

- **The landing page and docs show Zorvo 0.7.** The hero picture lists the detected agents with Ready or Sign in, and the features cover the composer's choices, failed turns and self-updates. The docs gain an Update Zorvo section, the sign-in status picture, the Not available agents, and The composer in the quickstart, and Troubleshooting covers failed turns, Gemini CLI and updates that do not install.
- **Zorvo is open source.** The source is at [zakyirsyaad/zorvo](https://github.com/zakyirsyaad/zorvo), under the Apache License 2.0. The license does not cover the Zorvo name or logo.
- **Releases moved to [zakyirsyaad/zorvo](https://github.com/zakyirsyaad/zorvo).** Downloads, updates, the user guide and issues now live there, not in zorvo-releases. Copies up to 0.7.0 get this version through zorvo-releases as usual, and update from the new place after that.

### Fixed

- **Opening a removed agent's session no longer clears your message.** A look at a saved session whose agent you removed used to empty the box, along with any review comments in it. The message now stays and returns with the session you wrote it for.
- **A message that did not reach the agent is no longer lost.** When a send failed, a session could not be resumed or started, or an agent asked you to sign in while another session was open, the composer had already been cleared and your message was gone. It now comes back to the box of the session you wrote it for, with its attachments, after anything you typed meanwhile. If that session is not open, the message waits for it, and Zorvo no longer switches sessions to show it.
- **A worktree session's attachments point into its worktree.** A file attached from the folder you started in now names the same file in the session's worktree, so an agent no longer edits your main checkout. A file the worktree does not have, such as an untracked one, keeps its path.
- **A worktree that cannot be made no longer leaves a branch behind.** When Zorvo could not create a session's worktree (a worktrees folder you cannot write to, for example), the new `agent/<title>` branch stayed in your repository and the next try got a numbered name. Zorvo now removes the branch it just made, and never one that was there before.
- **A permission request left over from before a restart no longer offers Allow and Reject.** The chat shows it as "This request was not answered." instead of buttons that fail with the agent's session id. If an agent ends just as you answer, the card is settled the same way and the notice asks you to send a message to continue.

## [0.7.0] - 2026-10-29

### Added

- **See and fix an agent's sign-in in Settings → Agents.** Each agent in use now shows the same **Ready**, **Sign in** or **Not checked** as the sidebar, with a **Check sign-in** button. If the agent needs a sign-in, its methods are listed there: a method Zorvo can run (Claude's subscription login, ChatGPT) has a button that opens the same terminal sign-in as a new session, and Zorvo checks again when it closes; a method that needs a key (an API key, Vertex AI, a gateway) is only explained, since Zorvo never asks for or stores keys. A check that cannot be made says so in plain words. For Gemini CLI and Qwen Code, which cannot say who is signed in, the button warns before it runs that Zorvo opens a session in the open folder to find out, that it may stay in the agent's history and may run your project's hooks, and that Zorvo checks the same way after you sign in, and a successful check of such an agent says it looks ready, not that you are signed in. A sign-in that is running is never cut off by another agent's request. When the Agents tab opens, agents that can report their sign-in (Claude Agent, Codex) are asked in a way that opens no session, so they no longer sit on "Not checked".
- **See the agents Zorvo cannot offer.** Settings → Agents has a collapsed **Not available** section for registry agents Zorvo does not offer, each with the reason, such as "The registry publishes no usable checksum for this download, so Zorvo cannot verify it." Search covers them. They cannot be added: Zorvo still never runs a download it cannot check against a published SHA-256.
- **Connect to GitHub, and see that you are.** **Settings → General → GitHub** now shows whether your GitHub CLI is installed and signed in. If `gh` is missing it says so, with `brew install gh` to copy and a link to cli.github.com; if you are signed out, **Connect** opens a terminal where `gh` signs you in through your browser, and Zorvo checks again when it closes. When you are connected, the sidebar shows your GitHub name (or `@login`) with a GitHub mark instead of your git name. Zorvo asks your `gh` only for your login and name, stores neither, never touches a token, and downloads no picture. The Changes panel now says when pull requests need `gh` or a GitHub sign-in (in a repository with a github.com remote), and opens that section.
- **The composer shows more of what your agent offers.** Permission modes, models and other choices now show the agent's own description under their name, and a mode that lets the agent act without asking (YOLO, bypass, full access) is marked with a shield in the open menu, before you pick it. Other settings an agent offers now get their own chip: Codex's collaboration mode (the way to put Codex in Plan), Claude's fast mode and its agent persona. A long list, like Claude's personas, has a search field.

### Changed

- **Clearer signed-out experience in the chat.** When Zorvo put your refused message back in the box, the sign-in panel now says so, and that it is sent again once you are signed in unless you change it. While **Send** is blocked because the agent must be installed or signed in, the reason stays under the box while you type, instead of sitting in the placeholder where it vanished (the placeholder is the usual one now) and the disabled Send button points to it for screen readers. The panel announces itself when it appears and says each step ("Checking…", "Signed in…", a failure) through one live region; a failure shows its reason only when it is a plain sentence, and otherwise "Zorvo could not finish the sign-in. Try again." The warning before **Check sign-in** is now plain sentences about what Zorvo does after you sign in.
- **Clearer sign-in wording.** A method whose name already starts with a verb is the whole button ("Log in with Google", not "Sign in with Log in with Google"). Backticks around a variable name in an agent's description no longer show. An agent whose only sign-in is an API key now says it needs a key or account setting, not that you need to sign in.
- **Pull requests now see your shell's GitHub settings.** The top bar's pull request status and the Changes panel's list used to run your GitHub CLI with the bare environment a Finder-launched app gets. They now run it with your login shell's environment, like Zorvo's agents and terminals, so they honour your `GH_TOKEN`, `GITHUB_TOKEN`, `GH_CONFIG_DIR` and proxy settings. A few variables that would change what `gh` prints or which repository it reads (`CLICOLOR_FORCE`, `GH_FORCE_TTY`, `GH_REPO`, `GH_DEBUG`, `DEBUG`) are left out.
- **A failed turn says what happened and can be tried again.** When an agent's turn fails, the notice now has a **Try again** button that sends your last message once more (it is disabled while a turn runs, and an agent that has exited is reopened first). A network failure such as `fetch failed` reads "<Agent> could not reach the network. Check your connection or proxy, then try again.", with the agent's own error behind **Details**; other errors show their text as before.
- **Rewind no longer looks like retry.** The control under your message now uses a back-arrow icon, and its tooltip reads **Rewind to here**. It still takes the conversation back to before that message.
- **Claude's default model says which model it is.** The model chip reads **Default (Opus)** instead of **Default (recommended)**.
- **The model chip has a sparkle icon.** The old chip icon looked like a settings gear.

### Fixed

- **Check again sees a key you set in your shell.** Setting an API key in `~/.zshrc` and clicking **Check again** in the sign-in panel (or **Check sign-in** in Settings → Agents) used to keep saying you were signed out, because Zorvo reads your login shell's environment once, at start. Both buttons now read it again first (only that: no registry fetch) and show "Checking…" meanwhile. If reading it fails, the agent is still asked.
- **Agents that publish more than one way to run were missing.** Kilo and siGit Code, which the registry offers both as a download and as an npm package, are in the catalog now. When an entry offers several ways, Zorvo uses the pinned npm package, then the pinned Python package, then the download for your Mac, and only one that passes the same checks as before. One check is looser: a missing checksum on a platform other than your Mac's no longer drops the whole entry, since only your Mac's download is ever used.
- **A new Codex session started in Full access moves to Workspace access**, not to Read-only, which stopped the agent from editing. Zorvo also recognises a risky mode by its name, not only its id. Codex's default Auto review is still left as it is.

## [0.6.1] - 2026-10-27

### Changed

- **Updates are signed on the maintainer's Mac, not in GitHub.** The key that signs Zorvo's updates, its password and the token that publishes releases are no longer GitHub secrets, so the code that builds Zorvo cannot read them. The release workflow only builds the app; a script on the maintainer's Mac checks the build, signs the update and fills the draft release. The app itself is unchanged, and the update key is the same, so installed copies still accept updates.

## [0.6.0] - 2026-10-26

### Added

- **Zorvo updates itself.** A few seconds after start, and about once a day while it stays open, Zorvo checks zorvo-releases for a newer version. When there is one, a notice offers **Update & restart** (or **Later**); Zorvo downloads the update, checks its signature, installs it and reopens. If agents are working or terminals are open, the notice says a restart ends them. Copies older than this version update by hand once.
- **Pick a model for agents that report `models`.** Agents that list their models only through the ACP `models` field, such as Gemini CLI, now get a model chip in the composer, before the first message and in a running session. Your pick is set right after the session opens, before the first prompt, and the next session starts with it. Gemini's default `auto` model can hang without an answer, so you can now choose another model without editing your shell environment.
- **See which agents are ready to use.** Detected agents in the sidebar now read **Ready** (you were seen signed in), **Sign in** (the agent asked for it) or **Not checked**. Click one that is not ready to start a new session with it. A new session shows the sign-in panel before you type, the message box says to sign in first, and **Check again** in the panel re-asks the agent after you set a key or sign in outside Zorvo. After an agent is installed, Zorvo checks its sign-in too.
- **Check what you downloaded.** Each release in [zorvo-releases](https://github.com/zakyirsyaad/zorvo-releases) lists its files' SHA-256 checksums in `SHA256SUMS.txt`, and its notes are this changelog's section for that version. The repository also has a rewritten user guide, bug and idea forms, and a security policy for reporting problems privately.
- **Docs on the landing site.** `/docs` and seven topic pages (install, quickstart, supported agents, signing in, terminal, privacy, troubleshooting) are written from the README, with the 0.5.0 stuck-agent notice in Troubleshooting. The landing page's docs links now point at them instead of a README on GitHub.

### Fixed

- **Gemini CLI without a key showed a red error.** "API key is missing or not configured" is now recognised as a sign-in request, so the sign-in panel opens instead of an error banner. Any `-32000` refusal to open a session or take a prompt from an agent that offers ways to sign in is treated as a sign-in request, since that is the code the protocol uses for it. Methods Zorvo cannot run, such as an API key, Vertex AI or a gateway, are explained instead of getting a button that fails.

## [0.5.1] - 2026-10-25

### Changed

- **The landing page shows Zorvo 0.4.** It now covers installing agents from the ACP registry, signing in and the terminal inside the app, branches, the composer, and the plan in the top bar.
- **Downloads come from zorvo-releases.** Releases and the user guide are published in the public [zorvo-releases](https://github.com/zakyirsyaad/zorvo-releases) repository, and the site's **Download for Mac** button fetches the newest DMG directly.

## [0.5.0] - 2026-10-25

### Added

- **A notice when an agent seems stuck.** Under "Working…", Zorvo says when an agent reports failed requests in a row (with the error Qwen Code logged) or has sent nothing for a minute, with a Stop button. It states only what the agent reported.

### Changed

- **Detected agents folds away.** Click its header in the sidebar to hide or show the list.
- **The plan button matches the others in the top bar.** Its done count ("4/4") is now a small badge on the corner of the icon, like the count on Background tasks.

## [0.4.1] - 2026-10-24

### Fixed

- **The terminal drawer scrolls, and its latest line stays in view.** The shell took its height from its own output, so every fit added a row: it grew past the bottom of the window, the prompt and newest output fell out of sight, and nothing was left in its scrollback to scroll. It now fills the drawer, and the sign-in terminal no longer clips its last row.

## [0.4.0] - 2026-10-24

### Added

- **A terminal for the session's folder.** The **Terminal** button in the top bar opens a drawer under the chat and the side panels with a shell in the folder the session works in (its worktree, when it has one). Each folder keeps its own tabs, so switching sessions and coming back leaves them as they were; **New terminal** adds a tab, and the drawer's edge resizes it. The shell is your login shell, and closing a tab or quitting Zorvo ends the shell and the processes running under it (a job detached from the shell, or left after `exit`, can outlive it). A worktree's terminals end when Zorvo removes that worktree; a worktree it keeps (with uncommitted changes, or still used by another session) keeps them.
- **Image attachments show themselves.** A picture attached from Finder, the file picker or a workspace file is a thumbnail in the composer and above the sent message, and opens larger on a click. Another file keeps its chip, and a picture that cannot be read says "Image not found" instead of showing a broken image. The backend checks the file's type by its first bytes and refuses anything over 10 MB, then lets the window load just that file, so large pictures are never copied into the window's memory.
- **The agent's plan stays in reach.** The session's current plan sits in the top bar, beside Background tasks, with a count of the steps it has done. The conversation keeps one quiet "Updated the plan" line where the steps used to scroll away.
- **Tool calls sit where they happened in a reply.** Each run of tools folds into one line, such as "Ran 2 commands, read 3 files", that opens on a click; a part that changes a file opens on its own so you see the diff. Older saved conversations render as they did.
- **Background tasks lists the work itself, not only the session.** A running shell command or subagent gets its own row with its session and how long it has run, and Open jumps to it. A shell row that matches a running process is shown once, as the process, so Stop still works.

### Fixed

- **A session started right after a reload is no longer stopped.** When it loads, Zorvo ends the agents and shells a previous window left running. It now lists them the moment the window asks and ends exactly those, so a session, terminal or sign-in you start meanwhile keeps running and starts at once.
- **The landing site uses Next.js 16.4.2.** 16.3.8 is affected by advisories GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r.
- **A permission request shows one card, and says when the mode changed after it.** A replayed or duplicated request no longer adds a second card. If you switch modes while a request waits, the card says the agent asked before the switch, so its answer is still expected.
- **A composer menu leaves a long conversation alone.** Folder, agent, permission, model and effort menus keep their open state inside the composer, so opening or closing one does not re-render the message list; a regression test now holds that.
- **A background pull request refresh stays quiet.** If `gh` is slow after the Mac wakes, the top bar keeps the last pull request it read instead of a red notice; the next minute or focus tries again. After three failed reads in a row, such as when you are signed out of `gh`, it stops showing checks it can no longer confirm.
- **A long session scrolls smoothly.** Finished tool rows, diffs and outputs stay out of the page until you open them; earlier turns start collapsed, and a huge diff or output shows its first 400 rows with the rest one click away. Saved conversations without reply parts now get the same compact rows.
- **Saving a conversation no longer fails while its agent runs.** Two saves of one session at once shared a scratch file, so one could move it away from the other and report "Failed to replace … No such file or directory". Each save now has its own scratch file and waits for the one before it.
- **A dev build keeps its own data.** `pnpm tauri dev` now stores sessions in `xyz.zorvo.desktop.dev` beside the installed app's folder, so testing never writes your daily sessions and the two never save over each other.
- **A shell command that replaces its shell shows up in Background tasks.** Qwen Code starts each command in its own process group and a simple command replaces the shell, so the scan saw no shell and listed nothing; it now lists the group leader too.

- **Scrolling up while the agent streams leaves the bottom at once.** A small upward scroll, wheel or key keeps your place, so a streaming reply no longer shakes the view or snaps it back down while you read.
- **A reply shows Copy, Fork and Read aloud once its turn ends.** The reply the agent is still writing no longer offers actions or a timestamp, so you cannot copy or fork half an answer.
- **A session's status dot stays at the right edge.** The dot no longer shifts with the actions beside it, so every row lines up, and the actions replace it when you hover or focus the row.
- **A long session stays responsive while the agent streams.** Streamed output lands once a frame, and only the reply that changed re-renders, so typing and scrolling keep up in a session with a long history.

## [0.3.0] - 2026-10-22

### Added

- **Install agents from Zorvo.** Choose an agent that is not installed and click **Install**. Zorvo downloads it, and Node.js or uv when you need them, and checks every download against its SHA-256 hash. You can write your first message while it installs. Setup no longer needs an installed agent: on a Mac without Node.js, the first new session offers **Install**.
- **An agent catalog in Settings.** The Agents tab lists every ACP registry agent with search and logos, and adds, installs, updates and removes them. Onboarding uses the same list.
- **Agents from the ACP registry.** Zorvo reads the official ACP agent registry and runs its agents as chats. Only the agents in use show up: Claude Code, Codex and Qwen Code by default, plus installed ones. Add any other registry agent from Settings → Agents. Zorvo checks the registry in the background at startup when the last check is over a day old, and when you click **Check again** in Settings.
- **Installed agents show up on their own.** An agent already on your Mac, as a binary on your `PATH` or an npm package installed globally, is enabled automatically, once.
- **New versions are offered after a week.** A version is offered a week after it was published, and never one the registry has withdrawn. Zorvo keeps the version an agent started with, unless the registry withdraws it. **Update** in Settings → Agents moves an agent to its offered version.
- **Agent update notice.** When an agent you use has a new version, the Settings button in the sidebar shows a dot, the Agents tab shows a count, and a notice tells you once per version. **Show** opens the Agents tab.
- **Landing page.** A marketing site for Zorvo in `site/` (Next.js, exported as static HTML): the hero with a picture of the app, the supported agents, features, approvals and diffs, privacy, and the download. It follows the design system, dark by default and light when your system is, with self-hosted fonts and no requests to other sites.
- **Sign in from Zorvo.** Agents that sign in through their own login, such as Claude Agent's Claude subscription or Anthropic Console, now offer it in the sign-in panel. The login runs in a terminal inside Zorvo, and your message is sent once you are signed in. Zorvo never sees or stores your keys.
- **Agents can ask you for input.** An agent can show a form in the chat, or send you to a web page to sign in (ACP elicitation). You answer in the chat or in a popout window, and what you type is never saved.
- **Pick a branch for a new session.** The folder list has a **Branch** row with the repository's local branches and a search. With **Worktree** off, picking one switches your folder to it, as `git switch` would, and Zorvo leaves it alone while a session's agent works anywhere in that checkout. With **Worktree** on, the new worktree starts from the branch you pick and your folder stays as it is.
- **Continue a session where its agent left it.** Zorvo continues a session with the agent's own resume when it offers one, and you can continue a session started outside Zorvo (for example in the agent's CLI) from the new-session screen.

### Changed

- **Claude Code, Codex and Qwen Code now come from the ACP registry.** Their saved sessions carry over. Zorvo's backend reads the registry from `cdn.agentclientprotocol.com` and, when you click **Install**, contacts the hosts an install needs (see the install entry above); the window itself still makes no network requests.
- **Qwen Code no longer needs a global `qwen` install.** It runs with `npx` like Claude Code and Codex, so it needs Node.js 22+; a global install only makes it show up as installed.
- **The repository is now [zakyirsyaad/zorvo](https://github.com/zakyirsyaad/zorvo).** Links to the old `agent-desktop` address still redirect there.

### Removed

- **Oh-My-Pi, Aider and terminal sessions.** Every agent now runs as an ACP chat. Saved terminal sessions are deleted the first time Zorvo opens; the worktree of a deleted terminal session stays on disk under Zorvo's app data `worktrees/` folder.

### Fixed

- **The prompt no longer turns `--flag` into an en dash or straight quotes into curly ones.** Zorvo now registers the WebView's smart dashes, quotes, text replacement and spelling correction as off for the app, and the composer turns off autocorrection and spellcheck.
- **The Settings dialog no longer moves while you use it.** It sits near the top at a fixed height, with the list scrolling inside, so typing in the search or removing an agent no longer slides the close button away.
- **A fork's first message no longer shows a handoff file path.** When an agent has no native fork, the new session's chat says "Pick up from the previous session." The path goes to the agent as hidden context, along with an instruction to reply that it is ready and wait for your next message instead of resuming the old task.
- **An imported session no longer says "Just now" on every message.** A replay from the agent carries no per-message time, so Zorvo shows no time there instead of one it made up.
- **A worktree's starting branch stays with its session.** Once a session starts from the branch you picked, the next draft starts from the folder's own branch again. The new-session card also names the branch the worktree will start from.
- **A sign-in request stays with its agent.** When Claude Code needs a sign-in, the panel no longer shows above a Qwen Code session or draft. It comes back when you return to a Claude Code session.
- **An agent being installed says so.** While an install or update runs, its row says **Installing …** instead of **Not installed**, and a failure shows its reason in the status line.
- **Slash command search finds a name by any segment.** Typing `/brainst` now finds `superpowers:brainstorming`, and a prefix match still comes first.
- **Claude Code and Codex show their options before the first message.** Picking an agent for a new session now asks it what it offers, so its permission mode, model, effort and slash commands show right away, even for an agent that never ran before.
- **Sign in before you write.** An agent that needs a sign-in now says so as soon as you pick it. When Claude Code refuses a message because you are signed out, Zorvo asks you to sign in and puts the message back in the composer, instead of reporting a failed turn.
- **The composer no longer overflows.** With many options showing, the controls wrap onto a second line and the send button stays inside the composer. Turning on **Worktree** swaps the folder icon for a branch icon instead of adding one, so the controls no longer jump to a second line when you flip it.
- **Agents no longer stall while a session opens.** Zorvo now answers every request an agent sends, even before its session is ready, so an agent that asks something during startup is no longer left waiting up to a minute. A permission request an agent sends right after a session opens now reaches you, and one for a session Zorvo does not know is cancelled. Two sessions of the same agent no longer mix up each other's messages when the agent gives both the same id. Forking is refused for an agent that cannot fork.
- **A tool still running when its turn ends settles.** It now shows as failed instead of running forever, since a turn cannot end while a tool is genuinely working.

## [0.2.0] - 2026-10-19

### Changed

- **Agent Desktop is now Zorvo.** New name, icon and bundle identifier (`xyz.zorvo.desktop`). On first launch Zorvo copies your sessions and transcripts from the old `com.agentdesktop.app` data folder and leaves that folder untouched. Delete Agent Desktop from Applications afterwards: both apps share the old sessions' worktrees, so deleting a session in one removes its worktree for the other. macOS ties notification and folder permissions to the bundle identifier, so grant them to Zorvo again.
- **A new look.** Zorvo uses its own design system: Instrument Sans for the interface, Geist Mono for code and the terminal, and one set of colors throughout. Amber now only marks an agent that is waiting on you, hints and timestamps are easier to read, and keyboard focus shows a clear ring. ([#35])
- App logic moved out of `App.tsx` into focused hooks. ([#8], [#12])

### Added

- **Light mode.** Zorvo follows your Mac's appearance, or pin it to Light or Dark in Settings → Appearance. The terminal stays dark either way. ([#36])
- **Diff view.** A `+N −M` chip beside Changes totals the uncommitted lines. Click it to read every changed file's diff with line numbers, against `HEAD` or the branch's base on `main`, with a path filter and Expand all. ([#39], [#40])
- **Background tasks.** A top-bar menu lists what is running: agents mid-turn, terminals, and the shell commands and dev servers your agents started, with their port and how long they have run. Open one, or stop it. ([#39], [#40])
- **Sessions by workspace.** The sidebar groups sessions under their folder, with forks nested under the session they came from. A new session is set up (folder, agent, model, effort) before its first message starts it. ([#5])
- **Worktrees.** A session can run in its own git worktree on an `agent/<title>` branch, so agents working in one repository at once never edit the same files. ([#6])
- **Changes panel.** Review every uncommitted file with its diff, and commit the files you choose. It never pushes or throws changes away. ([#7])
- **Session management.** Rename, pin and archive sessions. ([#9])
- **@-mentions and drag and drop.** Mention a workspace file with `@` in the composer, or drop files onto the window. ([#11])
- **Unread marks.** A session whose agent finished while you were elsewhere is marked. ([#13])
- **Remembered model and effort.** New sessions start with the model and effort you picked last. ([#13])
- **Pull request status.** The top bar shows the pull request for the session's branch and how its checks stand, read with your own `gh`. ([#14])
- **Your pull requests in the Changes panel.** It lists the pull requests you opened in the repository. ([#15])
- **Context details.** Click the context meter to see the tokens used, the tokens left and the session's cost. ([#15])
- **Agent logos.** The session list and Detected Agents show each agent's logo. ([#15])
- **Rewind.** Under each of your messages: its time, Copy, and Rewind, which takes the conversation back to before that message and puts it back in the composer. ([#15])
- **Workspace header.** The session's folder and branch sit above its conversation. ([#15])
- **Check again in Settings.** Detect an agent installed while the app runs, without running setup again. ([#17])

### Fixed

- A rewound session restarts on the model and effort it ran with. ([#16])
- `gh` calls time out instead of piling up on a stalled network. ([#16])
- The pull request menu stays open while an agent streams. ([#16])
- Terminal agents keep drawing in the released app. Oh-My-Pi's screen froze on its first frame because the release build broke how the terminal answers its startup queries. ([#41])
- Your message to a terminal agent is submitted, not left sitting in its prompt. ([#41])
- A new terminal session no longer shows "Failed to resize the terminal". ([#41])

## [0.1.0] - 2026-10-17

### Added

- Qwen Code, Claude Code and Codex over the Agent Client Protocol, in a chat UI with their own modes, models, permission requests, diffs and slash commands. ([#2])
- Oh-My-Pi and Aider in their own terminal. ([#2])
- Collapsible thinking, a working indicator and a context meter. ([#3])
- GFM Markdown, a Content Security Policy, notifications, and a macOS release workflow. ([#4])

### Fixed

- Approval safety, terminal handling, the stream parser and working folders. ([#1])

[Unreleased]: https://github.com/zakyirsyaad/zorvo/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zakyirsyaad/zorvo/releases/tag/v0.1.0
[#1]: https://github.com/zakyirsyaad/zorvo/pull/1
[#2]: https://github.com/zakyirsyaad/zorvo/pull/2
[#3]: https://github.com/zakyirsyaad/zorvo/pull/3
[#4]: https://github.com/zakyirsyaad/zorvo/pull/4
[#5]: https://github.com/zakyirsyaad/zorvo/pull/5
[#6]: https://github.com/zakyirsyaad/zorvo/pull/6
[#7]: https://github.com/zakyirsyaad/zorvo/pull/7
[#8]: https://github.com/zakyirsyaad/zorvo/pull/8
[#9]: https://github.com/zakyirsyaad/zorvo/pull/9
[#11]: https://github.com/zakyirsyaad/zorvo/pull/11
[#12]: https://github.com/zakyirsyaad/zorvo/pull/12
[#13]: https://github.com/zakyirsyaad/zorvo/pull/13
[#14]: https://github.com/zakyirsyaad/zorvo/pull/14
[#15]: https://github.com/zakyirsyaad/zorvo/pull/15
[#16]: https://github.com/zakyirsyaad/zorvo/pull/16
[#17]: https://github.com/zakyirsyaad/zorvo/pull/17
[#35]: https://github.com/zakyirsyaad/zorvo/pull/35
[#36]: https://github.com/zakyirsyaad/zorvo/pull/36
[#39]: https://github.com/zakyirsyaad/zorvo/pull/39
[#40]: https://github.com/zakyirsyaad/zorvo/pull/40
[#41]: https://github.com/zakyirsyaad/zorvo/pull/41
