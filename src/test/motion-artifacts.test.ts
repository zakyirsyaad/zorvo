import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MOTION_GUIDE,
  MOTION_PARSE_ERROR,
  MOTION_REFUSALS,
  durationLabel,
  formatClock,
  jobLine,
  motionDetail,
  motionResultText,
  parseJobView,
  parseMotionEntries,
  parseMotionRead,
  parseVideoEntry,
  videoResultText,
} from "../lib/motion";
import { cardIdOf, parseArtifactCard } from "../lib/artifacts";

const KEY = "m-0123456789abcdef";
const ENTRY = { key: KEY, folder: "/w/promo", relative: "promo", title: "Promo", shownAt: 3, duration: 15, formats: ["wide", "tall"] };
const JOB = {
  job: "r-0123456789abcdef",
  sessionId: "s-1",
  key: KEY,
  state: "rendering",
  formats: [
    { id: "wide", frame: 900, total: 900, file: "out/wide.mp4" },
    { id: "tall", frame: 450, total: 900, file: null },
  ],
  error: null,
  byUser: false,
  saved: 0,
};
const READ = {
  entry: ENTRY,
  title: "Promo",
  duration: 15,
  fps: 60,
  poster: 5,
  tracks: 1,
  formats: [{ id: "wide", width: 1920, height: 1080, hasRender: true, isUpToDate: false }],
  jobs: [JOB],
  error: null,
  warnings: ["Nothing moves"],
};

describe("motion entries and reads", () => {
  it("keeps valid entries and drops the rest", () => {
    expect(parseMotionEntries([ENTRY, { ...ENTRY, key: "c-0123456789abcdef" }, null])).toEqual([ENTRY]);
    expect(parseVideoEntry({ key: "v-0123456789abcdef", path: "/w/a.mp4", relative: "a.mp4", title: "A", shownAt: 1 })).not.toBeNull();
    expect(parseVideoEntry({ key: "v-1", path: "/w/a.mp4", relative: "a.mp4", title: "A", shownAt: 1 })).toBeNull();
  });

  it("reads a motion with its formats, jobs and warnings", () => {
    const read = parseMotionRead(READ);
    expect(read?.formats[0]).toEqual({ id: "wide", width: 1920, height: 1080, hasRender: true, isUpToDate: false });
    expect(read?.jobs[0].state).toBe("rendering");
    expect(read?.warnings).toEqual(["Nothing moves"]);
    expect(parseMotionRead({ ...READ, entry: null })).toBeNull();
  });

  it("refuses a job of another shape", () => {
    expect(parseJobView({ ...JOB, state: "paused" })).toBeNull();
    expect(parseJobView({ ...JOB, job: "r-x" })).toBeNull();
  });

  it("tells the agent what it showed and what to do next", () => {
    const parsed = JSON.parse(motionResultText(parseMotionRead(READ)!));
    expect(parsed).toMatchObject({ shown: true, motion: KEY, duration: 15, formats: ["wide"], warnings: ["Nothing moves"] });
    expect(parsed.next).toContain("render_motion");
    expect(JSON.parse(videoResultText({ key: "v-0123456789abcdef", path: "/w/a.mp4", relative: "a.mp4", title: "A", shownAt: 1 }))).toEqual({
      shown: true,
      video: "v-0123456789abcdef",
      title: "A",
    });
  });
});

describe("words", () => {
  it("formats the clock and the length", () => {
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(4.54)).toBe("0:04.5");
    expect(formatClock(75.25)).toBe("1:15.3");
    expect(durationLabel(15)).toBe("15 s");
    expect(durationLabel(80)).toBe("1 min 20 s");
    expect(motionDetail(15, 2)).toBe("Video · 15 s · 2 formats");
    expect(motionDetail(6, 1)).toBe("Video · 6 s · 1 format");
  });

  it("says where a job stands", () => {
    const job = parseJobView(JOB)!;
    expect(jobLine(job)).toBe("Rendering tall · 50%");
    expect(jobLine({ ...job, state: "queued" })).toBe("Waiting to render");
    expect(jobLine({ ...job, state: "done", byUser: true, saved: 2 })).toBe("Saved 2 videos");
    expect(jobLine({ ...job, state: "failed" })).toBe("Render failed");
  });
});

describe("cards", () => {
  it("keeps motion and video cards in a transcript", () => {
    const motion = { kind: "motion", motionKey: KEY, title: "Promo", duration: 15, formats: 2 };
    expect(parseArtifactCard(motion)).toEqual(motion);
    expect(cardIdOf(parseArtifactCard(motion)!)).toBe(KEY);
    const video = { kind: "video", videoKey: "v-0123456789abcdef", title: "Reel" };
    expect(cardIdOf(parseArtifactCard(video)!)).toBe("v-0123456789abcdef");
    expect(parseArtifactCard({ ...motion, motionKey: "m-1" })).toBeNull();
  });
});

describe("refusals and guide", () => {
  it("keeps MOTION_REFUSALS equal to the Rust sentences", () => {
    const files = [
      "src-tauri/src/artifacts/motion.rs",
      "src-tauri/src/artifacts/motion_store.rs",
      "src-tauri/src/artifacts/motion_commands.rs",
    ];
    const rust = files.map((file) => readFileSync(file, "utf8")).join("\n");
    const oneLine = rust.replace(/"\s*\n\s*"/g, "").replace(/=\s*\n\s*"/g, '= "');
    for (const refusal of MOTION_REFUSALS) expect(oneLine).toContain(`"${refusal}"`);
    expect(MOTION_REFUSALS.size).toBe(6);
  });

  it("passes a motion.json parse error on", () => {
    expect(MOTION_PARSE_ERROR.test("formats[1].height: must be even")).toBe(true);
    expect(MOTION_PARSE_ERROR.test("motion.json: not valid JSON")).toBe(true);
    expect(MOTION_PARSE_ERROR.test("/Users/me/secret: gone")).toBe(false);
  });

  it("has a guide that names the format, the clock and the tools", () => {
    for (const words of ["motion.json", "onSeek", "render_motion", "render_status", "even", "Silent by default", "kind: \"video\"", "cdnjs.cloudflare.com"]) {
      expect(MOTION_GUIDE).toContain(words);
    }
  });
});
