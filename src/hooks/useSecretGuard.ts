import { useCallback, useRef, useState } from "react";
import { readWorkspaceFile } from "../lib/files";
import { scanSecretText, type SecretMatch } from "../lib/secret-guard";
import { useLatest } from "./useLatest";
import type { ReviewSlot } from "./useReviewMessage";

export interface SecretMessage {
  text: string;
  attachments?: readonly string[];
}

export interface SecretGuardReview {
  message: SecretMessage;
  matches: SecretMatch[];
  /** Attachments the scanner could not read; they are named in the dialog. */
  skipped: string[];
  /** The session's agent, named in the dialog's limit. */
  agentName: string;
  /** The session the message was written for; undefined for a new-session draft. */
  sessionId?: string;
  /** The composer's review-comment slot at Send time, so a held message keeps its comment link. */
  reviewSlot?: ReviewSlot;
}

export interface SecretGuardContext {
  isEnabled: boolean;
  root: string | undefined;
  agentName: string;
  /** The session the message was written for; undefined for a new-session draft. */
  sessionId?: string;
  /** The composer's review-comment slot at Send time, so a held message keeps its comment link. */
  reviewSlot?: ReviewSlot;
}

interface SecretGuardOptions {
  /** Private only: a plain session is never scanned. */
  isEnabled: boolean;
  /** The folder the message's attachments are read from. */
  root: string | undefined;
  agentName: string;
  /** Puts the message back in its own session's composer when the user picks Edit message. */
  onEdit: (sessionId: string | undefined, message: SecretMessage, reviewSlot?: ReviewSlot) => void;
}

/** A file path from the session folder, or null when it is not inside it. */
function relativeToRoot(root: string, path: string): string | null {
  const folder = root.replace(/\/+$/, "");
  if (path === folder) return "";
  if (path.startsWith(`${folder}/`)) return path.slice(folder.length + 1);
  return path.startsWith("/") ? null : path;
}

/** Scans the message and its attachments locally; an attachment it cannot read is named as skipped. */
export async function scanMessageSecrets(
  root: string,
  message: SecretMessage,
): Promise<{ matches: SecretMatch[]; skipped: string[] }> {
  const matches = scanSecretText(message.text);
  const skipped: string[] = [];
  for (const path of message.attachments ?? []) {
    const relative = relativeToRoot(root, path);
    if (relative === null || relative === "") {
      skipped.push(path);
      continue;
    }
    try {
      const content = await readWorkspaceFile(root, relative);
      if (content.kind !== "text") {
        skipped.push(path);
        continue;
      }
      matches.push(...scanSecretText(content.text, relative));
    } catch {
      // A file the viewer cannot read cannot be checked; the dialog says so.
      skipped.push(path);
    }
  }
  return { matches, skipped };
}

/**
 * The private composer's secret check. `check` either sends through the given callback, or holds
 * the message until the user picks Send anyway or Edit message.
 */
export function useSecretGuard({ isEnabled, root, agentName, onEdit }: SecretGuardOptions) {
  const [review, setReview] = useState<SecretGuardReview | null>(null);
  const deliverRef = useRef<(() => void) | null>(null);
  const onEditRef = useLatest(onEdit);
  // One scan at a time: a second Send waits its turn instead of replacing the first held message.
  const queueRef = useRef<{ message: SecretMessage; deliver: () => void; context?: SecretGuardContext }[]>([]);
  const runningRef = useRef(false);
  const heldRef = useRef(false);
  const drainRef = useRef<() => void>(() => {});

  const drain = useCallback(() => {
    if (runningRef.current || heldRef.current) return;
    const job = queueRef.current.shift();
    if (!job) return;
    const active = job.context ?? { isEnabled, root, agentName };
    if (!active.isEnabled || active.root === undefined) {
      job.deliver();
      drainRef.current();
      return;
    }
    runningRef.current = true;
    void scanMessageSecrets(active.root, job.message)
      .then(({ matches, skipped }) => {
        runningRef.current = false;
        if (matches.length === 0 && skipped.length === 0) {
          job.deliver();
          drainRef.current();
          return;
        }
        heldRef.current = true;
        deliverRef.current = job.deliver;
        setReview({
          message: job.message,
          matches,
          skipped,
          agentName: active.agentName,
          sessionId: active.sessionId,
          ...(active.reviewSlot ? { reviewSlot: active.reviewSlot } : {}),
        });
      })
      // Fails open by design: a scanner error must never become a Send the user cannot get past.
      .catch(() => {
        runningRef.current = false;
        job.deliver();
        drainRef.current();
      });
  }, [agentName, isEnabled, root]);
  drainRef.current = drain;

  const check = useCallback((message: SecretMessage, deliver: () => void, context?: SecretGuardContext) => {
    queueRef.current.push({ message, deliver, context });
    drainRef.current();
  }, []);

  const sendAnyway = useCallback(() => {
    const deliver = deliverRef.current;
    deliverRef.current = null;
    heldRef.current = false;
    setReview(null);
    deliver?.();
    drainRef.current();
  }, []);

  const edit = useCallback(() => {
    const pending = review;
    deliverRef.current = null;
    heldRef.current = false;
    setReview(null);
    if (pending) onEditRef.current(pending.sessionId, pending.message, pending.reviewSlot);
    drainRef.current();
  }, [onEditRef, review]);

  return { review, check, sendAnyway, edit };
}