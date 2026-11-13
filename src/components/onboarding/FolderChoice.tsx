import { useEffect, useId, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { SettingsRow } from "../settings/SettingsGroup";
import { AgentTile } from "../ui/AgentTile";
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
    <AgentTile size={22} className="text-fg-secondary">
      <Folder size={12} aria-hidden="true" />
    </AgentTile>
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
  const [isPicking, setIsPicking] = useState(false);
  const nameId = useId();
  const pathId = useId();
  // Use takes its own button off screen, so focus moves to the chosen folder's Change instead of the page.
  const changeRef = useRef<HTMLButtonElement>(null);
  const shouldFocusChange = useRef(false);
  useEffect(() => {
    if (!folder || !shouldFocusChange.current) return;
    shouldFocusChange.current = false;
    changeRef.current?.focus();
  }, [folder]);

  const pick = async () => {
    if (isPicking) return;
    setIsPicking(true);
    setError(null);
    try {
      const picked = await onPickFolder();
      if (picked) onChoose(toFolderOption(picked));
    } catch {
      setError(PICK_ERROR);
    } finally {
      setIsPicking(false);
    }
  };

  const use = (offered: FolderOption) => {
    shouldFocusChange.current = true;
    onChoose(offered);
  };

  return (
    <section className="flex flex-col gap-2.5">
      <NumberedHeading number={2}>Project folder</NumberedHeading>
      <div className={CARD}>
        {folder ? (
          <SettingsRow
            isCompact
            leading={<FolderTile />}
            label={
              <span id={nameId} className="font-medium">
                {folder.name}
              </span>
            }
            description={
              <span id={pathId} className="font-mono text-caption">
                {folder.path}
              </span>
            }
            control={
              <Button ref={changeRef} size="md" disabled={isPicking} onClick={() => void pick()} aria-describedby={`${nameId} ${pathId}`}>
                <span className="text-fg">Change</span>
              </Button>
            }
          />
        ) : (
          <>
            {offeredFolders(recentFolders, suggestedFolders).map((offered) => (
              <SettingsRow
                key={offered.path}
                isCompact
                leading={<FolderTile />}
                label={<span className="font-medium">{offered.name}</span>}
                description={<span className="font-mono text-caption">{offered.path}</span>}
                control={
                  <Button size="md" onClick={() => use(offered)} aria-label={`Use ${offered.name}`}>
                    <span className="text-fg">Use</span>
                  </Button>
                }
              />
            ))}
            <SettingsRow
              isCompact
              leading={<FolderTile />}
              label={<span className="font-medium">Another folder</span>}
              control={
                <Button size="md" disabled={isPicking} onClick={() => void pick()}>
                  <span className="text-fg">Open folder</span>
                </Button>
              }
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
