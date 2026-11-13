import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import { pastedImageFiles } from "../lib/pasted-images";
import { fakeTauriInvoke } from "./setup";

type FakeClipboard = { files: File[]; text?: string };

function imageFile(name = "image.png", type = "image/png", bytes: BlobPart = "png-bytes"): File {
  return new File([bytes], name, { type });
}

/** What a paste event's `clipboardData` offers: its files, its text and the items that announce both. */
function clipboard({ files, text = "" }: FakeClipboard) {
  const items = [
    ...files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    ...(text ? [{ kind: "string", type: "text/plain", getAsFile: () => null }] : []),
  ];
  return {
    files,
    items,
    types: [...files.map(() => "Files"), ...(text ? ["text/plain"] : [])],
    getData: (type: string) => (type === "text/plain" ? text : ""),
  };
}

/** Long enough for a save that was wrongly started to reach the backend. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

describe("pastedImageFiles", () => {
  it("returns the image of an image-only clipboard", () => {
    const shot = imageFile("shot.png");
    expect(pastedImageFiles(clipboard({ files: [shot] }))).toEqual([shot]);
  });

  it("returns nothing for a text-only clipboard", () => {
    expect(pastedImageFiles(clipboard({ files: [], text: "hello" }))).toEqual([]);
  });

  it("prefers the text when the clipboard holds both, as a web page or a spreadsheet copy does", () => {
    expect(pastedImageFiles(clipboard({ files: [imageFile()], text: "Quarterly totals\t42" }))).toEqual([]);
  });

  it("treats the text of a copied image file as its name, so the image wins", () => {
    const copied = imageFile("IMG_0042.png");
    expect(pastedImageFiles(clipboard({ files: [copied], text: "IMG_0042.png" }))).toEqual([copied]);
  });

  it("returns several images in order", () => {
    const [a, b] = [imageFile("a.png"), imageFile("b.jpg", "image/jpeg")];
    expect(pastedImageFiles(clipboard({ files: [a, b] }))).toEqual([a, b]);
  });

  it("ignores files that are not images", () => {
    const pdf = imageFile("doc.pdf", "application/pdf");
    expect(pastedImageFiles(clipboard({ files: [pdf] }))).toEqual([]);
  });

  it("reads image items when the file list is empty", () => {
    const shot = imageFile("shot.png");
    const data = { ...clipboard({ files: [shot] }), files: [] as File[] };
    expect(pastedImageFiles(data)).toEqual([shot]);
  });

  it("counts a file once when it is both in the list and in the items", () => {
    const shot = imageFile("shot.png");
    expect(pastedImageFiles(clipboard({ files: [shot] }))).toHaveLength(1);
  });

  it("returns nothing without clipboard data", () => {
    expect(pastedImageFiles(null)).toEqual([]);
  });
});

describe("Composer paste", () => {
  afterEach(() => vi.restoreAllMocks());

  function spyOnInvoke(handler: (cmd: string, args?: Record<string, unknown>) => unknown) {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__;
    return vi.spyOn(internals, "invoke").mockImplementation((cmd, args) => {
      try {
        const answer = handler(cmd, args);
        return answer === undefined ? (fakeTauriInvoke(cmd, args) as Promise<unknown>) : Promise.resolve(answer);
      } catch (error) {
        return Promise.reject(error);
      }
    });
  }

  it("attaches a pasted image and keeps the text box as it was", async () => {
    const invoke = spyOnInvoke((cmd) => (cmd === "save_pasted_image" ? "/data/pasted-images/paste-1.png" : undefined));
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={() => {}} />);

    const event = fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });

    expect(event).toBe(false); // default prevented
    expect(await screen.findByRole("button", { name: "Remove paste-1.png" })).toBeTruthy();
    expect(prompt().value).toBe("");
    const call = invoke.mock.calls.find(([cmd]) => cmd === "save_pasted_image");
    expect(call?.[1]).toEqual({ data: expect.any(String) });
  });

  it("attaches every pasted image", async () => {
    let n = 0;
    spyOnInvoke((cmd) => (cmd === "save_pasted_image" ? `/data/pasted-images/paste-${++n}.png` : undefined));
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={() => {}} />);

    fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile("a.png"), imageFile("b.png")] }) });

    expect(await screen.findByRole("button", { name: "Remove paste-1.png" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Remove paste-2.png" })).toBeTruthy();
  });

  it("leaves a text paste to the browser", async () => {
    const invoke = spyOnInvoke(() => undefined);
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={() => {}} />);

    const event = fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [], text: "just words" }) });

    expect(event).toBe(true);
    await settle();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_pasted_image")).toBe(false);
  });

  it("leaves text and image together to the browser, which pastes the text", async () => {
    const invoke = spyOnInvoke(() => undefined);
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={() => {}} />);

    const event = fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()], text: "cells" }) });

    expect(event).toBe(true);
    await settle();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_pasted_image")).toBe(false);
  });

  it("attaches nothing while the composer is disabled", async () => {
    const invoke = spyOnInvoke(() => undefined);
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles disabled onNotice={() => {}} />);

    fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });

    await settle();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_pasted_image")).toBe(false);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("types the path into the text for an agent that takes no files", async () => {
    spyOnInvoke((cmd) => (cmd === "save_pasted_image" ? "/data/pasted-images/paste-1.png" : undefined));
    render(<ComposerDock onSendMessage={() => {}} onNotice={() => {}} />);

    fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });

    await waitFor(() => expect(prompt().value).toBe("/data/pasted-images/paste-1.png "));
  });

  it("says so in a notice when the image cannot be saved", async () => {
    spyOnInvoke((cmd) => {
      if (cmd === "save_pasted_image") throw new Error("disk full");
      return undefined;
    });
    const onNotice = vi.fn();
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} />);

    fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });

    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
    expect(onNotice.mock.calls[0][0]).toMatch(/^Could not attach the pasted image/);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("refuses an image over the size cap without asking the backend", async () => {
    const invoke = spyOnInvoke(() => undefined);
    const onNotice = vi.fn();
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} />);
    const huge = imageFile("huge.png");
    Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });

    fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [huge] }) });

    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
    expect(onNotice.mock.calls[0][0]).toContain("larger than 10 MB");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_pasted_image")).toBe(false);
  });
  describe("when the save finishes late", () => {
    /** A save that stays pending until the test resolves it, once the backend has been asked. */
    function pendingSave() {
      let resolve!: (path: string) => void;
      const saved = new Promise<string>((r) => (resolve = r));
      const invoke = spyOnInvoke((cmd) => (cmd === "save_pasted_image" ? saved : undefined));
      const finish = async () => {
        await waitFor(() => expect(invoke.mock.calls.some(([cmd]) => cmd === "save_pasted_image")).toBe(true));
        resolve("/data/pasted-images/paste-9.png");
        await saved;
      };
      return finish;
    }

    const noChip = () => expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();

    it("drops the image when the message was sent meanwhile, and says so", async () => {
      const finish = pendingSave();
      const onNotice = vi.fn();
      render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} pasteScope="a" />);
      fireEvent.change(prompt(), { target: { value: "look" } });

      fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });
      fireEvent.keyDown(prompt(), { key: "Enter" });
      await finish();

      await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
      expect(onNotice.mock.calls[0][0]).toMatch(/^Left out the pasted image/);
      noChip();
    });

    it("drops the image when another session is on screen meanwhile", async () => {
      const finish = pendingSave();
      const onNotice = vi.fn();
      const view = render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} pasteScope="a" />);

      fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });
      view.rerender(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} pasteScope="b" />);
      await finish();

      await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
      noChip();
    });

    it("drops the image when the composer was hidden meanwhile", async () => {
      const finish = pendingSave();
      const onNotice = vi.fn();
      const view = render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} pasteScope="a" />);

      fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });
      view.rerender(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} pasteScope="a" isHidden />);
      await finish();

      await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
      view.rerender(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={onNotice} pasteScope="a" />);
      noChip();
    });

    it("still attaches when nothing changed", async () => {
      const finish = pendingSave();
      render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={() => {}} pasteScope="a" />);

      fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });
      await finish();

      expect(await screen.findByRole("button", { name: "Remove paste-9.png" })).toBeTruthy();
    });
  });

  it("attaches nothing while the composer is hidden", async () => {
    const invoke = spyOnInvoke(() => undefined);
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles onNotice={() => {}} isHidden />);

    fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });

    await settle();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_pasted_image")).toBe(false);
  });

  it("does not swallow a paste it could not report a failure for (a popout has no notice path)", async () => {
    const invoke = spyOnInvoke(() => undefined);
    render(<ComposerDock onSendMessage={() => {}} attachAsFiles />);

    const event = fireEvent.paste(prompt(), { clipboardData: clipboard({ files: [imageFile()] }) });

    expect(event).toBe(true);
    await settle();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_pasted_image")).toBe(false);
  });
});
