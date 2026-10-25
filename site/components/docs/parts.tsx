import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui/Icon";

/** A link inside the docs' prose or cards: underlined, with the site's focus ring. */
export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="focus-ring rounded-sm text-fg underline decoration-border-strong underline-offset-2 transition-colors duration-150 hover:decoration-fg"
    >
      {children}
    </a>
  );
}

/** An h2 that the page's "On this page" list can point at. */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="t-title m-0 mt-6 scroll-mt-6 border-t border-border pt-8 text-[22px] leading-7">
      {children}
    </h2>
  );
}

export function H3({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="t-heading m-0 mt-2 scroll-mt-6">
      {children}
    </h3>
  );
}

interface CalloutProps {
  /** `attention` is the one amber note per page, for what blocks the reader. */
  tone?: "note" | "attention";
  children: ReactNode;
}

export function Callout({ tone = "note", children }: CalloutProps) {
  const isAttention = tone === "attention";
  const icon: IconName = isAttention ? "triangle-alert" : "check";
  return (
    <div
      className={`flex gap-3 rounded-xl border p-4 ${
        isAttention ? "border-attention-border bg-attention-surface" : "border-border bg-surface-1"
      }`}
    >
      <Icon name={icon} size={16} className={`mt-1 ${isAttention ? "text-status-attention" : "text-fg-muted"}`} />
      <p className="m-0 text-sm leading-6 text-fg-secondary">{children}</p>
    </div>
  );
}

/** A command to run. There is no Copy button: the docs have no client components, so the text is there to select. */
export function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-terminal-border bg-terminal-bg">
      <div className="t-code-sm border-b border-terminal-border px-3.5 py-2 text-terminal-fg-subtle">{label}</div>
      <pre className="t-code m-0 overflow-x-auto px-3.5 py-3 text-terminal-fg">
        <span aria-hidden="true" className="text-terminal-fg-subtle select-none">% </span>
        {children}
      </pre>
    </div>
  );
}

/** A table that scrolls inside its own box at phone width, so the page itself never does. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[520px] border-collapse text-left text-[13px] leading-5 [&_td]:border-t [&_td]:border-border [&_td]:px-3.5 [&_td]:py-2.5 [&_td]:align-top [&_th]:bg-surface-1 [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:font-medium [&_th]:text-fg [&_th[scope=row]]:border-t [&_th[scope=row]]:border-border [&_th[scope=row]]:bg-transparent [&_th[scope=row]]:font-normal [&_th[scope=row]]:text-fg-muted">
        {children}
      </table>
    </div>
  );
}

/** The frame around a picture of the app. The picture inside carries role="img", so nothing in it is a control. */
export function Picture({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      {children}
    </div>
  );
}

export function PictureRow({ children, last = false }: { children: ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 ${last ? "" : "border-b border-border"}`}>{children}</div>
  );
}

const TEXT = "text-[15px] leading-7 text-fg-secondary";

export function P({ children }: { children: ReactNode }) {
  return <p className={`m-0 ${TEXT}`}>{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className={`m-0 flex list-disc flex-col gap-2 pl-5 ${TEXT}`}>{children}</ul>;
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className={`m-0 flex list-decimal flex-col gap-2 pl-5 ${TEXT}`}>{children}</ol>;
}

/** Bold text for a button, a setting or a key term. */
export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-fg">{children}</strong>;
}
