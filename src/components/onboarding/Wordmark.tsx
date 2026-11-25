import { ZorvoSymbol } from "../ui/ZorvoSymbol";

/**
 * The Zorvo lockup: the double-prompt symbol (docs/brand/assets/zorvo-symbol.svg, in currentColor)
 * beside `zorvo` at 28px, 600, -0.04em, as the welcome screen draws it (56px over a new session). The brand brief's own face is
 * not shipped (the app uses the system font, and a test keeps that face out), so it is set in the UI font.
 */
const SIZES = {
  md: { gap: "gap-2.5", symbol: "size-7", text: "text-[28px] leading-7" },
  // Over a new session, where the lockup is the page's one focal point and the card under it is wide.
  lg: { gap: "gap-4", symbol: "size-14", text: "text-[56px] leading-14" },
} as const;

export function Wordmark({ size = "md" }: { size?: keyof typeof SIZES }) {
  const look = SIZES[size];
  return (
    <div role="img" aria-label="Zorvo" className={`flex items-center ${look.gap} text-fg`}>
      <ZorvoSymbol className={`${look.symbol} shrink-0`} />
      <span aria-hidden="true" className={`${look.text} font-semibold tracking-[-0.04em]`}>
        zorvo
      </span>
    </div>
  );
}
