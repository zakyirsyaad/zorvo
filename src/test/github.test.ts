import { describe, it, expect } from "vitest";
import { toGithubStatus, GITHUB_CHECK_FAILED } from "../lib/github";

describe("toGithubStatus", () => {
  it("reads each state the backend can answer", () => {
    expect(toGithubStatus({ state: "not-installed", login: null, name: null, message: null })).toEqual({
      state: "not-installed",
      login: undefined,
      name: undefined,
      message: undefined,
      canConnect: true,
    });
    expect(toGithubStatus({ state: "signed-out" }).state).toBe("signed-out");
    expect(toGithubStatus({ state: "unknown", message: "Could not reach GitHub." })).toMatchObject({
      state: "unknown",
      message: "Could not reach GitHub.",
    });
  });

  it("reads the login and the name of a signed-in account, trimmed", () => {
    expect(
      toGithubStatus({ state: "signed-in", login: " octocat ", name: " The Octocat ", message: null, canConnect: true }),
    ).toEqual({
      state: "signed-in",
      login: "octocat",
      name: "The Octocat",
      message: undefined,
      canConnect: true,
    });
  });

  it("offers Connect unless the backend says it cannot help", () => {
    expect(toGithubStatus({ state: "signed-out" }).canConnect).toBe(true);
    expect(toGithubStatus({ state: "unknown", message: "offline", canConnect: true }).canConnect).toBe(true);
    expect(
      toGithubStatus({ state: "unknown", message: "The token in GH_TOKEN was rejected by GitHub.", canConnect: false })
        .canConnect,
    ).toBe(false);
  });

  it("never reads a malformed answer as signed in", () => {
    expect(toGithubStatus(undefined)).toEqual(GITHUB_CHECK_FAILED);
    expect(toGithubStatus(null)).toEqual(GITHUB_CHECK_FAILED);
    expect(toGithubStatus("signed-in")).toEqual(GITHUB_CHECK_FAILED);
    expect(toGithubStatus({ state: "connected" })).toEqual(GITHUB_CHECK_FAILED);
    // Signed in without a login cannot be trusted.
    expect(toGithubStatus({ state: "signed-in", login: "  " })).toEqual(GITHUB_CHECK_FAILED);
  });
});
