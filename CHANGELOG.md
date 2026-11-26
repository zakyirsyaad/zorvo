# Changelog

All notable changes to Zorvo. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed

- **The folded session overview is a smaller pill.** It no longer repeats the lines added and removed, which the top bar already shows; it says how many tasks run, or Overview.

## [0.22.0] - 2026-11-26

### Added

- **Agents are told which design systems a folder holds before they design a page, a canvas or a motion.** A design system is a folder with a `design-system.json`; Zorvo looks for one in the session's folder and below it, never above it, names the default, and lists the tokens it could not read.
- **An agent can make a design system for your project, from its code or from brand files you give it, and Zorvo shows it beside the chat.** Its brand book, its colours, type, spacing and shadows in each theme, every component's live preview, and its logos and fonts, in the Artifacts tab, the gallery and a card in the chat.
- **A canvas can use your project's design system, and Theme switches every artboard.** Artboards load the system's tokens, styles and logos from `_ds/`, and pictures and exports follow the theme you pick.
- **You can comment on a design system's tokens, components and brand book.** Comments go to the agent through the message box, as page comments do.
- **A design system made from your code says when that code changed, and Sync again asks the agent to update it.**

### Changed

- **Google Antigravity runs through your own `agy` CLI.** When `agy` 1.5.17 or newer is on your PATH, Zorvo starts Antigravity with `agy acp` instead of its download of the registry's server, so your own subagents and skills from `~/.gemini/config` work in Zorvo too. Sessions you started before still continue. Without `agy`, nothing changes.
- **Agents design pages and canvases with more care.** The guide an agent reads before it shows you a page or a canvas now tells it to follow your project's own design system when there is one, ask its questions once, write placeholders instead of made-up names and numbers, use real buttons, links and labels, and keep text readable in both themes. On a canvas it builds one artboard at a time, so you watch the screens appear.

### Fixed

- **A reloaded window no longer keeps an artifact drawn over the chat.** When Zorvo's window reloaded, the page, canvas or video shown in the Artifacts tab stayed on screen at its old place, over the chat, with nothing that could close it. A reload now closes it, as it already closed the Browser panel's pages.

## [0.21.2] - 2026-11-26

### Fixed

- **The overview card lists every pull request a session opened.** A session whose agent opened two pull requests showed only one, and which one changed with the branch the folder had checked out. The card now lists each pull request the agent made, newest first. Google Antigravity's pull requests are now recognised too: it names its commands in the tool's title, which Zorvo did not read.

## [0.21.1] - 2026-11-26

### Fixed

- **The next-step box survives a restart.** After Zorvo restarted, the box under a session's last turn went inert or disappeared, since every session reads ended then. It now stays usable while the session can be continued, and a press continues the session with that message, as Send would.

## [0.21.0] - 2026-11-26

### Added

- **Agents can make videos.** Ask any agent for a video or motion graphics and it writes a composition (a page that moves, with a `motion.json`), shows it beside the chat with a play head, checks stills with motion blur, and renders MP4s of every format you asked for, with sound only when you ask. Zorvo renders with WebKit and AVFoundation on your Mac: nothing is downloaded, and the preview is the same engine as the video. Export saves one format or all of them.
- **The website shows Zorvo's download numbers.** A Numbers section right after Community shows installer downloads, self-updates and releases since the first one, with a chart of installer downloads by release day, all read from GitHub Releases when the site is built. Zorvo sends no telemetry, and the section says these are the only numbers there are. The quotes section is redrawn with one large quote and a highlighted phrase; it stays hidden until it has real quotes.
- **Tell us how Zorvo works for you.** The website links to a short feedback form on GitHub, from the footer and from the Community section. It asks whether you still use Zorvo and what got in your way.
- **Videos play in Zorvo.** An MP4 or MOV an agent shows (a Remotion render, say) gets a card in the chat and a player in Output, and the Files viewer plays videos in your project.
- **Discard changes to a single file.** Each file in the Changes tab has a two-click Discard (or Delete, for new files) action to undo edits or remove an untracked file without leaving the inspector.
- **Restore files when rewinding a chat.** Zorvo takes a lightweight git snapshot before each turn (leaving your index, stash and gitignored files untouched, and skipping untracked files over 5 MB), so Rewind offers a two-click **Rewind + files?** option that puts back the files the agent reported changing since that message. Nothing else in the repository is touched.

### Fixed

- **Commit and Create PR only after a turn that changed files.** The box under a finished turn offered them whenever the folder had uncommitted work, even after an answer that only read something. Now Zorvo offers them only when that turn edited files or the agent suggests them, and their message asks the agent to commit the changes it made.

### Changed

- **Fewer false "may be stuck" warnings.** An agent that sends nothing is now flagged after three minutes instead of one, since a model thinking at a high effort (Gemini in Antigravity, say) often works quietly for over a minute.

## [0.20.1] - 2026-11-25

### Fixed

- **One scrollbar in the chat again.** Since 0.20.0 the area around the chat could scroll too, past the message box and into empty space, beside the chat's own scrollbar.

## [0.20.0] - 2026-11-25

### Added

- **A button to jump back to the newest message.** Scroll up to read an earlier part of a chat and a round arrow appears above the composer; press it to return to the latest output, which the chat then follows again.

### Changed

- **The session overview is a panel beside the chat.** It runs the full height of the window behind a thin divider and is narrower, so the chat sits in the middle of its own space. On a narrow window it still opens as a card over the chat.
- **The Zorvo logo over a new session is larger**, and so is the line under it. The logo and the card now sit together in the middle of the window.
- **The Browser tab can take the whole window.** Expand, beside the browser tools, gives the page the room the chat had; Shrink or Escape brings the chat back, and the page keeps what it holds. Dragged by its edge, the Browser tab now widens as far as the window allows instead of stopping at 720px, and remembers its own width.

### Fixed

- **The chat keeps following an agent's reply.** It no longer stops following when part of the chat shrinks, such as a notice going away, and it now follows what grows without a new message, such as the next-step box or a picture that loads late.
- **Choose File works in the Browser tab.** A page's file button now opens the file picker; before, clicking it did nothing.
- **An agent can upload a file to a page you are signed in to.** After you approve the files and the site on a one-time card, the agent fills the page's file field in the Browser tab itself, where before it could only use a separate Chromium window without your sign-in. The files must be in the session's folder.

## [0.19.0] - 2026-11-25

### Added

- **A next-step box at the end of a turn.** Under an agent's last reply, Zorvo shows what changed in the repository, and the agent's short recap and question. Its buttons send your answer as a message, so Commit, Create PR or Merge is one click.

## [0.18.0] - 2026-11-25

### Changed

- **Agent updates come as soon as the registry lists them.** A new version of an agent no longer waits a week before Zorvo offers it.
- **The dark theme's panels are darker, closer to the sidebar.** The chat, the inspector, your messages, the composer and the cards on them sit nearer the window's black.
- **While an agent works, the chat shows Zorvo's logo at work.** Its two chevrons light in turn and its cursor blinks, in place of the green dot. With Reduce motion on, the logo stands still.
- **A new session shows Zorvo's logo** and the line "Every coding agent. One desktop." above the card where you write the first message.
- **Signing in to an agent takes fewer steps.** The sign-in card leads with one button, and other ways to sign in fold under it. A way that needs an API key shows the line to add to your shell, with Copy. A failed sign-in says what to try next.
- **Sign in from the Agents menu without leaving your session.** Sign in and Check now work inside the agent's row in the sidebar menu, where before they opened a new session.
- **The sign-in terminal asks when you are done.** While an agent's sign-in or setup runs, press I've signed in (or I'm done) to have Zorvo check. Cancel now stops it without checking.
- **One set of words for sign-in everywhere:** Ready, Needs sign-in, Not checked yet. In Settings, an agent never checked has Check sign-in as its button, with one line saying what checking does.

### Fixed

- **A key you add to your shell is seen when you come back to Zorvo.** The automatic check on returning to the window now reads your shell again first, so you no longer have to press Check again.

- **Slash commands work as a session's first message.** A command such as `/logout` or `/compact` now reaches the agent exactly as you typed it. Before, Zorvo put a hidden note in front of it, so the agent could read it as ordinary text.

## [0.17.0] - 2026-11-22

### Added

- **Qwen Code's background agents show in the overview card.** While Qwen Code runs agents of its own in the background, the card lists each one with what it last did. An agent that has done nothing for five minutes is marked quiet, and the chat says so.
- **Sign in again from Settings.** An agent that reads Ready has Sign in again in its menu, to switch account or run its setup again.
- **A link to a file in a reply can be opened.** A file in the session's folder opens in the Files tab. Any other file is shown in Finder.
- **Send while an agent works.** A message you send during a turn waits above the composer and goes out when the turn ends. Send now stops the turn first. When you press Stop yourself, the messages keep waiting until you send one.

### Changed

- An agent now starts workers by itself when you ask it to split work or run parts in parallel, where before it could run them as background tasks of its own that Zorvo cannot show.
- **Output is called Artifacts again.** The tab, the sidebar entry, the gallery and the section of the overview card say Artifacts. They still list the pages an agent showed and the files it made.
- **A link in a reply opens in Zorvo's browser.** A click shows the page in the Browser tab beside the chat. Right-click a link to open it in your own browser. Mail links, and links in a session's own window, still open outside.
- **Settings, Agents: the switches come first.** "Working together" and "Computer use" are above the list of agents, where the long list no longer hides them.
- **A running command is named by its program.** In the overview card a command reads `node server.js --port 1420`, not the start of a long path, and its second line says the ports it listens on, not the session's name. Hover it for the whole command.

### Fixed

- **Codex no longer shows two running tasks that are its own.** The overview card listed Zorvo's tool bridge and Codex's helper process as shell commands the agent had started.
- The inspector's tab strip no longer draws a scrollbar over the tab names when the tabs do not fit.

## [0.16.0] - 2026-11-22

### Added

- **An agent can show a diagram or a mockup inside its reply.** The picture sits between the paragraphs of the answer and follows the light and dark theme. Nothing in it runs and it has no links. From its menu you can copy it as an image or save it as SVG, HTML or PNG, and Expand shows it larger.

## [0.15.0] - 2026-11-21

### Added

- **Agents can look at apps on your Mac, when you let them.** Turn it on in Settings, under Agents. An agent then asks before it uses an app, on a card that shows each app as it is on this Mac (its name, where it is and who signed it), and you tick the ones it may use in that session. For now an agent can only look: read a window's contents and take a picture of it. Zorvo itself, your passwords and System Settings are never offered; browsers are view only, terminals and code editors click only. A line under the chat and a mark in the sidebar show which sessions may use apps, a small bar stays on top of your screen while an agent is looking, and **Stop computer use** ends it at once. What an agent sees goes to its model provider.
- A worker can record whether its task succeeded or failed.
- Workers report back in one message, including one that stopped, failed or whose agent exited, and after Zorvo restarts.
- An agent can start several workers, of one agent or several, in your folder or each in a worktree of its own, and give an idle worker a further task.
- A worker's agent ends two minutes after its turn. The session stays, and a new task reopens it.
- **A browser beside the chat.** Open links or addresses in the Browser inspector tab, with session-isolated WebKit pages, navigation, console, snapshots and agent interactions. Browser tools ask for a session grant; sending files asks separately. Chromium debug opens an isolated installed Chrome or Brave window for full network, file, trace, CPU, heap and optional Lighthouse tools.
- **Design canvas.** An agent can show several screens side by side: a flow, variants of one screen or a whole redesign, as artboards in labelled sections beside the chat. Pan with two fingers or by dragging, pinch to zoom, and jump to a section or fit the view from the header; select an artboard to focus on it and step to the previous or next one. Comment on text or an element inside an artboard, or on the whole artboard, and add the comments to your next message. **Pick** keeps one variant of a screen, and **Build this** and **Build section** ask the agent to build the screens in your repository; each puts a message in the box for you to edit and send. **Export** saves one artboard as PNG or PDF, every artboard as PNG files, or the whole canvas as one PDF; a PNG is drawn at 2×. The canvas is a folder in your project, `canvas.json` and one HTML file per artboard, so git keeps its history and any session can open it again; deleting a session keeps the files. Artboards out of view show as pictures, kept on this Mac.

### Changed

- **The website shows what Zorvo does now.** A new Output section shows a page beside the chat with a comment on it, a new Canvas section shows artboards side by side with one picked and commented, and a new docs page, Pages and canvases, explains both. The Delegate section shows an agent starting two workers and their report coming back in one message. The picture of the window has the session overview card and a pull request in the sidebar, the feature list names the browser, the overview, the context panel, pull requests and subagent tabs, and Control says an agent can look at apps on your Mac only after you tick them. The site no longer says the build is not signed. The privacy docs say what a page, the Browser tab and computer use can reach.
- **The website's header and first screen.** The section links are under a Product menu that opens under the pointer, with Docs beside it, and Discord, X and GitHub are icons that open in a new tab; on a phone the header has a menu button. The agents strip moves slowly through eighteen agents and stops under the pointer. The Download button shows how often the Mac app was downloaded, read from GitHub Releases when the site is built. The page says "coding agents" where it said "ACP registry". A new Community section, right under the agents strip, shows Zorvo's launch post from X as a card with its video, and links Discord, X and GitHub; the card leads to Zorvo's profile on X. A Questions section before the last Download answers what people ask first: the price, API keys, which agent to start with, what to install, Windows and Linux, and where your code goes. The page scrolls smoothly, and the footer is uncovered as the page above it scrolls away. With Reduce motion on, none of this moves.
- **The website counts visits and measures its speed.** It uses Vercel Web Analytics and Speed Insights, which set no cookies. The privacy page says what they receive. The app still sends no telemetry.
- **The website is easier for search engines to read.** Every docs page has a title that says what it is for and a description of full length, the questions on the home page are in its structured data, the sitemap says when each page last changed, and links shared on X name Zorvo's account. Logos further down the page load when they come near, and the video and the agent icons are kept by the browser between visits.
- **A compact browser toolbar.** Navigation, the address and element selection share one row, with page tabs above it. Browser choices and debugging tools have their own menu.
- **Site information in the browser.** See the connection, cookie count and agent access for the current page, and clear its cookies and origin storage. A menu keeps a still image of the page behind it instead of showing an empty panel.

### Fixed

- A new session keeps the name from your first message. With Claude Agent it could be named after a note Zorvo sends the agent, which you never wrote.
- **Browser tools on sites with a strict content policy.** Native JavaScript expressions and console reads use WebKit's page-world compiler, so a site's ban on `eval` does not block the tools. The site's policy remains unchanged.
- **Navigation past a page dialog.** Navigating, reloading or going back/forward dismisses a pending page dialog before WebKit starts the new document, so the dialog cannot keep the navigation waiting.
- **Closing browser pages releases their process state.** Closed views cancel pending operations and ask WebKit to end and reset the page process, including a page running a script that never yields.
- **Browser tabs and page controls.** A tab strip, blank new tabs and the page menu now follow the compact browser layout, with native page zoom, copying/opening links and a clearable list of recent pages. Diagnostic tools have their own menu.
- **Responsive pages in the browser.** WebKit now includes its Safari compatibility token and Zorvo identity, so sites such as Google serve a layout that follows the panel width.
- **Clearer browser commands for agents.** Browser tools now describe URLs, tab IDs and scroll distances directly, so agents can open and scroll a page without guessing the arguments.
- **OpenCode retry errors in the chat.** Failed model requests now show the agent's retry status and error instead of leaving only a working indicator.

## [0.14.1] - 2026-11-21

### Changed

- **Zorvo is signed with a Developer ID and notarized by Apple.** macOS opens a downloaded copy without warning that it comes from an unidentified developer. Since the signature differs from earlier versions, macOS may ask once more for access to your folders, and Private mode may ask once to use its items in your Keychain; choose Always Allow.

### Fixed

- **A session shows the pull request its agent opened.** When an agent makes its own worktree in your folder (`git worktree add -b …`) and opens a pull request from it, the session's row in the sidebar and its overview card now show that pull request and its checks. Zorvo reads the branch and the address from the agent's own shell commands and keeps them with the session, so they stay after a restart; a session you have not opened since this update shows them once you open it.

## [0.14.0] - 2026-11-20

### Changed

- **One card to start a session.** The new-session screen is a single card in the middle of the window: the agents as chips at its top, each picked agent with its model beside it, then the task, and the folder, branch and Private · TEE at its bottom with Start. The screen's own title is gone (the top bar says New session), and the sessions you can continue are plain rows. Turning Private · TEE on now picks Qwen Code for you, and the other agents wait until you turn it off.
- **Calmer agent rows in Settings.** Each agent's row has one button and a ⋯ menu for the rest, Check sign-in included. Its sign-in reads as a dot and a word (Ready, Needs sign-in, Not checked) instead of a pill, an offered update shows on the version line ("0.93.0 · update 0.94.1 ready") with an **Update** button, and while an agent needs a sign-in its methods are plain rows under its name. A key you set in your shell has **Check again** on its own row.
- **A context panel.** A click on the context meter under the message box opens a Context tab beside the chat: how full the window is, what is left, the session's cost, and how the context grew turn by turn. Qwen Code reports what fills its window (the system prompt, tools, instruction files, memory, skills and messages), and each part opens to list what is in it. For other agents Zorvo estimates the chat and the instruction files and shows the rest as one row, each value marked with ~. From 85% the panel warns that the agent may summarize older messages on its own, and **Compact context** sends the agent's own `/compact` or `/compress` when it has one.
- **A calmer chat.** A reply no longer lights up under the pointer, and the chat is wider (720px) with more room between messages and lines. Your messages sit in a soft fill without an edge, a permission request is a plain card with a thin amber edge and its files listed without a box, and the message box lost its shadow; its chips fill only when you point at them.
- **A session overview beside the chat.** A card at the top right of the chat says where the session works (its changes, its folder, its branch), what is running (subagents and commands, with the finished ones folded away and a failed one kept in sight), the files you attached, the pages and files the agent made, and its pull request. A click opens the matching tab. Fold it to a pill that says what runs and what changed; on a narrow window it shows as that pill. The background-task chip, the branch and the pull request chip left the top bar, and the task rows left the chat: a subagent is a plain row in the reply again.
- **Artifacts is now Output, and always there.** The tab, the sidebar entry and the gallery are called Output. The tab shows for every session, and until the agent makes something it says what will show there. Under the pages, it lists the files the agent created in the session; a click opens one in the file viewer.
- **Pull requests in the sidebar.** A session whose branch has a pull request shows its number and state in place of the time: green while open, red when a check fails, purple once merged, grey as a draft or closed. Resting the pointer on the row shows its title and how its checks stand. Zorvo reads them with your own `gh`, one call per folder, and only when you are signed in and the folder is on GitHub.
- **Shorter, clearer session names.** A name made from your first message turns a GitHub link into `owner/repo`, any other link into its site and a long file path into its last two parts, and is cut near 60 characters instead of 48. A first message that is only a command, like `/init`, names the session after its agent and folder until the agent sends a title. Resting the pointer on a shortened name shows the whole line. Names you gave stay as they are.
- **Smooth motion.** Menus and popovers open with a short fade from their button, the inspector fades in, and a new message or permission request fades in once. Hover and colour changes take 120ms everywhere. With Reduce motion on in macOS, nothing moves.

### Fixed

- **OpenCode's connection is no longer listed as a background task.** Its internal stdio server and Zorvo's MCP bridge are part of the session connection. Commands the agent starts under them still appear as tasks.
- **A link no longer opens inside Zorvo.** A right-click on a link showed the Mac's menu, whose Open Link loaded the page in Zorvo's own window with no way back. A right-click on a link now shows **Open in browser** and **Copy link**, and any page that still tries to load in Zorvo's window opens in your browser instead.
- **An agent that does not stop can be ended.** Stop asks the agent to end its turn, and one waiting on a stuck tool never did. Ten seconds after Stop, the chat now offers **End agent**, which ends the agent's process, and with it any session forked from this one, since a fork shares it; you can continue them afterwards. A permission request that Stop answered no longer stays open in the chat.
- **Ending an agent ends what it started.** Stopping or deleting a session ended only the program Zorvo started, so an agent that runs its real process under it (Qwen Code does) could keep running, with what it had started, until you killed it yourself.
- **A tool that runs for long is pointed out.** The chat said nothing while a tool ran, however long. After five minutes without news, it now names the tool and offers Stop.

## [0.13.1] - 2026-11-19

### Changed

- **Agents can show a page without being asked.** When an answer is better seen than read, such as a report, a comparison, a chart or a diagram, the agent is now told it can show it as a page beside the chat. Whether it does is still the agent's choice: Qwen Code now shows a diagram as a page on its own.

## [0.13.0] - 2026-11-19

### Added

- **Artifacts.** An agent can show you a web page it made (a report, a diagram, a dashboard, a mockup) beside the chat, in the new **Artifacts** tab. Each time the agent changes the page you get a new version and can go back to an older one. **Export** saves the page as one HTML file, and **Artifacts** in the sidebar lists the pages of every session. A page runs in a window part of its own with no access to Zorvo or your files; it may load scripts from cdnjs, jsDelivr, unpkg, the Tailwind CDN and code.jquery.com and fonts from Google Fonts, and can send nothing anywhere. Pages stay on this Mac and are deleted with their session. Agents that get Zorvo's tools get this too; the switch in **Settings → Agents** turns it off.
- **Comments on artifact pages.** Press **Comment** above a page, then select text or click a part of it, and write what should change. Comments are numbered on the page and listed under it; **Add to message** puts them in your message to the agent, with the file and version they are about, the same way diff comments go. A comment written on an older version says so. Your comment text never reaches the page.
- **Background task tabs.** A subagent or a shell command an agent started opens as a tab beside the chat, and the chat shows one row per subagent instead of every step. With Claude Code and Qwen Code you can follow a subagent's steps as they arrive.

### Changed

- **A private session no longer delegates.** Delegating starts another agent on a handoff of the conversation, which would send a private session's code outside the TEE without asking. The ⋯ menu and an `@Agent` mention now say so; **Continue with another agent** still asks first.
- **The private badge says what was checked.** "Verified in TEE" is kept for an answer the model's own TEE signed; one signed by NEAR AI's gateway reads "Signed by NEAR AI". The popover says that NEAR AI's attestation report lists the signer and that Zorvo does not check the hardware quote behind it.
- **The website explains credits and leaves private mode for last.** A new docs page, Credits terms, says who sells private mode credits, what they cost, and what happens to a payment and a balance. Private mode is now one section, after everything Zorvo does for free, with the path of a private answer folded into it. The first Download says the build is not signed yet and links to how to open it, the header names Private mode apart from Privacy, the footer's Privacy opens its docs page, and the Control section no longer says you approve every step. On the page, the delegate scene ends with the report alone, and status dots and the terminal cursor stop moving after a few seconds.
- **The privacy docs name private mode's hosts.** Privacy and your data now lists private mode's two hosts and when each is contacted (the Zorvo Credits server from the first time you open Settings, Private mode, and at each start after that; NEAR AI Cloud during private sessions), what your browser opens instead of Zorvo (PingPay's checkout and NEAR AI's Verification Center), and which secrets private mode keeps in your Keychain.
- **Agents that come as npm packages are downloaded when you install or update them.** Zorvo now installs the package into its own folder and starts the agent from there, instead of letting `npx` fetch it when the first session starts. Starting a session no longer waits on a download or asks the npm registry anything, and two sessions starting at once can no longer leave a broken download behind. After this update Zorvo installs the agents you have used once, in the background; until an agent's row stops saying Installing, it cannot start a session. An agent you never used is not downloaded: its row offers Install. Zorvo also no longer puts an npm-package agent in use just because its package is installed globally.
- **Qwen Code's questions read one at a time.** The card is a calm form with the agent's logo instead of a warning, shows one question per step with a step for each, and has Back and Next. Submit names the questions still unanswered, each option is a row you can click anywhere on, the agent's "(Recommended)" pick shows as a badge, and Other opens its text box only once you pick it.

### Fixed

- **A private session keeps its spending cap after a restart.** The cap was dropped whenever Zorvo saved its state, so a reopened session lost its limit, its Raise button and the key NEAR AI enforces the cap on.
- **A window reload no longer ends or resets a capped session.** The cap, and what was spent of it, carry over to the reopened session.
- **Running out of credits mid-turn keeps your message in the chat.** A message Qwen Code already worked on stays above what it did and is not put back in the box, where sending it again repeated the prompt.
- **Your own NEAR AI key running out is no longer hidden by a Zorvo balance.** The card for the own key stays until the key changes or you come back to the window.
- **Private sessions on your own key start while the credits server is down**, from the model list saved on this Mac.
- **Private usage is counted once.** A window reload no longer doubles a session's total, a fork no longer repeats its source's usage, and a call that cannot be priced marks the total as an estimate instead of leaving it out.
- **A signature check no longer sticks or fails for the wrong reason.** A reply saved while "Checking the signature" settles as not signed, an answer signed with a key NEAR AI rotated is checked against a fresh report, and "Not signed" no longer blames Stop when the signature could not be read.
- **A stream NEAR AI cuts off reaches Qwen Code as a failure**, not as a short answer that looks complete.
- **An agent's top-up request no longer blocks the session for good.** One nobody answered expires after ten minutes, and an ask for a package Zorvo does not sell lists the ones it does.
- **Removing your own NEAR AI key removes it from stopped sessions too**, and forgetting this Mac's credits also deletes the keys of its capped sessions while your own key keeps its date.
- **Errors raising a cap or starting a private session say what failed**, not that a checkout could not open.
- **The secret check no longer holds up other sessions.** A message nothing scans goes out at once, and a draft cannot be sent twice while its first message is checked.
- **Private model names show on older macOS**: a pattern Safari 13 cannot read is gone.
- **The credits server limits top-ups per address** and shares each round of payment checks between open and expired checkouts, so unpaid checkouts cannot hold the stock, and neither kind can delay a real payment on the other.

## [0.12.0] - 2026-11-14

### Added

- **Private mode, opt in.** Qwen Code can run on NEAR AI models inside secure hardware (TEE), paid with prepaid credits you top up in Settings → Private mode. Turn it on with the Private chip of a Qwen Code draft; until you do, nothing changes.
- **Verified private answers.** Each private reply now carries a badge saying whether NEAR AI signed every model call behind it, with the signer and a link to NEAR AI's Verification Center.
- **Low-credit warning.** Below 50 credits, a private session shows the balance left and, when it can price the model, about how many turns remain, with a Top up button; the inspector marks a low balance with an amber dot, and Zorvo notifies once if you are away.
- **Private sessions can check their credits.** Qwen Code can read the balance and model prices through a small local server, so it can tell you when credits are low and suggest a cheaper model. The server talks only to Zorvo's loopback proxy and never sees the NEAR AI key.
- **A secret check before private messages.** Before a private message goes out, Zorvo looks for keys and passwords in the text and its attached files on this Mac. It pauses on a match so you can send anyway or edit; Settings → Private mode turns the check off, and no match is stored.
- **Per-session private usage.** The Private tab shows what this session used and its average per turn, and Settings' balance lists the total by model with the turns each model's price leaves. The total survives a restart.
- **Use your own NEAR AI key.** If you stake NEAR in your own NEAR AI organization, Settings → Private mode can check and save your key in the Keychain and use it instead of Zorvo credits. Zorvo shows the session cost in dollars and no Zorvo balance; your credits stay and you can switch back.
- **A spending cap for each private session.** A Qwen Code private draft can cap itself at 100, 200 or 500 credits. NEAR AI enforces the cap on a key of its own, so it stops the session even if Zorvo is closed; the composer and inspector show the cap and its progress, and a capped session offers New session or a doubled cap when it reaches it.
- **An agent can ask for a top-up.** A private Qwen Code session can ask for one of the Worker's packages with one short reason; a card above the composer shows the package and the reason, and only the user's click starts their own PingPay checkout. **Not now** starts a five-minute cooldown. The agent never opens checkout, pays or sees a key.

### Changed

- **Private mode keeps its limits and its keys.** A capped session keeps its cap across Stop and reopen; caps are checked against live spend, and a swept session restarts on the draft's original cap. A revoked session key is replaced on the next launch, a failed raise can be retried without a stuck cap, and Switch to Zorvo credits starts a fresh credits session. A running session follows the key it launched with, removing the own key stops its tokens, and a refused or removed key gets its own card. Usage no longer drops after a reopen, and the secret check keeps its review comments, names attachments it could not read, and queues a second message instead of replacing the first.

## [0.11.2] - 2026-11-14

### Fixed

- A menu no longer opens past the edge of the dialog it is in: the model menu in **Delegate to another agent** was cut off on its left. A menu now opens from the other edge of its chip when the asked-for one would not fit.
- The switch for **Let agents delegate and open sessions** in Settings → Agents draws its knob inside the track again; it sat half a track too far right, outside the switch when on.

## [0.11.1] - 2026-11-14

Tagged but never published; its fix shipped in 0.11.2.

## [0.11.0] - 2026-11-14

### Added

- **Agents can hand work to each other.** Ask an agent in plain words ("then have Qwen Code review it") and it can give another agent the task itself. The first time in a session Zorvo shows a card with who asks, which agent the task is for, the folder and the task; **Allow for this session** lets that session's agent give further tasks without asking again. The other agent's answer comes back as a report. Works with agents that take tools from Zorvo (Qwen Code, Codex, Antigravity, Claude Code) and with Pi, which runs a Zorvo command instead. Turn it off in **Settings → Agents**.
- **Agents can open a new session.** Ask an agent to start something in a new session and it can open one itself, with a brief it writes: in the same folder, in a worktree of its own, or in another folder Zorvo knows. The new session works on its own, shows who opened it, and appears in the sidebar without taking you away from the one you are in. Opening one in the same folder is covered by **Allow for this session**; another folder asks every time, with **Allow once**. At most three sessions an agent opened can be working at once.
- **Agents can look after the sessions they started.** An agent can read the last answer of a session it opened or delegated to, and stop one that is still working, so you can ask "check what Codex found" or "stop that session" in plain words. It reaches only its own sessions, and reads only the other agent's answer, never what you wrote there.
- A session can now have one delegate per agent, for example Qwen Code and Codex at once, and a further task for an agent goes to the session it already has, also when you write `@Agent` yourself.
- **Paste an image into the message.** A screenshot or an image copied in another app attaches when you paste it into the prompt, like a file from the paperclip. Text still pastes as text, also when the copy carries a picture of that text, as web pages and spreadsheets do. Pasted images are kept in Zorvo's data folder for 30 days.
- The Files tab shows images (PNG, JPEG, GIF, WebP) and PDFs instead of saying the file is binary. A file over 10 MB says it is too large to preview.

### Changed

- While a delegated agent works you can keep writing to the session that delegated; its report waits until that session's turn ends instead of landing in the composer.
- The window has a layered look: the chat and the inspector are raised panels on the window's background.
- Sidebar rows show each agent's logo with a status badge, and a filter shows only the sessions that need you or are working.
- The chat is calmer: tool calls are a one-line summary that opens into steps on a rail, a failed turn and a stalled agent get a titled notice, and a permission request says "Waiting for you" while it is open.
- The composer's controls are filled chips, the context meter is a ring, and a model search marks the match that Return picks.
- In the diff review, the bar that adds your comments to the message floats over the diff, and the Changes tab's file cards, the Activity filters and the Files tab take the same layered look.
- A new session shows your agents as tiles: tick two or more to compare them, and find the rest under All agents. The folder and branch sit beside the "New session" heading.
- A compare run shows its agents side by side, each with the files it changed and its last message, and you can answer a plain permission request right in its column.
- Settings and the welcome screen take the layered look: the theme is a System, Light and Dark control, each agent's sign-in shows as a chip with a dot, and the welcome screen is one panel with each agent's tick at the right.
- Delegating reads more clearly: a delegate that failed or waits for your answer shows as a titled card with Open, and the line that says where a session was delegated from has its own icon.
- The top bar shows the folder before the session's title.

### Fixed

- A notice with a long path in it, such as an agent that failed to start, wraps inside its card instead of running past its edge.
- A file's name stays in sight in two more places where a long path was cut at its end: the header of a diff under a tool call, and an edit request in a compare run's column.
- When an agent takes long to say which models it offers, the composer says it is still loading instead of showing only placeholder chips.
- The Activity tab keeps a file's name in sight when its path is long, by cutting the path at its start.
- A compare run's "Last message" reads without markdown marks such as code ticks and bold asterisks.
- **macOS should stop asking again and again for access to your folders.** The release was signed only on its executable, so macOS could not match a permission you had given to the app on disk and asked again. The whole app is now signed under its own name, `xyz.zorvo.desktop`, so within one version macOS should no longer ask twice. It asks once more after each update, until Zorvo has an Apple Developer ID. The prompts now say why: an agent you run in Zorvo reads or changes files there.

## [0.10.1] - 2026-11-12

### Fixed

- **Pi shows one Thinking chip after a model switch too.** 0.10.0 hid Pi's second Thinking chip only while its two lists of levels matched. After a model switch Pi's adapter keeps the old model's list on one of them, so both chips came back, with different values. Zorvo now recognizes Pi's modes by their names, whatever levels each list holds.

## [0.10.0] - 2026-11-11

### Added

- Delegate a task from a session to another agent: it works in the same folder and its answers are sent back to the session.

### Changed

- **The website has the new landing page.** Sessions, Compare, Delegate, Private mode on NEAR AI Cloud, Review, Control and the long-session numbers each have their own section, with motion that plays once and is off for visitors who ask for reduced motion. The site now ships one small script for it, and the docs have a new page on delegating a task.

### Fixed

- **Qwen Code's Workflow mode no longer fails with an error when you pick On.** Qwen Code offers Workflow mode in every session, but turns it on only when workflows are on in its own settings, and otherwise refuses with "Internal error (Workflow mode is unavailable in this session)". Zorvo now reads what Qwen Code reports and shows On as unavailable, with the reason: turn on workflows in Qwen Code's settings first.
- **Qwen Code sees a file you attach from outside the session's folder.** Qwen Code reads an attached file only when it lies inside the session's folder, and dropped any other without a word, so a document from Downloads never reached it and it answered that nothing was attached. Zorvo now also names the path of each such file in the message, so the agent knows it is there and can read it.
- **Pi shows one Thinking chip, not two.** Pi's adapter reports its thinking levels twice, as modes and as an effort setting, so the composer showed two Thinking chips that could disagree on an ended session. Zorvo now shows the effort chip alone when an agent's modes only repeat its thinking levels.

## [0.9.2] - 2026-11-09

### Fixed

- **Saving a long session no longer freezes the window.** An agent sends the whole file before and after every edit, and Zorvo kept both in the session's history, though the chat only shows the changed lines and three lines around them. A long session's history grew to tens of megabytes, and the window paused for a moment each time it was saved. Zorvo now keeps only the lines the chat shows (a 43 MB history becomes 9 MB), and shrinks an older session's history the next time it saves it. The diffs look the same.
- **A long session no longer makes the window lag while its agent works.** Each update from the agent drew every tool call of the turn again, with all their open diffs: in a turn with hundreds of edits that was tens of thousands of elements, up to a second each time, so scrolling, typing and clicks stuttered. Now only the tool that changed is drawn again.
- **The full diff review stays inside the window.** One long line in a diff made the expanded review wider than the window, so its right edge was cut off, with the comments' Edit and Delete and the **Add N comments to message** button. The review now fits the window.

## [0.9.1] - 2026-11-08

### Changed

- **The site is easier to find and lighter to load.** The home page's title and description name the app and the agents it runs (Claude Code, Codex, Qwen Code), the docs pages carry a breadcrumb and article data for search engines, the landing page links its Compare and Review sections to their docs, and a missing page shows a proper 404 that is never indexed. Pages ship no JavaScript: the site has none of its own, so the build drops React's runtime, and the headline font is preloaded with a matched fallback so the page does not shift as it loads.
- **The landing page shows Zorvo 0.9.** The hero picture is the new window: the two-line sidebar with a compare run, the top bar's chips, the chat and composer, and the inspector on its Changes tab. New sections show a compare run, from ticking agents to Pick, and the diff review with a comment on its line. The features, the agents' Settings rows, the plan and the permission card follow the app as it looks now.
- **The landing page links to the source.** GitHub sits in the header, and the footer's Project column lists the source, releases, changelog, issues and the Apache 2.0 license.
- **The docs describe Zorvo 0.9.** New pages explain compare runs and reviewing changes (comments on lines, Reply, the file view, Activity). The quickstart starts from the welcome screen and walks the sidebar, top bar and inspector; Terminal lives in the inspector; signing in covers the Agents menu, Set up Qwen Code and agents whose key lives in a variable; and the update card and failed-turn row are drawn as they look now.

### Fixed

- **A new session's effort list follows the model you pick.** An agent reports the efforts of the model it is on, so picking another model in a new session kept the old model's list: Qwen Code with DeepSeek V4.1 Flash offered only "Thinking on" instead of Low, High and Max. Zorvo now remembers each model's list once the agent has reported it and shows the picked model's own; for a model it has not seen yet, the effort chip waits until the session starts. The effort you picked last is kept for the model that offers it.

## [0.9.0] - 2026-11-07

### Changed

- **First run is one welcome screen.** Tick the agents you'll use (one that is not installed offers Install; ticking downloads nothing), pick a project folder (the folders it finds are offered), and press Start, which opens a new session there. Signing in waits for the first session, as before.
- **Settings is a full page.** It opens in place of the sidebar and the chat, with a left navigation (General, Appearance, Agents, GitHub, and MCP servers marked Soon) and **Back to sessions**, which returns to the session you left with your draft as it was. Appearance shows System, Light and Dark as preview tiles, GitHub has its own section, and About shows when Zorvo last checked for an update, with **Check now**. Agents are one row each, with a sign-in chip, and an agent's sign-in opens inside its row.
- **Check again in Settings → Agents matches its design.** The button beside the agent search keeps its 32px height, with the 12px regular text of the other outline buttons instead of 13px medium.
- **Buttons match the design's type.** A 28px button's label is 12px instead of 13px, and outline and ghost buttons are in regular weight (primary and danger stay medium, and so does the sidebar's New session), so rows of buttons look lighter and tidier.
- **The app uses the Mac's system font (SF Pro) for its interface.** Code, commands and paths stay in Geist Mono.
- **A tidier sidebar.** Each session is two lines: its title, then its agent and what it is doing in words ("Working", "Waiting for you", "Finished, unread", or how long ago it started). Stop and a ⋯ menu with Rename, Pin, Archive and Delete show when you point at a row or tab to it. A folded folder says what its sessions are doing ("1 waiting"), a compare run shows its agents and how far they are, and **Hide sidebar** makes room for the chat (**Show sidebar** brings it back). Your agents and their sign-in state moved into the **Agents** button next to Settings.
- **One inspector instead of four panels and a drawer.** The top bar's **Inspector** button opens a panel on the right with tabs for Changes, Activity, Files and Terminal; the terminal moved there from the bottom of the window, and its shells keep running when you switch tabs or close the inspector. Drag its left edge (or use the arrow keys) to make it wider or narrower, and Zorvo remembers the width. In a narrow window the sidebar steps aside while it is open.
- **The chat matches its design.** The conversation sits in a 680px column without the folder card above it; tool runs, permission and question cards, the working, failed and stalled states and message actions look as designed, and a permission to edit lists the files with their changed lines. Right-click shows the Mac's menu only for text, and on a session it opens that session's actions.
- **The composer and the new-session draft match their design.** Chips are quieter and the agent comes first, menus put the check on the left, the agent menu shows each agent's status, and the session list continues a session from its row.
- **Choose each agent's model in a compare run.** With several agents ticked, the composer shows a model chip per agent; an agent Zorvo has not used yet is asked for its models only when you open its chip.
- **The window matches its design.** The sidebar runs the full height with the window's buttons in its own header, the top bar sits over the chat, session rows show their agent's logo, and the Agents menu, buttons, menus, toasts and small states look as designed.
- **A quieter top bar.** Your plan ("2/4"), what runs in the background ("2 background tasks") and the changes (`+42 −11`) show as chips only when they have something to say. Double-click the session's title to rename it, and the ⋯ menu opens the session in a new window or in Finder, renames it or archives it. Back and Forward show while the sidebar is hidden.
- **The inspector's tabs look as designed.** Activity is grouped by turn and says what each step did and how it ended, with files the agent did not report in a card that opens Changes. Files and the file view are tidier, selected lines are tinted with **Add lines** under them, and the terminal names its shell and shows its size.
- **Search in the model menu bolds what it matched,** across a provider's tag and in a choice's description too.
- **The window can no longer shrink below 640 × 560** (a session's own window below 480 × 560), so Send stays in reach.
- **The full diff review takes the chat area,** with the changed files listed on the left, the file count and totals at the top and the comments bar at the bottom. **Shrink** puts it beside the chat.
- **The chat reads more easily.** Your messages are bubbles on the right, the agent's have its logo, name and time, and Copy, Fork and Rewind show when you point at a message or tab to it. Tool runs say what each tool did and whether it finished, a permission says what the agent wants, and the working, stalled and failed states sit under the last message.
- **The composer is calmer.** Image attachments show as thumbnails, controls that do not fit go into a ⋯ menu, Stop sits where Send was, and the context reads "38% of context". A new session starts from a centered composer with folder, branch (with **New worktree**) and agent chips above it, and **Start 2 sessions** says what a compare run does. The `/` and `@` lists say whose commands and which folder's files they show.
- **Read a file without leaving Zorvo.** The Files tab marks changed files (M, A) and the folders that hold them. Click a file to read it in the inspector, with its changed lines marked; select lines to add them to your message.
- **Set up Qwen Code from Zorvo.** When Qwen Code needs a provider, the new session shows **Set up Qwen Code**, which opens Qwen Code's own setup in a terminal, so you pick the provider there. Closing a sign-in or setup terminal now checks again whether you are signed in.
- **Clearer cards when something stands in the way.** A compare run shows one card per agent and asks before Pick keeps one. Installing, signing in and a removed agent each get a card by the message box with the agent's logo, and signing in lists every way the agent offers. The terminal sign-in is wider, the empty window asks for a folder, and a Zorvo update shows as a card.
- **The Changes tab and the full diff review look as designed:** each changed file is a card with its counts, the review has a file list with the picked file marked, and comments read where they stand ("Line 42 · Current").
- **Comment on lines in the Changes tab too,** and add them to your message from there.
- **A compare run, the cards that stand in the way, the sign-in terminal, the empty window and the update card look as designed:** each compare agent says how long its turn has run ("Working · 12 min") or took ("Finished · 8 min"), sign-in methods are listed with their own buttons, and the update card says what a restart stops ("2 agents mid-turn and 1 shell").
- **Notices appear as a card in the bottom right corner** instead of a strip across the top of the chat, so they no longer push the conversation down. A long message wraps inside the card, and **Dismiss notice** closes it as before.

### Fixed

- **The welcome screen says when your agents could not be read.** If Zorvo could not read your agents, Start stayed off with no reason given. It now says "Zorvo could not read your agents. Press Check again.", and Check again reads them once more.
- **GLM Agent without an API key now asks you to sign in.** It opens a session without a key and fails the first message with a generic "Internal error" that names the key only in its details. Zorvo now reads that as a sign-in request: the agent's chip turns to Sign in, the panel explains that it needs `Z_AI_API_KEY` in your shell (Zorvo never stores keys), and your message is sent again after you check.
- **Check sign-in no longer calls GLM Agent ready without its key.** An agent that cannot say who is signed in is only seen to open a session, which GLM Agent does without a key. When such an agent names the variable its key lives in (GLM Agent: `Z_AI_API_KEY`) and that variable is not set in your shell, the chip reads Not checked instead of Ready and the row says Zorvo cannot confirm a sign-in, with what to do: run the agent's own setup or export the variable, then check again. Zorvo only looks whether the variable is set, never at its value, and does not call you signed out, since a key saved by the agent's own setup is not visible to it. Agents that report their sign-in, or refuse to open a session while signed out, are checked as before.
- **An ordinary error is no longer mistaken for a sign-in request.** When an agent that offers sign-in methods fails with a generic "Internal error", Zorvo only asks you to sign in if the details say so in whole words or phrases ("No API key found", "Not logged in", "Unauthorized"). Words that merely contain one ("designing", "catalog in", "author.txt") no longer open the sign-in panel in place of the real error.

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

[Unreleased]: https://github.com/zakyirsyaad/zorvo/compare/v0.22.0...HEAD
[0.22.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.21.2...v0.22.0
[0.21.2]: https://github.com/zakyirsyaad/zorvo/compare/v0.21.1...v0.21.2
[0.21.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.21.0...v0.21.1
[0.21.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.20.1...v0.21.0
[0.20.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.14.1...v0.15.0
[0.14.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.11.2...v0.12.0
[0.11.2]: https://github.com/zakyirsyaad/zorvo/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/zakyirsyaad/zorvo/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/zakyirsyaad/zorvo/compare/v0.8.1...v0.9.0
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
