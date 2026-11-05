import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installContextMenuGuard, keepsNativeMenu } from "../lib/context-menu";

function rightClick(target: Element): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("keepsNativeMenu", () => {
  it("keeps the Mac's menu in text fields, so Paste and Undo still work", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inside = document.createElement("span");
    editable.append(inside);
    expect(keepsNativeMenu(input, null)).toBe(true);
    expect(keepsNativeMenu(textarea, null)).toBe(true);
    expect(keepsNativeMenu(inside, null)).toBe(true);
  });

  it("keeps it on selected text, so Copy still works", () => {
    const reply = document.createElement("p");
    reply.textContent = "status words";
    document.body.append(reply);
    const range = document.createRange();
    range.selectNodeContents(reply);
    window.getSelection()?.addRange(range);
    expect(keepsNativeMenu(reply, window.getSelection())).toBe(true);
  });

  it("keeps it nowhere else", () => {
    expect(keepsNativeMenu(document.createElement("div"), window.getSelection())).toBe(false);
    expect(keepsNativeMenu(document.createElement("div"), null)).toBe(false);
    expect(keepsNativeMenu(null, null)).toBe(false);
  });
});

describe("installContextMenuGuard", () => {
  it("stops WebKit's menu on plain chrome, not in a field, until it is removed", () => {
    const plain = document.createElement("div");
    const input = document.createElement("input");
    document.body.append(plain, input);

    const remove = installContextMenuGuard(document);
    expect(rightClick(plain)).toBe(true);
    expect(rightClick(input)).toBe(false);

    remove();
    expect(rightClick(plain)).toBe(false);
  });

  it("is installed only in release builds, so dev builds keep Inspect Element", () => {
    const main = readFileSync(join(__dirname, "..", "main.tsx"), "utf8");
    expect(main).toMatch(/if\s*\(\s*import\.meta\.env\.PROD\s*\)\s*\{?\s*installContextMenuGuard\(document\)/);
  });
});
