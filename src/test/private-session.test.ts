import { describe, expect, it } from "vitest";
import { privateModelIdOf, privateOpenError, withoutModelChanges } from "../lib/private-session";
import type { AcpOptions } from "../hooks/useAcpSessions";

describe("privateModelIdOf", () => {
  it("is the model of a private session and undefined for any other", () => {
    expect(privateModelIdOf({ privateMode: { modelId: "Qwen/Qwen3.8-27B" } })).toBe("Qwen/Qwen3.8-27B");
    expect(privateModelIdOf({})).toBeUndefined();
  });
});

describe("privateOpenError", () => {
  it("words a credits refusal and says which one", () => {
    expect(privateOpenError('PRIVATE_CREDITS:{"reason":"empty"}', true)).toEqual({
      text: "Your credits ran out. Top up to continue.",
      creditsOut: "empty",
    });
    expect(privateOpenError(new Error('PRIVATE_CREDITS:{"reason":"key"}'), true)).toEqual({
      text: "This Mac's private key stopped working. Restore it in Settings → Private mode.",
      creditsOut: "key",
    });
  });

  it("words a private error code of a private session", () => {
    expect(privateOpenError("unknown_model", true)).toEqual({
      text: "That model isn't offered anymore. Start a new private session to pick another.",
    });
    expect(privateOpenError("not_qwen", true)?.text).toBe("Private sessions run Qwen Code only for now.");
  });

  it("words private_session for a plain reopen of a session that ran privately", () => {
    expect(privateOpenError("private_session", false)).toEqual({
      text: "This session ran privately. Reopen it as a private session.",
    });
  });

  it("leaves every other error to the ordinary path", () => {
    expect(privateOpenError("spawn failed", true)).toBeNull();
    expect(privateOpenError("unknown_model", false)).toBeNull();
    expect(privateOpenError('PRIVATE_CREDITS:{"reason":"other"}', true)).toBeNull();
    expect(privateOpenError("ACP_AUTH_REQUIRED:[]", true)).toBeNull();
  });
});

describe("withoutModelChanges", () => {
  const info: AcpOptions = {
    modes: null,
    configOptions: [
      { id: "model", name: "Model", category: "model", currentValue: "a", options: [] },
      { id: "effort", name: "Effort", category: "thought_level", currentValue: "low", options: [] },
    ],
  };

  it("drops a model pick and a model config pick, and keeps the rest", () => {
    expect(
      withoutModelChanges(
        [
          { kind: "model", modelId: "x" },
          { kind: "config", configId: "model", value: "b" },
          { kind: "config", configId: "effort", value: "high" },
          { kind: "mode", modeId: "default" },
        ],
        info,
      ),
    ).toEqual([
      { kind: "config", configId: "effort", value: "high" },
      { kind: "mode", modeId: "default" },
    ]);
  });
});
