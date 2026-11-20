import { afterEach, describe, expect, it } from "vitest";
import helperSource from "../../src-tauri/src/browser/page.js?raw";

interface Control {
  ref: string;
  name: string;
  role: string;
  value?: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type PageWindow = Window & typeof globalThis & {
  __zorvoBrowser: { dispatch(encoded: string): Promise<string> };
};

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

function page() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  frames.push(frame);
  const window = frame.contentWindow as PageWindow;
  const messages: string[] = [];
  Object.defineProperty(window, "webkit", {
    value: { messageHandlers: { zorvoBrowserFrame: { postMessage: (data: string) => messages.push(data) } } },
  });
  window.eval(helperSource);
  const dispatch = async <T,>(operation: string, args: Record<string, unknown> = {}) =>
    JSON.parse(await window.__zorvoBrowser.dispatch(JSON.stringify({ operation, ...args }))) as Result<T>;
  const call = async <T,>(operation: string, args: Record<string, unknown> = {}) => {
    const result = await dispatch<T>(operation, args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  return { window, document: window.document, call, dispatch, messages };
}

describe("native browser page helper", () => {
  it("finds ordinary and nested open-shadow controls and drives their snapshot refs", async () => {
    const p = page();
    p.document.body.innerHTML = '<button>Light button</button><x-widget></x-widget><x-closed></x-closed>';
    const root = p.document.querySelector("x-widget")!.attachShadow({ mode: "open" });
    root.innerHTML = '<button>Shadow button</button><x-nested></x-nested>';
    const nested = root.querySelector("x-nested")!.attachShadow({ mode: "open" });
    nested.innerHTML = '<button>Nested button</button><input aria-label="Shadow input" value="original">';
    const closed = p.document.querySelector("x-closed")!.attachShadow({ mode: "closed" });
    closed.innerHTML = "<button>Closed button</button>";
    const button = nested.querySelector("button")!;
    const input = nested.querySelector("input")!;
    let clicks = 0;
    const events: string[] = [];
    button.addEventListener("click", () => clicks++);
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    const snapshot = await p.call<{ controls: Control[] }>("snapshot");
    expect(snapshot.controls.map(control => control.name)).toEqual([
      "Light button", "Shadow button", "Nested button", "Shadow input",
    ]);
    const buttonRef = snapshot.controls.find(control => control.name === "Nested button")!.ref;
    const inputRef = snapshot.controls.find(control => control.name === "Shadow input")!.ref;
    expect(await p.call("click", { ref: buttonRef })).toMatchObject({ clicked: true, trusted: false });
    expect(await p.call("fill", { ref: inputRef, value: "updated" })).toMatchObject({ filled: true, trusted: false });
    expect(clicks).toBe(1);
    expect(input.value).toBe("updated");
    expect(events).toEqual(["input", "change"]);
    expect(await p.call<Control[]>("find", { text: "nested" })).toEqual([
      expect.objectContaining({ ref: buttonRef, name: "Nested button" }),
    ]);
    // The only bridge message describes the document, never control values.
    expect(p.messages.map(message => JSON.parse(message))).toEqual([
      expect.objectContaining({ kind: "frame" }),
    ]);
  });

  it("keeps live refs stable and rejects detached shadow elements after replacement", async () => {
    const p = page();
    const host = p.document.createElement("x-widget");
    p.document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<button>Original</button>";
    const initial = await p.call<{ controls: Control[] }>("snapshot");
    const firstRef = initial.controls[0].ref;
    const repeated = await p.call<{ controls: Control[] }>("snapshot");
    expect(repeated.controls[0].ref).toBe(firstRef);

    root.innerHTML = "<button>Replacement</button>";
    const stale = await p.dispatch("click", { ref: firstRef });
    expect(stale).toEqual({ ok: false, error: expect.stringContaining("reference is stale") });
    const replacement = await p.call<{ controls: Control[] }>("snapshot");
    expect(replacement.controls[0].name).toBe("Replacement");
    expect(replacement.controls[0].ref).not.toBe(firstRef);
  });

  it("bounds snapshot output when an open shadow root contains many controls", async () => {
    const p = page();
    const host = p.document.createElement("x-widget");
    p.document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = Array.from({ length: 1100 }, (_, index) => `<button>Button ${index}</button>`).join("");
    const snapshot = await p.call<{ controls: Control[] }>("snapshot");
    expect(snapshot.controls).toHaveLength(1000);
    expect(snapshot.controls[0].name).toBe("Button 0");
    expect(snapshot.controls[999].name).toBe("Button 999");
  });
});

it("leaves a password field's value out of the snapshot", async () => {
  const { document, call } = page();
  document.body.innerHTML = '<input id="user" value="ada"><input id="secret" type="password" value="hunter2">';
  const snapshot = await call<{ controls: (Control & { type?: string })[] }>("snapshot");
  const password = snapshot.controls.find(control => control.type === "password");
  expect(password).toBeDefined();
  expect(password).not.toHaveProperty("value");
  expect(JSON.stringify(snapshot)).not.toContain("hunter2");
  expect(snapshot.controls.find(control => control.value === "ada")).toBeDefined();
});
