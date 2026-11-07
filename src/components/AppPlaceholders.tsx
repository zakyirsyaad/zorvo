import { Folder, Plus } from "lucide-react";
import { Button } from "./ui/Button";

/** In the chat's place while no folder is open: nothing can start until one is. */
export function EmptyFolderState({ onOpenFolder }: { onOpenFolder: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
      <div className="flex max-w-[400px] flex-col items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface-2">
          <Folder size={22} aria-hidden="true" className="text-fg-secondary" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">Open a folder to start</h1>
          <p className="text-ui text-fg-muted">Pick a project folder. Your agents work inside it, and its sessions show in the sidebar.</p>
        </div>
        <Button variant="primary" size="lg" onClick={onOpenFolder} icon={<Plus size={14} aria-hidden="true" />}>
          Open folder
        </Button>
      </div>
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
