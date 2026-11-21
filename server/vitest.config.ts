import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Workers runtime runs test/ only; the operator scripts' own tests run on Node (`node --test`).
  test: {
    include: ["test/**/*.test.ts"],
    // Every test goes through the Workers runtime, and some send a hundred requests or run two
    // hundred alarm ticks: one to two seconds on an idle machine, over Vitest's default 5 s on a
    // busy runner. A test that times out is not stopped. Its body keeps running against the same
    // Durable Object, so the tests after it in its file fail on state they did not set up. The
    // limit is there to end a hang, so it sits well above what a slow runner needs.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Fake secrets for tests only; the real ones are set with `wrangler secret put`.
      miniflare: { bindings: { PINGPAY_API_KEY: "test-pingpay-key", PINGPAY_WEBHOOK_SECRET: "test-webhook-secret" } },
    }),
  ],
});
