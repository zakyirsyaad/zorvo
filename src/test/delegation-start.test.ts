import { describe, expect, it } from "vitest";
import { NO_CHOICES } from "../lib/acp-draft";
import { delegatedStartOf, delegationChoicesFor, mergeChoices } from "../lib/delegation-start";

describe("mergeChoices", () => {
  it("lets the later picks win and merges config values by id", () => {
    const merged = mergeChoices(
      { modelId: "a", modeId: "plan", config: { effort: "low", fast: "on" } },
      { modelId: "b", config: { effort: "high" } },
    );

    expect(merged).toEqual({ modelId: "b", modeId: "plan", config: { effort: "high", fast: "on" } });
  });
});

describe("delegationChoicesFor", () => {
  it("keeps the picks as they are for an agent with no known options", () => {
    const picks = { modelId: "gpt", config: {} };

    expect(delegationChoicesFor(undefined, picks)).toEqual(picks);
    expect(delegationChoicesFor(undefined)).toEqual(NO_CHOICES);
  });
});

describe("delegatedStartOf", () => {
  it("knows nothing about an agent that never reported", () => {
    expect(delegatedStartOf(undefined)).toEqual({});
  });
});
