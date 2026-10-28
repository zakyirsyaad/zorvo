import { describe, it, expect } from "vitest";
import { githubDisplayName, toGithubStatus, GITHUB_CHECK_FAILED } from "../lib/github";

describe("toGithubStatus", () => {
  it("reads each state the backend can answer", () => {
    expect(toGithubStatus({ state: "not-installed", login: null, name: null, message: null })).toEqual({
      state: "not-installed",
      login: undefined,
      name: undefined,
      message: undefined,
    });
    expect(toGithubStatus({ state: "signed-out" }).state).toBe("signed-out");
    expect(toGithubStatus({ state: "unknown", message: "Could not reach GitHub." })).toMatchObject({
      state: "unknown",
      message: "Could not reach GitHub.",
    });
  });

  it("reads the login and the name of a signed-in account, trimmed", () => {
    expect(toGithubStatus({ state: "signed-in", login: " octocat ", name: " The Octocat ", message: null })).toEqual({
      state: "signed-in",
      login: "octocat",
      name: "The Octocat",
      message: undefined,
    });
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

describe("githubDisplayName", () => {
  it("prefers the GitHub name, then @login", () => {
    expect(githubDisplayName({ state: "signed-in", login: "octocat", name: "The Octocat" })).toBe("The Octocat");
    expect(githubDisplayName({ state: "signed-in", login: "octocat" })).toBe("@octocat");
  });

  it("has no name unless someone is signed in", () => {
    expect(githubDisplayName(null)).toBeUndefined();
    expect(githubDisplayName({ state: "signed-out", name: "The Octocat" })).toBeUndefined();
    expect(githubDisplayName({ state: "unknown", login: "octocat" })).toBeUndefined();
  });
});
