import { describe, expect, it } from "vitest";
import { agentWorkOf, MAX_AGENT_WORK_ITEMS, mergedAgentWork, validAgentWork } from "../lib/agent-work";
import type { ChatMessage, ToolExecution } from "../types";

let next = 0;
function shell(command: string, output = "", status: ToolExecution["status"] = "completed"): ToolExecution {
  next += 1;
  return { id: `t${next}`, name: "Shell", kind: "execute", status, command, details: output ? [{ kind: "text", text: output }] : [] };
}

function reply(...tools: ToolExecution[]): ChatMessage {
  next += 1;
  return { id: `m${next}`, role: "agent", content: "", timestamp: next, tools };
}

describe("agentWorkOf", () => {
  it("reads the branches an agent made, as the titan-investment sessions ran them", () => {
    const work = agentWorkOf([
      reply(shell("cd /r && git worktree add -b fix/ufe-statement-fallback-notice .qwen/worktrees/ufe-fallback-notice origin/main")),
      reply(shell("git -C /r/.qwen/worktrees/x checkout -b feat/second")),
      reply(shell("git switch --create=feat/third")),
      reply(shell("cd /r/.qwen/worktrees/ufe && git push --no-verify -u origin fix/ufe-statement-fallback-notice 2>&1 | tail -6")),
    ]);
    expect(work.branches).toEqual(["feat/second", "feat/third", "fix/ufe-statement-fallback-notice"]);
  });

  it("reads the address gh pr create printed, and its --head", () => {
    const work = agentWorkOf([
      reply(
        shell(
          "gh pr create --repo 'github.com/O/R' --draft --base main --head fix/notice --title 'fix: say it' --body-file /tmp/b.md",
          "Command: gh pr create …\nOutput: https://github.com/O/R/pull/259\n",
        ),
      ),
    ]);
    expect(work).toEqual({ branches: ["fix/notice"], pullRequestUrls: ["https://github.com/O/R/pull/259"] });
  });

  it("opens a shell's -c script, as agents wrap their commands", () => {
    const work = agentWorkOf([
      reply(shell(`bash -lc "gh pr create --head fix/a --title 'x'"`, "https://github.com/o/r/pull/7")),
      reply(shell(`/bin/zsh -c 'cd /r && git worktree add -b fix/b wt'`)),
    ]);
    expect(work).toEqual({ branches: ["fix/a", "fix/b"], pullRequestUrls: ["https://github.com/o/r/pull/7"] });
  });

  it("reads the command from the tool's title when the agent sends no input, as Antigravity does", () => {
    next += 1;
    const titled: ToolExecution = {
      id: `t${next}`,
      name: [
        "gh pr create \\",
        "  --base main \\",
        "  --head feat/ibkr-flex-pipeline \\",
        '  --title "feat(ibkr-flex): add the pull pipeline" \\',
        `  --body "$(cat <<'EOF'`,
        "## Summary",
        "",
        "Runs `git checkout -b not/this` in the docs only.",
        "EOF",
        ')"',
      ].join("\n"),
      kind: "execute",
      status: "completed",
      details: [{ kind: "text", text: "https://github.com/O/R/pull/273\n" }],
    };
    expect(agentWorkOf([reply(titled)])).toEqual({
      branches: ["feat/ibkr-flex-pipeline"],
      pullRequestUrls: ["https://github.com/O/R/pull/273"],
    });
  });

  it("ignores what did not finish, other programs, and pull requests it only mentioned", () => {
    const work = agentWorkOf([
      reply(shell("git worktree add -b fix/failed wt", "", "failed")),
      reply(shell("gh pr view 257 --json url", "https://github.com/O/R/pull/257")),
      reply(shell("echo git checkout -b not/a/branch")),
      reply(shell("git push origin fix/no-upstream")),
      reply(shell("git push -u origin HEAD")),
      reply(shell("git push -u origin > /tmp/push.log")),
    ]);
    expect(work).toEqual({ branches: [], pullRequestUrls: [] });
  });

  it("keeps each branch once, at its newest place, and only the newest ten", () => {
    const many = Array.from({ length: MAX_AGENT_WORK_ITEMS + 2 }, (_, index) => reply(shell(`git checkout -b b${index}`)));
    const work = agentWorkOf([reply(shell("git checkout -b b0")), ...many, reply(shell("git push -u origin b3"))]);
    expect(work.branches).toHaveLength(MAX_AGENT_WORK_ITEMS);
    expect(work.branches.at(-1)).toBe("b3");
    expect(work.branches).not.toContain("b0");
  });
});

describe("saving what an agent made", () => {
  it("adds what a transcript holds now to what was saved, and drops nothing", () => {
    const saved = { branches: ["fix/a"], pullRequestUrls: ["https://github.com/o/r/pull/1"] };
    expect(mergedAgentWork(saved, { branches: [], pullRequestUrls: [] })).toEqual(saved);
    expect(mergedAgentWork(saved, { branches: ["fix/b", "fix/a"], pullRequestUrls: [] })?.branches).toEqual(["fix/a", "fix/b"]);
    expect(mergedAgentWork(undefined, { branches: [], pullRequestUrls: [] })).toBeUndefined();
  });

  it("keeps the saved order after a rewind left only older work in the transcript", () => {
    const urls = Array.from({ length: 10 }, (_, index) => `https://github.com/o/r/pull/${index + 1}`);
    const saved = { branches: ["fix/one", "fix/two"], pullRequestUrls: urls };
    const merged = mergedAgentWork(saved, { branches: ["fix/one"], pullRequestUrls: urls.slice(0, 3) });
    expect(merged).toEqual(saved);
  });

  it("loads only valid values from a saved state", () => {
    expect(validAgentWork({ branches: ["fix/a", 7, "-x", "HEAD"], pullRequestUrls: ["https://github.com/o/r/pull/2", "http://evil/pull/1"] })).toEqual({
      branches: ["fix/a"],
      pullRequestUrls: ["https://github.com/o/r/pull/2"],
    });
    expect(validAgentWork({ branches: "fix/a" })).toBeUndefined();
    expect(validAgentWork(null)).toBeUndefined();
  });
});
