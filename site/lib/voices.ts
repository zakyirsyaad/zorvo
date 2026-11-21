export interface Voice {
  /** The person's own words, unedited. */
  quote: string;
  name: string;
  /** What they do, and where. */
  role: string;
  /** Where they said it, for example "Discord" or "GitHub". */
  source: string;
  /** A link to the place they said it, when it is public. */
  href?: string;
}

/**
 * What people who use Zorvo said about it. Only real quotes go here, with the person's consent:
 * the section does not render while this list is empty. The first is drawn largest.
 */
export const VOICES: readonly Voice[] = [];
