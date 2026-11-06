import { useState } from "react";
import { Folder } from "lucide-react";
import { SettingsRow } from "../settings/SettingsGroup";
import { Button } from "../ui/Button";
import { NumberedHeading } from "./AgentChoices";
import { toFolderOption, type FolderOption } from "./types";

export interface FolderChoiceProps {
  folder: FolderOption | null;
  recentFolders: readonly FolderOption[];
  suggestedFolders: readonly FolderOption[];
  onChoose: (folder: FolderOption) => void;
  onPickFolder: () => Promise<FolderOption | null>;
}

const PICK_ERROR = "Couldn't open the folder dialog. Try again.";
/** Folders offered before one is chosen; the dialog finds any other. */
const MAX_OFFERED = 4;

const CARD = "flex flex-col rounded-xl border border-border bg-surface-2";

function FolderTile() {
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-surface-hover text-fg-secondary">
      <Folder size={14} />
    </span>
  );
}

/** Recent folders first, then the ones found on this Mac, each once. */
function offeredFolders(recent: readonly FolderOption[], suggested: readonly FolderOption[]): FolderOption[] {
  const seen = new Set<string>();
  return [...recent, ...suggested]
    .filter((folder) => (seen.has(folder.path) ? false : (seen.add(folder.path), true)))
    .slice(0, MAX_OFFERED)
    .map(toFolderOption);
}

/** Section 2 of the welcome screen: the chosen folder with Change, or folders to use and Open folder. */
export function FolderChoice({ folder, recentFolders, suggestedFolders, onChoose, onPickFolder }: FolderChoiceProps) {
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    try {
      const picked = await onPickFolder();
      if (picked) onChoose(toFolderOption(picked));
    } catch {
      setError(PICK_ERROR);
    }
  };

  const outline = (label: string, onClick: () => void, ariaLabel?: string) => (
    <Button size="md" onClick={onClick} aria-label={ariaLabel}>
      <span className="text-fg">{label}</span>
    </Button>
  );

  return (
    <section className="flex flex-col gap-2.5">
      <NumberedHeading number={2}>Project folder</NumberedHeading>
      <div className={CARD}>
        {folder ? (
          <SettingsRow
            isTight
            leading={<FolderTile />}
            label={folder.name}
            description={<span className="font-mono text-caption">{folder.path}</span>}
            control={outline("Change", () => void pick())}
          />
        ) : (
          <>
            {offeredFolders(recentFolders, suggestedFolders).map((offered) => (
              <SettingsRow
                key={offered.path}
                isTight
                leading={<FolderTile />}
                label={offered.name}
                description={<span className="font-mono text-caption">{offered.path}</span>}
                control={outline("Use", () => onChoose(offered), `Use ${offered.name}`)}
              />
            ))}
            <SettingsRow
              isTight
              leading={<FolderTile />}
              label="Another folder"
              control={outline("Open folder", () => void pick())}
            />
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-ui-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
