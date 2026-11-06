/**
 * The Zorvo lockup: the double-prompt symbol (docs/brand/assets/zorvo-symbol.svg, in currentColor)
 * beside `zorvo` at 28px, 600, -0.04em, as the welcome screen draws it. The brand brief's own face is
 * not shipped (the app uses the system font, and a test keeps that face out), so it is set in the UI font.
 */
export function Wordmark() {
  return (
    <div role="img" aria-label="Zorvo" className="flex items-center gap-2.5 text-fg">
      <svg
        viewBox="0 0 40 40"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-7 shrink-0"
      >
        <path d="M6 7l10 7-10 7" />
        <path d="M18 19l10 7-10 7" />
        <path d="M30 33h5" />
      </svg>
      <span aria-hidden="true" className="text-[28px] leading-7 font-semibold tracking-[-0.04em]">
        zorvo
      </span>
    </div>
  );
}
