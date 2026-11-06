import { formatLineCount, MINUS } from "../../lib/diff-stats";

const COUNT = "shrink-0 font-mono text-caption tabular-nums";

/** A file's or a diff's `+N` and `−N`, each only when it is not zero. */
export function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <>
      {added > 0 && <span className={`${COUNT} text-status-running`}>+{formatLineCount(added)}</span>}
      {removed > 0 && (
        <span className={`${COUNT} text-danger`}>
          {MINUS}
          {formatLineCount(removed)}
        </span>
      )}
    </>
  );
}
