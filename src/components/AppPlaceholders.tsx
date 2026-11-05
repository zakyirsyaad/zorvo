import { FolderOpen } from "lucide-react";
import { Button } from "./ui/Button";

/** In the chat's place while no folder is open: nothing can start until one is. */
export function EmptyFolderState({ onOpenFolder }: { onOpenFolder: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-surface-2">
        <FolderOpen size={24} aria-hidden="true" className="text-fg-muted" />
      </div>
      <h1 className="text-xl font-medium text-fg">Open a folder to start</h1>
      <p className="mt-1 max-w-sm text-ui text-fg-muted">
        Pick a project folder. Your agents work inside it, and its sessions show in the sidebar.
      </p>
      <Button variant="primary" onClick={onOpenFolder} icon={<FolderOpen size={12} aria-hidden="true" />} className="mt-4">
        Open folder
      </Button>
    </div>
  );
}

/** Shown over the conversation while files are dragged onto the window. */
export function FileDropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-border-strong bg-overlay text-sm text-fg">
      Drop files to add them to your message
    </div>
  );
}
