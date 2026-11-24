/**
 * The Zorvo symbol (docs/brand/assets/zorvo-symbol.svg): two chevrons and a cursor, a terminal prompt, in
 * currentColor. `isWorking` plays the working logo: the chevrons light in turn and the cursor blinks, only with
 * motion allowed; under Reduce motion it stands still and whole.
 */
export function ZorvoSymbol({ className, strokeWidth = 3.6, isWorking = false }: { className?: string; strokeWidth?: number; isWorking?: boolean }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 7l10 7-10 7" className={isWorking ? "motion-safe:animate-working-chevron" : undefined} />
      {/* The second chevron lights 200ms after the first, so the light runs along the prompt. */}
      <path d="M18 19l10 7-10 7" className={isWorking ? "motion-safe:animate-working-chevron-late" : undefined} />
      <path d="M30 33h5" className={isWorking ? "motion-safe:animate-working-cursor" : undefined} />
    </svg>
  );
}
