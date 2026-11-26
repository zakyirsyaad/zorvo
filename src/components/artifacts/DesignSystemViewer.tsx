import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDesignSystem } from "../../hooks/useDesignSystem";
import { useDesignSystemTheme } from "../../hooks/useDesignSystemTheme";
import { useDesignSystemSource } from "../../hooks/useDesignSystemSource";
import { Button } from "../ui/Button";
import { ThemeMenu } from "./ThemeMenu";
import { MessageSquarePlus } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { useDesignSystemMarks } from "../../hooks/useDesignSystemMarks";
import { dsOwnMarks } from "../../lib/design-system-comments";
import type { ArtifactCommentsState } from "../../hooks/useArtifactComments";
import type { AddArtifactReview } from "../../hooks/useReviewWiring";
import { ArtifactCommentStrip } from "./ArtifactCommentStrip";
import { enqueueArtifactViewCall } from "../../hooks/useArtifactView";
import { useLatest } from "../../hooks/useLatest";
import { FOLDER_NOT_FOUND } from "../../lib/canvas";
import { defaultProblemLine, droppedLine, dsShellState, shownName, sourceLine, syncMessage } from "../../lib/design-systems";
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
  /** Puts text in the session's message box, never sends it; absent (a popout), no Sync again. */
  onInsertText?: (text: string) => void;
  /** Why the message box cannot take text now. */
  insertBlockedReason?: string;
  /** The session's artifact comments; absent (a popout), no Comment button and no strip. */
  comments?: ArtifactCommentsState;
  addReview?: AddArtifactReview;
}

const COULD_NOT_SHOW = "Zorvo could not show that design system.";
const SECTIONS_CUT = "Some sections are too long to show here.";

/**
 * A design system in the artifact view: Zorvo's shell in the same native view a page uses, told what
 * to show with `ds_view_apply` whenever the system is read again. A folder that no longer reads keeps
 * the last good system under a line.
 */
export function DesignSystemViewer({
  sessionId,
  designSystemKey,
  cwd,
  turnsEnded,
  onBack,
  isExpanded,
  onToggleExpanded,
  onError,
  isCovered = false,
  onInsertText,
  insertBlockedReason,
  comments,
  addReview,
}: DesignSystemViewerProps) {
  const source = useDesignSystemSource(sessionId, designSystemKey, turnsEnded);
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
    if (list?.defaultProblem) lines.push(defaultProblemLine(list.defaultProblem, shownName));
    const dropped = droppedLine(shown?.content?.tokens?.dropped ?? [], shownName);
    if (dropped) lines.push(dropped);
    if (shown?.content?.tokensError) lines.push(`tokens.json could not be read: ${shown.content.tokensError}`);
    return lines;
  }, [list, shown]);

  useDesignSystemMarks(sessionId, designSystemKey, comments?.comments, shown, onError);
  const ownMarks = useMemo(() => dsOwnMarks(comments?.comments ?? [], designSystemKey), [comments?.comments, designSystemKey]);
  const state = useMemo(
    () => (shown === null ? null : dsShellState(shown, sessionId, theme, [], undefined, ownMarks)),
    [shown, sessionId, theme, ownMarks],
  );
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
  const sourceNote = source ? sourceLine(source) : null;
  const headerNotes = [
    ...(sourceNote ? [sourceNote] : []),
    ...notes,
    ...(isCut ? [SECTIONS_CUT] : []),
    ...(readError ? [`The design system could not be read: ${readError}`] : []),
  ];
  const changed = source?.state === "changed" ? source : null;

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
        {changed && onInsertText && (
          <Button
            variant="outline"
            size="sm"
            disabled={insertBlockedReason !== undefined}
            title={insertBlockedReason}
            onClick={() => onInsertText(syncMessage(relative, changed))}
          >
            Sync again
          </Button>
        )}
        {picked.theme !== null && <ThemeMenu themes={themeIds} theme={picked.theme} onPick={picked.setTheme} onMenuOpen={setIsMenuOpen} />}
        {comments && shown !== null && (
          <IconButton label="Comment" size="row" aria-pressed={comments.isCommenting} onClick={() => comments.setCommenting(!comments.isCommenting)}>
            <MessageSquarePlus size={14} />
          </IconButton>
        )}
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
      {comments && addReview && shown !== null && !isFolderGone && <ArtifactCommentStrip systemSource={shown} cwd={cwd ?? ""} comments={comments} addReview={addReview} />}
    </div>
  );
}
