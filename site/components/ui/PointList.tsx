import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface Point {
  icon: IconName;
  title: string;
  body: ReactNode;
}

/** The icon, heading and line of text that list what a section's picture shows. */
export function PointList({ points, className = "" }: { points: Point[]; className?: string }) {
  return (
    <ul className={`m-0 flex list-none flex-col gap-5 p-0 ${className}`}>
      {points.map(({ icon, title, body }) => (
        <li key={title} className="flex gap-3.5">
          <Icon name={icon} size={18} className="mt-[3px] text-fg" />
          <div className="flex flex-col gap-1">
            <h3 className="t-heading m-0">{title}</h3>
            <p className="t-body m-0">{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
