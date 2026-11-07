import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** A link from a landing section to the docs page that explains it in full. */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="focus-ring inline-flex items-center gap-1.5 self-start rounded-sm text-sm leading-5 font-medium text-fg underline decoration-border-strong underline-offset-4 transition-colors duration-150 hover:decoration-fg"
    >
      {children}
      <Icon name="arrow-right" />
    </a>
  );
}
