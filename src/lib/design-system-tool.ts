import { ARTIFACT_GUIDE } from './artifacts';
import { CANVAS_GUIDE } from './canvas';
import { MOTION_GUIDE } from './motion';
import { VISUAL_GUIDE } from './visuals';
import {
  DESIGN_SYSTEM_GUIDE,
  DESIGN_SYSTEM_REFUSALS,
  designSystemResultText,
  parseDesignSystemRead,
  parseSystemList,
  systemsLine,
  type DesignSystemRead,
} from './design-systems';

/** The guide `artifact_guide` answers for each kind; any other kind gets the page guide. */
const GUIDES = new Map<string, string>([
  ['canvas', CANVAS_GUIDE],
  ['visual', VISUAL_GUIDE],
  ['motion', MOTION_GUIDE],
  ['design-system', DESIGN_SYSTEM_GUIDE],
]);

/**
 * What `artifact_guide` answers: the kind's guide, then the line that names the design systems
 * in the session's folder. A visual keeps the chat's colours, so it gets no line and `list` is
 * never asked. A search that fails or answers junk leaves the line out; this never rejects.
 */
export async function guideAnswer(kind: unknown, list: () => Promise<unknown>): Promise<string> {
  const guide = (typeof kind === 'string' ? GUIDES.get(kind) : undefined) ?? ARTIFACT_GUIDE;
  if (kind === 'visual') return guide;
  try {
    const systems = parseSystemList(await list());
    return systems ? `${guide}\n\n${systemsLine(systems)}` : guide;
  } catch {
    return guide;
  }
}

/** How a `show_artifact` with `kind: "design-system"` ended, for the hook to act on. */
export type DesignSystemShown =
  | { ok: true; read: DesignSystemRead; text: string }
  | { ok: false; text: string; notice?: string };

const FAILED = 'Zorvo could not show that design system.';
const NOTICE = 'Zorvo could not show the design system an agent made.';

/**
 * Asks the backend to read and remember the system at `path`. A refusal sentence goes back to
 * the agent as it is; anything else is `FAILED` with a notice for the user, never the error
 * itself, which can name a folder the agent was not told about.
 */
export async function showDesignSystem(show: () => Promise<unknown>): Promise<DesignSystemShown> {
  try {
    const read = parseDesignSystemRead(await show());
    if (read === null) return { ok: false, text: FAILED, notice: NOTICE };
    return { ok: true, read, text: designSystemResultText(read) };
  } catch (error) {
    const text = typeof error === 'string' ? error : '';
    if (DESIGN_SYSTEM_REFUSALS.has(text)) return { ok: false, text };
    return { ok: false, text: FAILED, notice: NOTICE };
  }
}
