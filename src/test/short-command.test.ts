import { describe, expect, it } from "vitest";
import { shortCommand } from "../lib/background-tasks";

describe("shortCommand", () => {
  it("names a program and a script by their file names, so the telling part is not cut off", () => {
    expect(
      shortCommand("/Users/me/.local/lib/qwen-code/node/bin/node /Users/me/.local/lib/qwen-code/lib/cli-entry.js -i  --no-telemetry"),
    ).toBe("node cli-entry.js -i  --no-telemetry");
    expect(shortCommand("/Applications/Zorvo.app/Contents/MacOS/zorvo mcp-bridge")).toBe("zorvo mcp-bridge");
  });

  it("reads a folder name with a space as part of the path", () => {
    expect(
      shortCommand("/Users/me/Library/Application Support/xyz.zorvo.desktop/tools/bin/codex-code-mode-host --flag"),
    ).toBe("codex-code-mode-host --flag");
    expect(shortCommand("node --config /Users/me/My Project/conf.json build")).toBe("node --config conf.json build");
    expect(shortCommand("~/bin/tool run")).toBe("tool run");
  });

  it("leaves a command with no long path as it is", () => {
    for (const command of ["pnpm tauri dev", "node build.mjs", "./scripts/dev.sh --watch", "curl http://localhost:1420/a/b", "tool --dir=/a/b/c", ""]) {
      expect(shortCommand(command), command).toBe(command);
    }
  });

  it("keeps the slash of a name right under the root, which has no folder to drop", () => {
    for (const command of ["ls /tmp", "du -sh /Users", "python3 -m http.server --directory /srv", "~/run.sh --once"]) {
      expect(shortCommand(command), command).toBe(command);
    }
  });

  it("keeps a folder argument readable and never returns nothing for a command", () => {
    expect(shortCommand("ls /Users/me/project/")).toBe("ls project/");
    expect(shortCommand("/")).toBe("/");
    expect(shortCommand("/usr/bin/")).toBe("bin/");
  });
});
