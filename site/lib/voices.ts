export interface Voice {
  /** The person's own words, unedited. */
  quote: string;
  /**
   * Words from the quote, exactly as they appear in it, drawn as if selected. Only the first voice shows one,
   * and words the quote does not hold are not drawn.
   */
  highlight?: string;
  name: string;
  /** Their handle where they said it, without the @. */
  handle?: string;
  /** What they do, and where. */
  role: string;
  /** The agents they run in Zorvo, by name. */
  agents?: readonly string[];
  /** Where they said it, for example "Discord", "X", "GitHub" or "Feedback form". */
  source: string;
  /** A link to the place they said it, when it is public. */
  href?: string;
}

/**
 * What people who use Zorvo said about it. Only real quotes go here, with the person's consent:
 * the section does not render while this list is empty. The first is drawn largest.
 */
export const VOICES: readonly Voice[] = [];
