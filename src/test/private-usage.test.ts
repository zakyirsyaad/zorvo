import { describe, expect, it } from "vitest";
import {
  formatUsageCredits,
  parsePrivateSessionUsage,
  privateUsageLabel,
  privateUsageRows,
  usageLead,
} from "../lib/private-usage";
import { turnsFor } from "../lib/private-credits";
import type { Session } from "../types";

const MODEL = { id: "Qwen/Qwen3.8-27B", inputPerM: 0.04, outputPerM: 1.35 };
const GLM = { id: "zai/GLM-5.3-Flash", inputPerM: 0.1, outputPerM: 0.2 };

function session(id: string, profileId: string, modelId: string, credits: number): Session {
  return {
    id,
    name: "Private review",
    profileId,
    cwd: "/w",
    status: "running",
    createdAt: 1,
    transport: "acp",
    privateMode: { modelId },
    privateUsage: { credits, estimated: false },
  };
}

describe("private usage", () => {
  it("parses only a finite non-negative total and a boolean estimate", () => {
    expect(parsePrivateSessionUsage({ credits: 3.2, estimated: true, calls: 2 })).toEqual({
      credits: 3.2,
      estimated: true,
      calls: 2,
    });
    for (const value of [null, {}, { credits: -1, estimated: false }, { credits: 1 }, { credits: "1", estimated: false }]) {
      expect(parsePrivateSessionUsage(value)).toBeNull();
    }
  });

  it("formats a total to one decimal and adds about while estimated", () => {
    expect(formatUsageCredits(3.14)).toBe("3.1 credits");
    expect(formatUsageCredits(34)).toBe("34 credits");
    expect(formatUsageCredits(1)).toBe("1 credit");
    expect(usageLead(3.14, true)).toBe("about 3.1 credits");
    expect(usageLead(3.14, false)).toBe("3.1 credits");
  });

  it("groups persisted totals by model and uses the live balance for turns left", () => {
    const rows = privateUsageRows(
      [
        session("s-1", "qwen-code", MODEL.id, 210),
        session("s-2", "qwen-code", MODEL.id, 50),
        session("s-3", "qwen-code", GLM.id, 0),
      ],
      [MODEL, GLM],
      1_240,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ modelId: MODEL.id, credits: 260, turnsLeft: turnsFor(1_240, MODEL) });
    expect(privateUsageLabel(rows[0], () => "Qwen Code")).toBe("Qwen Code · Qwen 3.8 27B");
  });

  it("shows two models with no turns left when their prices are unknown", () => {
    const rows = privateUsageRows(
      [session("s-1", "qwen-code", MODEL.id, 210), session("s-2", "qwen-code", GLM.id, 50)],
      null,
      null,
    );

    expect(rows.map((row) => row.modelId)).toEqual([MODEL.id, GLM.id]);
    expect(rows.every((row) => row.turnsLeft === null)).toBe(true);
  });
});