import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDesignSystem } from "../../hooks/useDesignSystem";
import { useDesignSystemTheme } from "../../hooks/useDesignSystemTheme";
import { ThemeMenu } from "./ThemeMenu";
import { enqueueArtifactViewCall } from "../../hooks/useArtifactView";
import { useLatest } from "../../hooks/useLatest";
import { FOLDER_NOT_FOUND } from "../../lib/canvas";
import { defaultProblemLine, droppedLine, dsShellState } from "../../lib/design-systems";
import { ArtifactPageBox } from "./ArtifactPageBox";
import { DesignSystemHeader } from "./DesignSystemHeader";

export interface DesignSystemViewerProps {
  sessionId: string;
  designSystemKey: string;
  cwd?: string;
  turnsEnded?: number;
  onBack?: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
  isCovered?: boolean;
}

const COULD_NOT_SHOW = "Zorvo could not show that design system.";
const SECTIONS_CUT = "Some sections are too long to show here.";

/**
 * A design system in the artifact view: Zorvo's shell in the same native view a page uses, told what
 * to show with `ds_view_apply` whenever the system is read again. A folder that no longer reads keeps
 * the last good system under a line.
 */
export function DesignSystemViewer({ sessionId, designSystemKey, cwd, turnsEnded, onBack, isExpanded, onToggleExpanded, onError, isCovered = false }: DesignSystemViewerProps) {
  const system = useDesignSystem(sessionId, cwd, designSystemKey, turnsEnded);
  const [reload, setReload] = useState(0);
  const onErrorRef = useLatest(onError);
  const { read, lastGood, list } = system;
  const shown = lastGood;
  const themeIds = useMemo(() => shown?.content?.tokens?.themes.map((theme) => theme.id) ?? [], [shown]);
  const picked = useDesignSystemTheme(sessionId, designSystemKey, themeIds);
  const theme = picked.theme ?? "default";
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const notes = useMemo(() => {
    const lines: string[] = [];
    if (list?.defaultProblem) lines.push(defaultProblemLine(list.defaultProblem));
    const dropped = droppedLine(shown?.content?.tokens?.dropped ?? []);
    if (dropped) lines.push(dropped);
    if (shown?.content?.tokensError) lines.push(`tokens.json could not be read: ${shown.content.tokensError}`);
    return lines;
  }, [list, shown]);

  const state = useMemo(() => (shown === null ? null : dsShellState(shown, sessionId, theme, [])), [shown, sessionId, theme]);
  const isCut = useMemo(() => (state === null ? false : (JSON.parse(state) as { sectionsCut?: boolean }).sectionsCut === true), [state]);
  useEffect(() => {
    if (state === null) return;
    enqueueArtifactViewCall(
      () => invoke("ds_view_apply", { sessionId, key: designSystemKey, state }),
      () => onErrorRef.current(COULD_NOT_SHOW),
    );
  }, [state, sessionId, designSystemKey, onErrorRef]);

  const isFolderGone = read?.error === FOLDER_NOT_FOUND;
  const readError = read?.error && !isFolderGone ? read.error : null;
  const title = shown?.entry.title ?? read?.entry.title ?? "";
  const relative = shown?.entry.relative ?? read?.entry.relative ?? "";
  const folder = shown?.entry.folder ?? read?.entry.folder;
  const reveal = folder
    ? () => {
        invoke("reveal_file_in_finder", { path: `${folder}/design-system.json` }).catch(() => onError("Zorvo could not show that folder in Finder."));
      }
    : undefined;
  const headerNotes = [...notes, ...(isCut ? [SECTIONS_CUT] : []), ...(readError ? [`The design system could not be read: ${readError}`] : [])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DesignSystemHeader
        title={title}
        relative={relative}
        onBack={onBack}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onReveal={isFolderGone ? undefined : reveal}
        onReload={shown !== null && !isFolderGone ? () => setReload((count) => count + 1) : undefined}
        notes={headerNotes}
      >
        {picked.theme !== null && <ThemeMenu themes={themeIds} theme={picked.theme} onPick={picked.setTheme} onMenuOpen={setIsMenuOpen} />}
      </DesignSystemHeader>
      {isFolderGone ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
          <span className="text-ui font-semibold text-fg">Folder not found</span>
          <span className="text-ui text-fg-muted">The design system's folder was moved or deleted.</span>
        </div>
      ) : shown !== null ? (
        <ArtifactPageBox
          target={{ kind: "design-system", sessionId, key: designSystemKey, reload }}
          title={`The design system ${title}`}
          isCovered={isCovered || isMenuOpen}
          onError={onError}
        />
      ) : (
        <div className="min-h-0 flex-1" />
      )}
    </div>
  );
}
