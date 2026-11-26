import { ARTIFACT_GUIDE } from './artifacts';
import { CANVAS_GUIDE } from './canvas';
import { MOTION_GUIDE } from './motion';
import { VISUAL_GUIDE } from './visuals';
import { parseSystemList, systemsLine } from './design-systems';

/** The guide `artifact_guide` answers for each kind; any other kind gets the page guide. */
const GUIDES = new Map<string, string>([
  ['canvas', CANVAS_GUIDE],
  ['visual', VISUAL_GUIDE],
  ['motion', MOTION_GUIDE],
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
