export interface DocsPage {
  href: string;
  label: string;
  /** One sentence for the docs home card and the page's structured data. */
  summary: string;
  /** The title a search result shows: what the page is for, in the words people search with, at most 60 characters. */
  title: string;
  /** The meta description: 140 to 160 characters, so a search result shows all of it and none is cut. */
  description: string;
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
        title: "Zorvo docs: install, agents, compare and review",
        description: "How to install Zorvo on a Mac, add Claude Code, Codex, Qwen Code and other coding agents, sign in to them, and work with sessions, worktrees and terminals.",
      },
      {
        href: "/docs/install",
        label: "Install",
        summary: "Download Zorvo, open it the first time and install your first agent from inside the app.",
        title: "Install Zorvo on a Mac · Zorvo docs",
        description: "Download Zorvo for a Mac with Apple silicon or Intel, open it the first time, install your first coding agent from inside the app, and keep Zorvo up to date.",
      },
      {
        href: "/docs/quickstart",
        label: "Quickstart",
        summary: "Tick your agents, pick a folder, and find your way around the window.",
        title: "Quickstart: your first session · Zorvo docs",
        description: "Tick the coding agents you use, pick a project folder, start a first session and find your way around Zorvo's window: sidebar, chat, composer and inspector.",
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
        title: "Supported coding agents · Zorvo docs",
        description: "Zorvo runs Claude Code, Codex, Qwen Code and the other coding agents of the ACP registry. How to add, install, update and sign in to each of them on a Mac.",
      },
      {
        href: "/docs/signing-in",
        label: "Signing in",
        summary: "Agents sign in with their own tools. Zorvo never asks for or stores your keys.",
        title: "Sign in to Claude Code, Codex and Qwen Code · Zorvo docs",
        description: "Each agent signs in with its own tools, in a terminal inside Zorvo. Zorvo never asks for or stores your API keys or tokens, and shows which agents are ready.",
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
        title: "Compare coding agents on one prompt · Zorvo docs",
        description: "Send one prompt to up to four coding agents at once. Each works in its own git worktree, you read the numbers and the diffs, and you keep the one you pick.",
      },
      {
        href: "/docs/delegate",
        label: "Delegate a task",
        summary: "Hand a task to another agent with an @ mention or the session menu, or let an agent start workers, and get the reports back.",
        title: "Delegate a task between coding agents · Zorvo docs",
        description: "Hand a task from one coding agent to another with an @ mention or the session menu, or let an agent start workers itself, and get their reports back.",
      },
      {
        href: "/docs/review",
        label: "Review changes",
        summary: "Read what an agent changed, comment on lines, and send the comments in your next message.",
        title: "Review an agent's changes, line by line · Zorvo docs",
        description: "Read what a coding agent changed in the diff, comment on the lines you want changed, and add the comments to your next message, which you read before sending.",
      },
      {
        href: "/docs/output",
        label: "Pages and canvases",
        summary: "An agent shows you a page or several screens beside the chat, and you comment on what you see.",
        title: "Pages and canvases from an agent · Zorvo docs",
        description: "A coding agent can show you a report, a diagram or several screens beside the chat. Comment on what you see, pick a variant, and export pages or artboards.",
      },
      {
        href: "/docs/terminal",
        label: "Terminal",
        summary: "A shell in the folder a session works in, in the inspector beside the chat.",
        title: "The workspace terminal · Zorvo docs",
        description: "A shell in the folder a session works in, in the inspector beside the chat. Each shell has its own tab and keeps running while you look at changes or files.",
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
        title: "Privacy and your data · Zorvo docs",
        description: "Zorvo sends no telemetry and never stores your API keys. Which hosts it contacts and when, what private mode adds, and where your sessions live on your Mac.",
      },
      {
        href: "/docs/credits",
        label: "Credits terms",
        summary: "Who sells private mode credits, what they cost, and what happens to your payment and your balance.",
        title: "Private mode credits: terms · Zorvo docs",
        description: "Who sells Zorvo's private mode credits, what a credit costs, how you pay, what happens to a failed or late payment, and what happens to your balance.",
      },
      {
        href: "/docs/troubleshooting",
        label: "Troubleshooting",
        summary: "What to try when an agent is not installed, needs you to sign in, a turn fails, an agent seems stuck or an update will not install.",
        title: "Troubleshooting Zorvo on a Mac · Zorvo docs",
        description: "What to try when an agent shows as not installed, needs you to sign in, a turn fails, an agent seems stuck, an update will not install or macOS blocks Zorvo.",
      },
    ],
  },
];

export const DOCS_PAGES: DocsPage[] = DOCS_NAV.flatMap((group) => group.pages);
