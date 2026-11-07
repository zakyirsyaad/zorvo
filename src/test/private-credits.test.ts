import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_USD_COST,
  PRIVATE_CREDITS_PREFIX,
  PRIVATE_ERROR_CODES,
  actionError,
  TURN_INPUT_TOKENS,
  TURN_OUTPUT_TOKENS,
  creditsPerTurn,
  formatCredits,
  modelLabel,
  packageReason,
  parsePrivateCredits,
  perTurnLabel,
  privateErrorText,
  turnsFor,
  updatedAgo,
  type ModelPrice,
} from "../lib/private-credits";

const FALLBACK = "Something went wrong. Try again.";
const model = (inputPerM: number, outputPerM: number): ModelPrice => ({ id: "Qwen/Qwen3.8-27B", inputPerM, outputPerM });

describe("turn constants", () => {
  it("fixes the assumed turn and the credits per dollar of cost", () => {
    expect(TURN_INPUT_TOKENS).toBe(20_000);
    expect(TURN_OUTPUT_TOKENS).toBe(1_000);
    expect(CREDITS_PER_USD_COST).toBe(120);
  });
});

describe("creditsPerTurn and turnsFor", () => {
  it("prices one turn in credits", () => {
    expect(creditsPerTurn(model(3.3, 16.5))).toBeCloseTo(9.9, 10);
  });

  it("floors the number of turns a balance buys", () => {
    expect(turnsFor(100, model(3.3, 16.5))).toBe(10);
    expect(turnsFor(99, model(3.3, 16.5))).toBe(10);
    expect(turnsFor(98, model(3.3, 16.5))).toBe(9);
  });

  it("returns 0 turns for a free model, an empty balance or a negative one", () => {
    expect(turnsFor(100, model(0, 0))).toBe(0);
    expect(turnsFor(0, model(3.3, 16.5))).toBe(0);
    expect(turnsFor(-5, model(3.3, 16.5))).toBe(0);
  });
});

describe("modelLabel", () => {
  it("keeps the part after the last slash and turns hyphens into spaces", () => {
    expect(modelLabel("Qwen/Qwen3.8-27B")).toBe("Qwen3.8 27B");
    expect(modelLabel("a/b/Some-Model-1")).toBe("Some Model 1");
    expect(modelLabel("plain-id")).toBe("plain id");
  });

  it("falls back to the whole id when nothing follows the last slash", () => {
    expect(modelLabel("a/")).toBe("a/");
    expect(modelLabel("")).toBe("");
  });
});

describe("formatCredits", () => {
  it("groups thousands and uses the singular for one", () => {
    expect(formatCredits(1240)).toBe("1,240 credits");
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(0)).toBe("0 credits");
  });
});

describe("perTurnLabel", () => {
  it("rounds under one credit to one decimal", () => {
    expect(perTurnLabel(model(0.1, 0.5))).toBe("≈ 0.3 credit a turn");
  });

  it("rounds from one credit up to a whole number", () => {
    expect(perTurnLabel(model(3.3, 16.5))).toBe("≈ 10 credits a turn");
    expect(perTurnLabel(model(2.7, 13.5))).toBe("≈ 8 credits a turn");
  });

  it("names no plural credits for a fraction, and none at all for a free model", () => {
    expect(perTurnLabel(model(0.3, 1.5))).toBe("≈ 0.9 credit a turn");
    expect(perTurnLabel(model(0, 0))).toBe("≈ 0 credits a turn");
  });

  it("uses the singular when it rounds to exactly one", () => {
    expect(perTurnLabel(model(0.4, 2.0))).toBe("≈ 1 credit a turn"); // 1.2 credits
    expect(perTurnLabel(model(0.33, 1.65))).toBe("≈ 1 credit a turn"); // 0.99 credit
  });
});

describe("perTurnLabel boundaries", () => {
  // Output-only price: credits per turn = outputPerM * 0.12.
  const costing = (credits: number): ModelPrice => model(0, credits / 0.12);

  it("never reads as free for a model that costs something", () => {
    expect(perTurnLabel(model(0.01, 0.02))).toBe("< 0.1 credit a turn");
    expect(perTurnLabel(costing(0.0264))).toBe("< 0.1 credit a turn");
    expect(perTurnLabel(costing(0.04))).toBe("< 0.1 credit a turn");
  });

  it.each([
    [0.05, "≈ 0.1 credit a turn"],
    [0.95, "≈ 1 credit a turn"],
    [0.96, "≈ 1 credit a turn"],
    [1.49, "≈ 1 credit a turn"],
    [1.5, "≈ 2 credits a turn"],
    [1.96, "≈ 2 credits a turn"],
    [2, "≈ 2 credits a turn"],
  ])("words %s credits a turn as %s", (credits, label) => {
    expect(perTurnLabel(costing(credits))).toBe(label);
  });

  it("prints 0 credits only for a model that costs nothing", () => {
    expect(perTurnLabel(model(0, 0))).toBe("≈ 0 credits a turn");
    for (const credits of [0.0264, 0.04, 0.05, 0.95, 0.96, 1.49, 1.5, 1.96, 2]) {
      expect(perTurnLabel(costing(credits))).not.toContain("0 credits");
    }
  });
});

describe("non-finite and negative input", () => {
  const bad = [model(Number.NaN, 1), model(1, Number.POSITIVE_INFINITY), model(-1, 1), model(1, -5), model(Number.MAX_VALUE, Number.MAX_VALUE)];

  it("prices such a model at 0 credits a turn, never NaN or Infinity", () => {
    for (const price of bad) {
      expect(creditsPerTurn(price)).toBe(0);
      expect(turnsFor(100, price)).toBe(0);
      expect(perTurnLabel(price)).toBe("≈ 0 credits a turn");
    }
  });

  it("formats a non-finite or negative amount as 0 credits", () => {
    expect(formatCredits(Number.NaN)).toBe("0 credits");
    expect(formatCredits(Number.POSITIVE_INFINITY)).toBe("0 credits");
    expect(formatCredits(-3)).toBe("0 credits");
  });

  it("returns 0 turns for a non-finite balance", () => {
    expect(turnsFor(Number.POSITIVE_INFINITY, model(3.3, 16.5))).toBe(0);
    expect(turnsFor(Number.NaN, model(3.3, 16.5))).toBe(0);
  });
});

describe("packageReason", () => {
  it("words the reasons a package is off", () => {
    expect(packageReason("stock")).toBe("Not enough stock right now");
    expect(packageReason("device_cap")).toBe("Over your 5,000-credit limit");
  });

  it("says nothing for no reason or an unknown one", () => {
    expect(packageReason()).toBeUndefined();
    expect(packageReason("other")).toBeUndefined();
    expect(packageReason("constructor")).toBeUndefined();
  });
});

describe("updatedAgo", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");

  it("reads just now under a minute", () => {
    expect(updatedAgo("2026-11-07T11:59:30Z", now)).toBe("Updated just now");
  });

  it("abbreviates minutes", () => {
    expect(updatedAgo("2026-11-07T11:58:30Z", now)).toBe("Updated 1 min ago");
    expect(updatedAgo("2026-11-07T11:55:00Z", now)).toBe("Updated 5 min ago");
  });

  it("keeps hours and days as the shared helper words them", () => {
    expect(updatedAgo("2026-11-07T10:00:00Z", now)).toBe("Updated 2 hours ago");
    expect(updatedAgo("2026-11-05T12:00:00Z", now)).toBe("Updated 2 days ago");
  });

  it("does not guess for a timestamp it cannot read", () => {
    expect(updatedAgo("not a date", now)).toBe("Updated recently");
  });
});

describe("parsePrivateCredits", () => {
  it("reads the marker and its reason", () => {
    expect(PRIVATE_CREDITS_PREFIX).toBe("PRIVATE_CREDITS:");
    expect(parsePrivateCredits('PRIVATE_CREDITS:{"reason":"empty"}')).toEqual({ reason: "empty" });
    expect(parsePrivateCredits('PRIVATE_CREDITS:{"reason":"key"}')).toEqual({ reason: "key" });
  });

  it("reads an Error and an object with a message", () => {
    expect(parsePrivateCredits(new Error('PRIVATE_CREDITS:{"reason":"empty"}'))).toEqual({ reason: "empty" });
    expect(parsePrivateCredits({ message: 'PRIVATE_CREDITS:{"reason":"key"}' })).toEqual({ reason: "key" });
  });

  it("tolerates whitespace around the string", () => {
    expect(parsePrivateCredits('  PRIVATE_CREDITS:{"reason":"key"}\n')).toEqual({ reason: "key" });
  });

  it("returns null for another reason or a malformed tail", () => {
    expect(parsePrivateCredits('PRIVATE_CREDITS:{"reason":"x"}')).toBeNull();
    expect(parsePrivateCredits("PRIVATE_CREDITS:{oops")).toBeNull();
    expect(parsePrivateCredits("PRIVATE_CREDITS:")).toBeNull();
    expect(parsePrivateCredits("PRIVATE_CREDITS:null")).toBeNull();
    expect(parsePrivateCredits('PRIVATE_CREDITS:{"reason":"empty"} trailing')).toBeNull();
  });

  it("requires the marker at the start", () => {
    expect(parsePrivateCredits('oops PRIVATE_CREDITS:{"reason":"key"}')).toBeNull();
  });

  it("returns null for values that are not errors", () => {
    expect(parsePrivateCredits(undefined)).toBeNull();
    expect(parsePrivateCredits(null)).toBeNull();
    expect(parsePrivateCredits(42)).toBeNull();
    expect(parsePrivateCredits({ message: 3 })).toBeNull();
    expect(parsePrivateCredits("some other error")).toBeNull();
  });
});

describe("privateErrorText", () => {
  const exact: Array<[string, string]> = [
    ["unreachable", "Couldn't reach the credits server."],
    ["unauthorized", "Your credits moved to another Mac."],
    ["stock", "Top-ups are paused for now."],
    ["device_cap", "That would take you over your 5,000-credit limit."],
    ["rate_limited", "Too many tries. Wait a few minutes and try again."],
    ["bad_code", "That code didn't work. Check it and try again."],
    ["bad_request", "That didn't work. Check what you typed and try again."],
    ["keychain", "Couldn't save your key in the Keychain. Restore with your recovery code to get a new one."],
    ["key_lost", "Your private key didn't reach this Mac. Restore with your recovery code to get a new one."],
    ["bad_checkout_url", "Couldn't open checkout. Nothing was held or charged."],
    ["upstream", "Couldn't open checkout. Nothing was held or charged."],
    ["open_failed", "Couldn't open your browser. Your checkout is ready: open it again, or cancel."],
    ["unknown_model", "That model isn't offered anymore. Start a new private session to pick another."],
    ["has_own_credits", "This Mac has credits of its own. Restoring another code here would lose access to them."],
    ["no_device", "This Mac has no private credits yet."],
    ["no_key", "This Mac has no private credits yet."],
    ["storage", "Couldn't save your settings on this Mac. Try again."],
    ["private_session", "This session ran privately. Reopen it as a private session."],
    ["not_qwen", "Private sessions run Qwen Code only for now."],
    ["not_found", FALLBACK],
  ];

  it.each(exact)("words %s", (code, text) => {
    expect(privateErrorText(code)).toBe(text);
  });

  it("falls back for an unknown string, including object prototype names", () => {
    expect(privateErrorText("brand_new_code")).toBe(FALLBACK);
    expect(privateErrorText("")).toBe(FALLBACK);
    expect(privateErrorText("constructor")).toBe(FALLBACK);
    expect(privateErrorText("toString")).toBe(FALLBACK);
  });

  it("lists every Rust code, each with its own text except not_found", () => {
    expect([...PRIVATE_ERROR_CODES].sort()).toEqual(
      [
        "unreachable", "unauthorized", "bad_request", "not_found", "stock", "device_cap", "rate_limited",
        "upstream", "keychain", "no_device", "no_key", "key_lost", "bad_code", "not_qwen", "unknown_model",
        "bad_checkout_url", "has_own_credits", "storage", "open_failed", "private_session",
      ].sort(),
    );
    for (const code of PRIVATE_ERROR_CODES) {
      if (code === "not_found") expect(privateErrorText(code)).toBe(FALLBACK);
      else expect(privateErrorText(code)).not.toBe(FALLBACK);
    }
  });
});

describe("actionError", () => {
  it("keeps the normal text for unauthorized in every action", () => {
    for (const action of ["models", "cancel", "redeem", "forget", "recover"] as const) {
      expect(actionError(action, "unauthorized")).toBe(privateErrorText("unauthorized"));
    }
  });

  it("never claims a checkout was not held or charged outside a checkout", () => {
    for (const action of ["models", "cancel", "redeem", "forget", "recover"] as const) {
      expect(actionError(action, "upstream")).not.toContain("Nothing was held or charged");
    }
    for (const action of ["models", "cancel"] as const) {
      for (const code of PRIVATE_ERROR_CODES) {
        expect(actionError(action, code)).not.toContain("Nothing was held or charged");
      }
    }
  });

  it("words a models failure as a models failure", () => {
    expect(actionError("models", "upstream")).toBe("Couldn't load the private models. Try again.");
    expect(actionError("models", "unreachable")).toBe("Couldn't load the private models. Try again.");
  });

  it("words a packages failure as a packages failure, and keeps unauthorized", () => {
    expect(actionError("stock", "upstream")).toBe("Couldn't load the packages. Try again.");
    expect(actionError("stock", "unreachable")).toBe("Couldn't load the packages. Try again.");
    expect(actionError("stock", "unauthorized")).toBe(privateErrorText("unauthorized"));
  });

  it("words a cancel failure as a cancel failure", () => {
    expect(actionError("cancel", "upstream")).toBe("Couldn't cancel the checkout. Try again.");
    expect(actionError("cancel", "unreachable")).toBe("Couldn't cancel the checkout. Try again.");
    expect(actionError("cancel", "rate_limited")).toBe("Couldn't cancel the checkout. Try again.");
  });

  it("words a redeem failure of the server as a redeem failure, and keeps the rest", () => {
    expect(actionError("redeem", "upstream")).toBe("Couldn't redeem the code. Try again.");
    expect(actionError("redeem", "unreachable")).toBe("Couldn't redeem the code. Try again.");
    expect(actionError("redeem", "bad_code")).toBe(privateErrorText("bad_code"));
    expect(actionError("redeem", "rate_limited")).toBe(privateErrorText("rate_limited"));
  });

  it("leaves forget and recover with the normal texts", () => {
    expect(actionError("forget", "keychain")).toBe(privateErrorText("keychain"));
    expect(actionError("recover", "upstream")).toBe(FALLBACK);
    expect(actionError("recover", "has_own_credits")).toBe(privateErrorText("has_own_credits"));
  });
});
