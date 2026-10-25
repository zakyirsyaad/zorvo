import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // xterm 6 ships minified code whose `||=` esbuild's syntax minifier broke while
  // lowering it for the target (xtermjs/xterm.js#5800). Vite 8 lowers and minifies
  // with Oxc, which keeps it working; xterm-release-build.test.ts checks the release
  // build, so run it after changing the minifier or the target.
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
