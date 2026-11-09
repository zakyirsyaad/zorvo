import { describe, expect, it } from "vitest";
import { privateOpenOutcome, privateTurnRefusal } from "../hooks/session-engine/private-engine";

const EMPTY = 'PRIVATE_CREDITS:{"reason":"empty"}';

describe("private-engine refusals", () => {
  it("words a 402 on a capped session as the session limit, not as credits running out", () => {
    expect(privateTurnRefusal(EMPTY, 200)).toEqual({ creditsOut: "session_limit" });
    expect(privateOpenOutcome(EMPTY, true, true, 200)).toEqual({ creditsOut: "session_limit" });
  });

  it("keeps an uncapped session's 402 as credits running out", () => {
    expect(privateTurnRefusal(EMPTY)).toEqual({ creditsOut: "empty" });
    expect(privateOpenOutcome(EMPTY, true, true)).toEqual({ creditsOut: "empty" });
  });

  it("keeps a refused key apart from a cap", () => {
    expect(privateTurnRefusal('PRIVATE_CREDITS:{"reason":"key"}', 200)).toEqual({ creditsOut: "key" });
  });
});