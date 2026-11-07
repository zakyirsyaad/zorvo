import type { ReactNode } from "react";
import { Chip } from "../ui/Chip";
import { Icon, type IconName } from "../ui/Icon";
import { SectionIntro } from "../ui/SectionIntro";

const FEATURES: { icon: IconName; title: string; body: ReactNode }[] = [
  {
    icon: "layers",
    title: "The agent's own data",
    body: "Its real modes and models, permission requests with its own choices, its questions, slash commands and context use. Sessions resume after a restart.",
  },
  {
    icon: "sliders-horizontal",
    title: "Every choice the agent offers",
    body: "Models, modes and other settings each get a chip with the agent's own description: Codex's Plan mode, Claude's fast mode, Gemini's models. What does not fit goes under ⋯.",
  },
  {
    icon: "download",
    title: "Install agents from Zorvo",
    body: "Pick an agent and click Install. Zorvo brings Node.js or uv when it needs them, and you can write your first message while it installs.",
  },
  {
    icon: "key-round",
    title: "See which agents are ready",
    body: "The Agents menu and Settings show Ready, Sign in or Not checked for each agent. Its own login, or Qwen Code's own setup, runs in a terminal in the app, and your message is sent once you are signed in.",
  },
  {
    icon: "square-check",
    title: "One welcome screen",
    body: "Tick the agents you'll use, pick a project folder and press Start. Signing in waits for your first session.",
  },
  {
    icon: "message-square",
    title: "A sidebar that says who waits",
    body: "Each session reads its agent and what it does: Working, Waiting for you, Finished, unread. A folded folder still says 1 waiting. Hide the sidebar to give the chat the room.",
  },
  {
    icon: "panel-right",
    title: "One inspector",
    body: "Changes, Activity, Files and Terminal in one panel beside the chat. Drag it wider; its shells keep running when you switch tabs or close it.",
  },
  {
    icon: "file-text",
    title: "Read a file in place",
    body: "The Files tab marks what changed. Click a file to read it with its changed lines marked, and add the lines you select to your message.",
  },
  {
    icon: "git-branch",
    title: "Branches and worktrees",
    body: (
      <>
        Start from the branch you pick, or turn on New worktree to give the session its own copy on an{" "}
        <Chip isCode>agent/&lt;title&gt;</Chip> branch.
      </>
    ),
  },
  {
    icon: "rotate-ccw",
    title: "Fork and rewind",
    body: "Fork any reply into a new session. Or rewind to before one of your messages and send it again, edited.",
  },
  {
    icon: "circle-alert",
    title: "When a turn goes wrong",
    body: "A failed turn says what happened in plain words, with Try again. An agent that has sent nothing for a while gets a notice with Stop, and a message that did not reach the agent comes back to its box.",
  },
  {
    icon: "refresh-cw",
    title: "Zorvo updates itself",
    body: "A card offers Update & restart and says what a restart would stop, such as 2 agents mid-turn. Zorvo checks the update's signature before it installs it.",
  },
];

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="border-t border-border py-[72px] md:py-28">
      <div className="site-wrap flex flex-col gap-14">
        <SectionIntro
          id="features-title"
          eyebrow="features"
          title="One app. Each agent as it really is."
          lead="Sessions, worktrees, a terminal, files and diffs sit around the agent, never in its way."
          className="max-w-[640px]"
        />
        {/* Hairline grid: the list draws the top and left edges, each cell its right and bottom. */}
        <ul className="m-0 grid list-none grid-cols-1 border-t border-l border-border p-0 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon, title, body }) => (
            <li key={title} className="flex flex-col gap-3.5 border-r border-b border-border px-5 py-7 sm:px-7 sm:py-8">
              <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface-2 text-fg">
                <Icon name={icon} size={18} />
              </span>
              <h3 className="m-0 text-lg leading-[26px] font-semibold tracking-[-0.02em] text-fg">{title}</h3>
              <p className="t-body m-0">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
