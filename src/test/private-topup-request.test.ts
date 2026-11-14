import { describe, expect, it } from "vitest";
import { parsePrivateTopupRequest } from "../lib/private-topup-request";

const REQUEST = {
  sessionId: "s-1",
  requestId: "r-1",
  usd: 5,
  credits: 500,
  reason: "The review needs more credits.",
};

describe("parsePrivateTopupRequest", () => {
  it("accepts the event payload the backend sends", () => {
    expect(parsePrivateTopupRequest(REQUEST)).toEqual(REQUEST);
  });

  it("rejects a payload with a missing or unusable field", () => {
    for (const value of [
      null,
      "request",
      {},
      { ...REQUEST, sessionId: "" },
      { ...REQUEST, requestId: "" },
      { ...REQUEST, usd: 0 },
      { ...REQUEST, usd: 2.5 },
      { ...REQUEST, credits: -1 },
      { ...REQUEST, credits: Number.NaN },
      { ...REQUEST, reason: 5 },
    ]) {
      expect(parsePrivateTopupRequest(value)).toBeNull();
    }
  });

  it("caps the reason so a malformed sender cannot draw more", () => {
    const parsed = parsePrivateTopupRequest({ ...REQUEST, reason: "a".repeat(250) });

    expect(parsed?.reason).toHaveLength(200);
  });
});