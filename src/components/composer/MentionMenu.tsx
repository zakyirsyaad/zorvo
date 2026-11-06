import { FileText } from "lucide-react";
import { POPOVER_PANEL_STYLE } from "../ui/Popover";
import { Highlighted } from "../ui/Highlighted";

export interface MentionMenuProps {
  /** Paths relative to the workspace. */
  files: string[];
  highlighted: number;
  onPick: (path: string) => void;
  /** The workspace folder's name, for the header. */
  folderName: string;
  /** What follows the `@`; its match in a file's name shows in bold. */
  query: string;
}

/** Workspace files matching what follows the `@`, above the prompt. */
export function MentionMenu({ files, highlighted, onPick, folderName, query }: MentionMenuProps) {
  return (
    <div className={`absolute bottom-full left-0 z-50 mb-2 w-full ${POPOVER_PANEL_STYLE}`}>
      <p className="px-2 pb-1.5 pt-1 text-caption font-medium text-fg-muted">Files in {folderName}</p>
      <ul role="listbox" aria-label="Files to mention" className="max-h-64 overflow-y-auto">
        {files.map((path, index) => {
          const slash = path.lastIndexOf("/");
          return (
            <li
              key={path}
              role="option"
              aria-selected={index === highlighted}
              data-file={path}
              title={path}
              // mousedown, not click: the prompt must keep focus.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(path);
              }}
              className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.75 ${
                index === highlighted ? "bg-surface-hover text-fg" : "text-fg-secondary hover:bg-surface-hover"
              }`}
            >
              <FileText size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-subtle" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-ui-sm">
                  <Highlighted text={path.slice(slash + 1)} query={query} />
                </span>
                {slash > 0 && (
                  <span className="truncate font-mono text-caption leading-[15px] text-fg-subtle">{path.slice(0, slash)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
