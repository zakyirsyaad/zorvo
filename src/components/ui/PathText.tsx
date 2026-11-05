export interface PathTextProps {
  path: string;
  /** Size and colour; the path is always mono. */
  className?: string;
  title?: string;
}

/**
 * A file path in mono, cut at its start when it does not fit, so the file's name stays in sight
 * however long the path (agents send absolute paths). The right-to-left box puts the ellipsis
 * on the left; the left-to-right bdi keeps the path itself reading normally inside it.
 */
export function PathText({ path, className = "", title }: PathTextProps) {
  return (
    <span className={`min-w-0 truncate text-left font-mono [direction:rtl] ${className}`} title={title ?? path}>
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}
