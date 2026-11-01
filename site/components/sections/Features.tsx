import type { ReactNode } from "react";
import { Chip } from "../ui/Chip";
import { Icon, type IconName } from "../ui/Icon";
import { SectionIntro } from "../ui/SectionIntro";

const FEATURES: { icon: IconName; title: string; body: ReactNode }[] = [
  {
    icon: "layers",
    title: "The agent's own data",
    body: "Its real modes and models, permission requests with its own choices, slash commands and context usage. Sessions resume after a restart.",
  },
  {
    icon: "sliders-horizontal",
    title: "Every choice the agent offers",
    body: "Models, modes and other settings each get a chip with the agent's own description: Codex's Plan mode, Claude's fast mode, Gemini's models. A mode that skips approvals carries a shield.",
  },
  {
    icon: "download",
    title: "Install agents from Zorvo",
    body: "Pick an agent and click Install. Zorvo brings Node.js or uv when it needs them, and you can write your first message while it installs.",
  },
  {
    icon: "key-round",
    title: "See which agents are ready",
    body: "The sidebar and Settings show Ready, Sign in or Not checked for each agent. An agent's own login runs in a terminal in the app, and your message is sent once you are signed in.",
  },
  {
    icon: "folder",
    title: "Workspaces and sessions",
    body: "Sessions group by folder and title themselves from the first message. Rename, pin and archive them, or continue one you started in the agent's own CLI.",
  },
  {
    icon: "square-terminal",
    title: "A terminal where the agent works",
    body: "Open a shell in the session's folder, or its worktree, in a drawer under the chat. Each folder keeps its own tabs.",
  },
  {
    icon: "git-branch",
    title: "Branches and worktrees",
    body: (
      <>
        Pick the branch a session starts from. Or give it its own worktree on an{" "}
        <Chip isCode>agent/&lt;title&gt;</Chip> branch, so agents in one repository never edit the
        same files.
      </>
    ),
  },
  {
    icon: "rotate-ccw",
    title: "Fork and rewind",
    body: "Fork any reply into a new session. Or rewind to before one of your messages and send it again, edited.",
  },
  {
    icon: "image",
    title: "The composer",
    body: "Mention files with @, drop files and pictures onto the window, and see an attached image as a thumbnail before you send it.",
  },
  {
    icon: "git-pull-request",
    title: "Review and commit",
    body: (
      <>
        Read each changed file&apos;s diff and commit the files you choose. The top bar shows the
        branch&apos;s pull request and its checks, read with your own <Chip isCode>gh</Chip>.
        Settings shows whether your <Chip isCode>gh</Chip> is signed in, and Connect signs you in.
      </>
    ),
  },
  {
    icon: "circle-alert",
    title: "When a turn goes wrong",
    body: "A failed turn says what happened in plain words, with Try again to send your message once more. An agent that seems stuck gets a notice with Stop.",
  },
  {
    icon: "refresh-cw",
    title: "Zorvo updates itself",
    body: "When a new version is out, a notice offers Update & restart. Zorvo checks the update's signature before it installs it, and tells you first if a restart would stop a working agent.",
  },
];

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="border-t border-border py-[72px] md:py-28"
    >
      <div className="site-wrap flex flex-col gap-14">
        <SectionIntro
          id="features-title"
          eyebrow="features"
          title="One app. Each agent as it really is."
          lead="Sessions, worktrees, a terminal, diffs and pull requests sit around the agent, never in its way."
          className="max-w-[640px]"
        />
        {/* Hairline grid: the list draws the top and left edges, each cell its right and bottom. */}
        <ul className="m-0 grid list-none grid-cols-1 border-t border-l border-border p-0 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon, title, body }) => (
            <li
              key={title}
              className="flex flex-col gap-3.5 border-r border-b border-border px-5 py-7 sm:px-7 sm:py-8"
            >
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
