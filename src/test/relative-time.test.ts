import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatShortTime } from "../lib/relative-time";

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const secondsAgo = (seconds: number) => NOW - seconds * 1000;

describe("formatRelativeTime", () => {
  it("says Just now under a minute", () => {
    expect(formatRelativeTime(secondsAgo(59), NOW)).toBe("Just now");
  });

  it("turns a minute at 60 seconds", () => {
    expect(formatRelativeTime(secondsAgo(60), NOW)).toBe("1 minute ago");
  });

  it("keeps counting minutes up to 59", () => {
    expect(formatRelativeTime(secondsAgo(59 * 60), NOW)).toBe("59 minutes ago");
  });

  it("turns an hour at 60 minutes", () => {
    expect(formatRelativeTime(secondsAgo(60 * 60), NOW)).toBe("1 hour ago");
  });

  it("keeps counting hours up to 23", () => {
    expect(formatRelativeTime(secondsAgo(23 * 60 * 60), NOW)).toBe("23 hours ago");
  });

  it("turns a day at 24 hours", () => {
    expect(formatRelativeTime(secondsAgo(24 * 60 * 60), NOW)).toBe("1 day ago");
  });

  it("pluralizes minutes and days", () => {
    expect(formatRelativeTime(secondsAgo(5 * 60), NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(secondsAgo(3 * 24 * 60 * 60), NOW)).toBe("3 days ago");
  });

  it("says Just now for a timestamp in the future", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("Just now");
  });
});

describe("formatShortTime", () => {
  const now = new Date(2026, 10, 13, 12, 0).getTime();

  it("says now under a minute and for a clock that ran ahead", () => {
    expect(formatShortTime(now - 20_000, now)).toBe("now");
    expect(formatShortTime(now + 60_000, now)).toBe("now");
  });

  it("counts minutes under an hour", () => {
    expect(formatShortTime(now - 5 * 60_000, now)).toBe("5 min ago");
  });

  it("counts hours within the same calendar day", () => {
    expect(formatShortTime(now - 2 * 3_600_000, now)).toBe("2 h ago");
  });

  it("says Yesterday for the calendar day before, however few hours ago", () => {
    expect(formatShortTime(new Date(2026, 10, 12, 23, 0).getTime(), now)).toBe("Yesterday");
    const early = new Date(2026, 10, 13, 0, 30).getTime();
    expect(formatShortTime(new Date(2026, 10, 12, 23, 0).getTime(), early)).toBe("Yesterday");
  });

  it("uses the month and day within the year, and adds the year before it", () => {
    expect(formatShortTime(new Date(2026, 9, 28, 9, 0).getTime(), now)).toBe("Oct 28");
    expect(formatShortTime(new Date(2025, 9, 28, 9, 0).getTime(), now)).toBe("Oct 28, 2025");
  });
});
