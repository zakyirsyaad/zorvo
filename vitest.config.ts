import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Test-only settings stay out of vite.config.ts, so dev and build never load vitest.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      // Tests that render the whole App take 1-6 s on a busy laptop (the pre-push hook runs the
      // suite while other work runs), and Vitest's 5 s default failed ten of them at load ~25.
      // A passing test still ends as soon as it is done; only a stuck one waits this long.
      testTimeout: 20_000,
      // Agent worktrees under .claude/ hold copies of the tests; run only this checkout's.
      // server/ is its own package with its own Vitest setup (Workers runtime).
      exclude: [...configDefaults.exclude, ".claude/**", "server/**"],
    },
  }),
);
