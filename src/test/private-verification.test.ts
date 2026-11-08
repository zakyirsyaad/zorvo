import { describe, expect, it } from "vitest";
import {
  foldVerifications,
  shortSigner,
  summarizeVerification,
  VERIFICATION_LABEL,
  type VerificationRecord,
} from "../lib/private-verification";
import type { ChatMessage } from "../types";

const SIGNER = "0x1234567890abcdef1234567890abcdef12345678";

function record(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    startedAt: 1_100,
    endedAt: 1_200,
    state: "verified",
    kind: "provider_tee",
    signer: SIGNER,
    ...overrides,
  };
}

function reply(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "a-1",
    role: "agent",
    content: "Done.",
    timestamp: 1_000,
    completedAt: 2_000,
    isComplete: true,
    ...overrides,
  };
}

describe("summarizeVerification", () => {
  it("reads no records as not signed", () => {
    expect(summarizeVerification([]).state).toBe("not_signed");
  });

  it("calls a reply verified when every call was signed", () => {
    const summary = summarizeVerification([record(), record({ startedAt: 1_300 })]);

    expect(summary).toMatchObject({
      state: "verified",
      kind: "provider_tee",
      signer: SIGNER,
      signed: 2,
      total: 2,
    });
  });

  it("lets one failure beat pending and missing signatures", () => {
    expect(
      summarizeVerification([
        record(),
        record({ state: "checking" }),
        record({ state: "didnt_verify" }),
      ]).state,
    ).toBe("didnt_verify");
  });

  it("stays checking while a call is pending and nothing failed", () => {
    expect(summarizeVerification([record(), record({ state: "checking" })]).state).toBe("checking");
  });

  it("reads a mix of verified and unsigned calls as not signed, with the signed count", () => {
    const summary = summarizeVerification([record(), record({ state: "not_signed" })]);

    expect(summary.state).toBe("not_signed");
    expect(summary.signed).toBe(1);
    expect(summary.total).toBe(2);
  });

  it("does not name a kind or signer when the verified calls disagree", () => {
    const summary = summarizeVerification([
      record(),
      record({ kind: "gateway", signer: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" }),
    ]);

    expect(summary.kind).toBe("unknown");
    expect(summary.signer).toBeUndefined();
  });
});

describe("foldVerifications", () => {
  it("puts a turn's records on its agent reply only", () => {
    const before = reply({ id: "a-0", timestamp: 10, completedAt: 100 });
    const current = reply();
    const user = { id: "u-1", role: "user" as const, content: "Go", timestamp: 1_050 };

    const folded = foldVerifications([before, user, current], [record()]);

    expect(folded[0].verification).toBeUndefined();
    expect(folded[1].verification).toBeUndefined();
    expect(folded[2].verification).toMatchObject({ state: "verified", signed: 1, total: 1 });
  });

  it("leaves replies with no records, an unknown time or no end time alone", () => {
    const noRecords = reply({ id: "a-empty", timestamp: 3_000, completedAt: 4_000 });
    const replayed = reply({ id: "a-replayed", hasKnownTime: false });
    const unfinished = reply({ id: "a-open", completedAt: undefined });

    const folded = foldVerifications([noRecords, replayed, unfinished], [record()]);

    expect(folded[0].verification).toBeUndefined();
    expect(folded[1].verification).toBeUndefined();
    expect(folded[2].verification).toBeUndefined();
  });

  it("keeps message identity when a record does not reach it", () => {
    const message = reply({ id: "a-other", timestamp: 5_000, completedAt: 6_000 });

    expect(foldVerifications([message], [record()])[0]).toBe(message);
  });
});

describe("verification copy", () => {
  it("names the four states", () => {
    expect(VERIFICATION_LABEL.verified).toBe("Verified in TEE");
    expect(VERIFICATION_LABEL.didnt_verify).toBe("Didn't verify");
    expect(VERIFICATION_LABEL.not_signed).toBe("Not signed");
    expect(VERIFICATION_LABEL.checking).toBe("Checking the signature");
  });

  it("shortens a long signer and leaves a short one as it is", () => {
    expect(shortSigner(SIGNER)).toBe("0x1234…5678");
    expect(shortSigner("0x1234")).toBe("0x1234");
  });
});