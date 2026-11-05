import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImagePreviewDialog } from "../components/composer/ImagePreviewDialog";

/** Lets the picture "load" with a natural size, as a real one would. */
async function loadImage(width: number, height: number) {
  const image = await screen.findByRole("img", { name: "shot.png" });
  Object.defineProperty(image, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(image);
  return image;
}

describe("ImagePreviewDialog", () => {
  it("is 520px wide, as drawn", () => {
    render(<ImagePreviewDialog path="/Users/test/shot.png" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "shot.png" })).toHaveClass("max-w-[520px]");
  });

  it("says the picture's size once it has loaded", async () => {
    render(<ImagePreviewDialog path="/Users/test/shot.png" onClose={vi.fn()} />);
    expect(screen.queryByText(/×/)).toBeNull();

    await loadImage(1280, 800);

    expect(screen.getByText("1280 × 800")).toHaveClass("text-fg-subtle");
  });

  it("adds the file size when it is known", async () => {
    render(<ImagePreviewDialog path="/Users/test/shot.png" bytes={214 * 1024} onClose={vi.fn()} />);

    await loadImage(1280, 800);

    expect(screen.getByText("1280 × 800 · 214 KB")).toBeInTheDocument();
  });
});
