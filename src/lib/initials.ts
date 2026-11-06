/** Uppercased initials taken from up to the first two words of `name`, or null when it has none. */
export function initialsFromName(name?: string | null): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
