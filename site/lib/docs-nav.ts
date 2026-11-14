export interface DocsPage {
  href: string;
  label: string;
  /** One sentence for the docs home card and the page's meta description. */
  summary: string;
}

export interface DocsGroup {
  title: string;
  pages: DocsPage[];
}

/** The docs, in reading order. The sidebar, the pager, the home page and the sitemap all read this list. */
export const DOCS_NAV: DocsGroup[] = [
  {
    title: "Get started",
    pages: [
      {
        href: "/docs",
        label: "Introduction",
        summary: "Install Zorvo and the agents you use, sign in to them, and work with sessions, worktrees and terminals in one desktop.",
      },
      {
        href: "/docs/install",
        label: "Install",
        summary: "Download Zorvo, open it the first time and install your first agent from inside the app.",
      },
      {
        href: "/docs/quickstart",
        label: "Quickstart",
        summary: "Tick your agents, pick a folder, and find your way around the window.",
      },
    ],
  },
  {
    title: "Agents",
    pages: [
      {
        href: "/docs/agents",
        label: "Supported agents",
        summary: "Agents from the ACP registry, and how to add, install, update and sign in to them.",
      },
      {
        href: "/docs/signing-in",
        label: "Signing in",
        summary: "Agents sign in with their own tools. Zorvo never asks for or stores your keys.",
      },
    ],
  },
  {
    title: "Using Zorvo",
    pages: [
      {
        href: "/docs/compare",
        label: "Compare agents",
        summary: "Send one prompt to up to four agents, each in its own worktree, and keep the one you pick.",
      },
      {
        href: "/docs/delegate",
        label: "Delegate a task",
        summary: "Hand a task from one session to another agent with an @ mention or the session menu, and get its answer back.",
      },
      {
        href: "/docs/review",
        label: "Review changes",
        summary: "Read what an agent changed, comment on lines, and send the comments in your next message.",
      },
      {
        href: "/docs/terminal",
        label: "Terminal",
        summary: "A shell in the folder a session works in, in the inspector beside the chat.",
      },
    ],
  },
  {
    title: "Reference",
    pages: [
      {
        href: "/docs/privacy",
        label: "Privacy and your data",
        summary: "Which hosts Zorvo contacts, what it never stores, and where your sessions live on disk.",
      },
      {
        href: "/docs/troubleshooting",
        label: "Troubleshooting",
        summary: "What to try when an agent is not installed, needs you to sign in, a turn fails, an agent seems stuck or an update will not install.",
      },
    ],
  },
];

export const DOCS_PAGES: DocsPage[] = DOCS_NAV.flatMap((group) => group.pages);
