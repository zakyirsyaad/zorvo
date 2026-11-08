import { useCallback, useRef, useState } from "react";
import { readWorkspaceFile } from "../lib/files";
import { scanSecretText, type SecretMatch } from "../lib/secret-guard";
import { useLatest } from "./useLatest";

export interface SecretMessage {
  text: string;
  attachments?: readonly string[];
}

export interface SecretGuardReview {
  message: SecretMessage;
  matches: SecretMatch[];
  /** The session's agent, named in the dialog's limit. */
  agentName: string;
}

export interface SecretGuardContext {
  isEnabled: boolean;
  root: string | undefined;
  agentName: string;
}

interface SecretGuardOptions {
  /** Private only: a plain session is never scanned. */
  isEnabled: boolean;
  /** The folder the message's attachments are read from. */
  root: string | undefined;
  agentName: string;
  /** Puts the message back in the composer when the user picks Edit message. */
  onEdit: (message: SecretMessage) => void;
}

/** A file path from the session folder, or null when it is not inside it. */
function relativeToRoot(root: string, path: string): string | null {
  const folder = root.replace(/\/+$/, "");
  if (path === folder) return "";
  if (path.startsWith(`${folder}/`)) return path.slice(folder.length + 1);
  return path.startsWith("/") ? null : path;
}

/** Scans the message and its attachments locally; an unreadable attachment is skipped. */
export async function scanMessageSecrets(
  root: string,
  message: SecretMessage,
): Promise<SecretMatch[]> {
  const matches = scanSecretText(message.text);
  for (const path of message.attachments ?? []) {
    const relative = relativeToRoot(root, path);
    if (relative === null || relative === "") continue;
    try {
      const content = await readWorkspaceFile(root, relative);
      if (content.kind !== "text") continue;
      matches.push(...scanSecretText(content.text, relative));
    } catch {
      // A file the viewer cannot read cannot be checked; sending is not blocked for it.
    }
  }
  return matches;
}

/**
 * The private composer's secret check. `check` either sends through the given callback, or holds
 * the message until the user picks Send anyway or Edit message.
 */
export function useSecretGuard({ isEnabled, root, agentName, onEdit }: SecretGuardOptions) {
  const [review, setReview] = useState<SecretGuardReview | null>(null);
  const deliverRef = useRef<(() => void) | null>(null);
  const onEditRef = useLatest(onEdit);

  const check = useCallback(
    (message: SecretMessage, deliver: () => void, context?: SecretGuardContext) => {
      const active = context ?? { isEnabled, root, agentName };
      if (!active.isEnabled || active.root === undefined) {
        deliver();
        return;
      }
      void scanMessageSecrets(active.root, message)
        .then((matches) => {
          if (matches.length === 0) {
            deliver();
            return;
          }
          deliverRef.current = deliver;
          setReview({ message, matches, agentName: active.agentName });
        })
        // A scanner failure must not become a send failure the user cannot get past.
        .catch(() => deliver());
    },
    [agentName, isEnabled, root],
  );

  const sendAnyway = useCallback(() => {
    const deliver = deliverRef.current;
    deliverRef.current = null;
    setReview(null);
    deliver?.();
  }, []);

  const edit = useCallback(() => {
    const pending = review;
    deliverRef.current = null;
    setReview(null);
    if (pending) onEditRef.current(pending.message);
  }, [onEditRef, review]);

  return { review, check, sendAnyway, edit };
}