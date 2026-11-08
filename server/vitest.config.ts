import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Workers runtime runs test/ only; the operator scripts' own tests run on Node (`node --test`).
  test: { include: ["test/**/*.test.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Fake secrets for tests only; the real ones are set with `wrangler secret put`.
      miniflare: { bindings: { PINGPAY_API_KEY: "test-pingpay-key", PINGPAY_WEBHOOK_SECRET: "test-webhook-secret" } },
    }),
  ],
});
