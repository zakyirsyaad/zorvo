import guide from './motion-guide.md?raw';

/** What `artifact_guide` answers for `kind: "motion"`: how to make a video Zorvo renders. */
export const MOTION_GUIDE: string = guide;

/** Emitted by the backend with a job's state whenever a motion render moves on. */
export const MOTION_RENDER_EVENT = 'motion-render';

/**
 * The sentences the backend refuses a motion or a video with: they name no path and repeat
 * nothing the agent sent, so they are passed on. A parse error of `motion.json` (`<field>: <rule>`)
 * is passed on too. A test keeps these equal to the Rust.
 */
export const MOTION_REFUSALS: ReadonlySet<string> = new Set([
  'The motion must be a folder with a motion.json inside this folder.',
  'This session already has 50 motions. The user can remove one in Zorvo.',
  'This session already has 100 videos. The user can remove one in Zorvo.',
  'The video must be an .mp4, .mov or .m4v file inside this folder.',
  'Give the video a title the first time you show it.',
  'Zorvo writes renders to the out folder, and out is not a folder.',
]);

export const MOTION_PARSE_ERROR = /^[A-Za-z0-9_.[\]]*: [^\n]{1,300}$/;

const MOTION_KEY = /^m-[0-9a-f]{16}$/;
const VIDEO_KEY = /^v-[0-9a-f]{16}$/;
const JOB_ID = /^r-[0-9a-f]{16}$/;

export const isMotionKey = (key: unknown): key is string => typeof key === 'string' && MOTION_KEY.test(key);
export const isVideoKey = (key: unknown): key is string => typeof key === 'string' && VIDEO_KEY.test(key);

export interface MotionEntry {
  key: string;
  folder: string;
  relative: string;
  title: string;
  shownAt: number;
  duration: number;
  formats: string[];
}

export interface VideoEntry {
  key: string;
  path: string;
  relative: string;
  title: string;
  shownAt: number;
}

export interface FormatState {
  id: string;
  width: number;
  height: number;
  hasRender: boolean;
  isUpToDate: boolean;
}

export type JobState = 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled';

export interface FormatProgress {
  id: string;
  frame: number;
  total: number;
  file: string | null;
}

export interface JobView {
  job: string;
  sessionId: string;
  key: string;
  state: JobState;
  formats: FormatProgress[];
  error: string | null;
  byUser: boolean;
  saved: number;
}

export interface MotionRead {
  entry: MotionEntry;
  title: string;
  duration: number;
  fps: number;
  poster: number;
  tracks: number;
  formats: FormatState[];
  jobs: JobView[];
  error: string | null;
  warnings: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isString = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);

export function parseMotionEntry(value: unknown): MotionEntry | null {
  if (!isObject(value)) return null;
  const { key, folder, relative, title, shownAt, duration, formats } = value;
  if (!isMotionKey(key) || !isString(folder) || !isString(relative) || !isString(title) || !isNumber(shownAt) || !isNumber(duration)) return null;
  return { key, folder, relative, title, shownAt, duration, formats: strings(formats) };
}

export function parseVideoEntry(value: unknown): VideoEntry | null {
  if (!isObject(value)) return null;
  const { key, path, relative, title, shownAt } = value;
  if (!isVideoKey(key) || !isString(path) || !isString(relative) || !isString(title) || !isNumber(shownAt)) return null;
  return { key, path, relative, title, shownAt };
}

function parseList<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = parse(entry);
    return parsed === null ? [] : [parsed];
  });
}

export const parseMotionEntries = (value: unknown): MotionEntry[] => parseList(value, parseMotionEntry);
export const parseVideoEntries = (value: unknown): VideoEntry[] => parseList(value, parseVideoEntry);

const JOB_STATES: readonly JobState[] = ['queued', 'rendering', 'done', 'failed', 'cancelled'];

function parseProgress(value: unknown): FormatProgress | null {
  if (!isObject(value)) return null;
  const { id, frame, total, file } = value;
  if (!isString(id) || !isNumber(frame) || !isNumber(total)) return null;
  return { id, frame, total, file: isString(file) ? file : null };
}

export function parseJobView(value: unknown): JobView | null {
  if (!isObject(value)) return null;
  const { job, sessionId, key, state, formats, error, byUser, saved } = value;
  if (!isString(job) || !JOB_ID.test(job) || !isString(sessionId) || !isMotionKey(key)) return null;
  if (!JOB_STATES.includes(state as JobState)) return null;
  return {
    job,
    sessionId,
    key,
    state: state as JobState,
    formats: parseList(formats, parseProgress),
    error: isString(error) ? error : null,
    byUser: byUser === true,
    saved: isNumber(saved) ? saved : 0,
  };
}

function parseFormatState(value: unknown): FormatState | null {
  if (!isObject(value)) return null;
  const { id, width, height, hasRender, isUpToDate } = value;
  if (!isString(id) || !isNumber(width) || !isNumber(height)) return null;
  return { id, width, height, hasRender: hasRender === true, isUpToDate: isUpToDate === true };
}

export function parseMotionRead(value: unknown): MotionRead | null {
  if (!isObject(value)) return null;
  const entry = parseMotionEntry(value.entry);
  const { title, duration, fps, poster, tracks } = value;
  if (entry === null || !isString(title) || !isNumber(duration)) return null;
  return {
    entry,
    title,
    duration,
    fps: isNumber(fps) ? fps : 0,
    poster: isNumber(poster) ? poster : 0,
    tracks: isNumber(tracks) ? tracks : 0,
    formats: parseList(value.formats, parseFormatState),
    jobs: parseList(value.jobs, parseJobView),
    error: isString(value.error) ? value.error : null,
    warnings: strings(value.warnings),
  };
}

/** What the agent is told after it showed a motion. */
export function motionResultText(read: MotionRead): string {
  return JSON.stringify({
    shown: true,
    motion: read.entry.key,
    duration: read.duration,
    formats: read.formats.map((format) => format.id),
    ...(read.warnings.length > 0 ? { warnings: read.warnings } : {}),
    next: 'Check stills with render_motion and frames, then render the MP4 with render_motion and follow it with render_status.',
  });
}

/** What the agent is told after it showed a video. */
export function videoResultText(entry: VideoEntry): string {
  return JSON.stringify({ shown: true, video: entry.key, title: entry.title });
}

/** "0:04.5": minutes, seconds and tenths. */
export function formatClock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** "15 s", "1 min 20 s". */
export function durationLabel(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  const rest = whole % 60;
  return rest === 0 ? `${Math.floor(whole / 60)} min` : `${Math.floor(whole / 60)} min ${rest} s`;
}

/** "Video · 15 s · 2 formats". */
export function motionDetail(duration: number, formats: number): string {
  return ['Video', durationLabel(duration), `${formats} ${formats === 1 ? 'format' : 'formats'}`].join(' · ');
}

/** One line on a job: "Rendering wide · 40%", "Waiting to render", "Rendered", "Render failed". */
export function jobLine(job: JobView): string {
  switch (job.state) {
    case 'queued':
      return 'Waiting to render';
    case 'rendering': {
      const current = job.formats.find((format) => format.frame < format.total) ?? job.formats[job.formats.length - 1];
      if (!current) return 'Rendering';
      const percent = current.total > 0 ? Math.floor((current.frame / current.total) * 100) : 0;
      return `Rendering ${current.id} · ${percent}%`;
    }
    case 'done':
      return job.byUser ? `Saved ${job.saved} ${job.saved === 1 ? 'video' : 'videos'}` : 'Rendered';
    case 'failed':
      return 'Render failed';
    case 'cancelled':
      return 'Render cancelled';
  }
}

/** Whether a job still runs or waits. */
export const isOpenJob = (job: JobView): boolean => job.state === 'queued' || job.state === 'rendering';
