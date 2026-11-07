import { describe, expect, it } from "vitest";
import { parseConfig, type Env } from "../src/config";
import { balanceCredits, creditsForPackage, creditsFromNano, creditsLeft, spendLimitNano, usdcAmount } from "../src/credits";

// The same values as the vars in wrangler.jsonc.
const env = {
  CREDITS_PER_USD_PAID: "100",
  BURN_PER_USD_COST: "120",
  PACKAGES_USD: "5,10,25",
  DEVICE_CAP_CREDITS: "5000",
  STOCK_BUFFER_NANO: "2000000000",
  MODELS: "Qwen/Qwen3.8-27B,z-ai/glm-5.3",
  WORKSPACE_ID: "ws_1",
  ORGANIZATION_ID: "org_1",
  OPERATOR_ACCOUNT: "operator.near",
  NEAR_AI_BASE: "https://cloud-api.near.ai/v1",
  PINGPAY_BASE: "https://pay.pingpay.io/api",
} as unknown as Env;
const cfg = parseConfig(env);

describe("credit math", () => {
  it("prices packages at 100 credits per dollar", () => {
    expect([5, 10, 25].map((u) => creditsForPackage(u, cfg))).toEqual([500, 1000, 2500]);
  });
  it("never rounds a spend limit up", () => {
    expect(spendLimitNano(500, cfg)).toBe(4_166_666_666n);
  });
  it("counts what is left after a rotation without rounding it up", () => {
    expect(creditsLeft(500, 0n, cfg)).toBe(500);
    // 0.99 and 0.01 of a credit used both cost a whole credit.
    expect(creditsLeft(500, 8_250_000n, cfg)).toBe(499);
    expect(creditsLeft(500, 83_334n, cfg)).toBe(499);
    expect(creditsLeft(500, 4_166_666_667n, cfg)).toBe(0);
    expect(creditsLeft(500, 10n ** 12n, cfg)).toBe(0);
  });
  it("shows a balance no larger than what was bought", () => {
    expect(balanceCredits(spendLimitNano(500, cfg), 0n, cfg)).toBe(499);
    expect(balanceCredits(1_000_000_000n, 1_500_000_000n, cfg)).toBe(0);
  });
  it("converts nano-USD to whole credits, rounding down", () => {
    expect(creditsFromNano(1_000_000_000n, cfg)).toBe(120);
    expect(creditsFromNano(8_333_332n, cfg)).toBe(0);
  });
  it("converts dollars to USDC base units", () => {
    expect(usdcAmount(5)).toBe("5000000");
    expect(usdcAmount(0.1)).toBe("100000");
    expect(usdcAmount(123.456789)).toBe("123456789");
    expect(usdcAmount(0)).toBe("0");
  });
  it("refuses a dollar amount finer than one USDC base unit instead of rounding it", () => {
    expect(() => usdcAmount(1.2345678)).toThrow(RangeError);
    expect(() => usdcAmount(1e-7)).toThrow(RangeError);
    expect(() => usdcAmount(-1)).toThrow(RangeError);
    expect(() => usdcAmount(Number.NaN)).toThrow(RangeError);
  });
});

describe("parseConfig", () => {
  it("parses config from env vars", () => {
    expect(parseConfig(env).packagesUsd).toEqual([5, 10, 25]);
    expect(cfg).toMatchObject({
      creditsPerUsdPaid: 100,
      burnPerUsdCost: 120,
      deviceCapCredits: 5000,
      stockBufferNano: 2_000_000_000n,
      models: ["Qwen/Qwen3.8-27B", "z-ai/glm-5.3"],
      operatorAccount: "operator.near",
    });
  });
  it("rejects a variable that is not a positive number", () => {
    expect(() => parseConfig({ ...env, BURN_PER_USD_COST: "abc" } as unknown as Env)).toThrow("BURN_PER_USD_COST");
    expect(() => parseConfig({ ...env, PACKAGES_USD: "5,0" } as unknown as Env)).toThrow("PACKAGES_USD");
    expect(() => parseConfig({ ...env, STOCK_BUFFER_NANO: "1.5" } as unknown as Env)).toThrow("STOCK_BUFFER_NANO");
    expect(() => parseConfig({ ...env, STOCK_BUFFER_NANO: "-1" } as unknown as Env)).toThrow("STOCK_BUFFER_NANO");
  });
  it("accepts a stock buffer of 0", () => {
    expect(parseConfig({ ...env, STOCK_BUFFER_NANO: "0" } as unknown as Env).stockBufferNano).toBe(0n);
  });
});
