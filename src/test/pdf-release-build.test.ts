// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PdfDocument } from "../lib/pdf-document";

const ROOT = join(__dirname, "..", "..");
const BUILD_TIMEOUT_MS = 180_000;

/**
 * A one-page PDF with a blue square and no text, so no font is needed. The cross-reference table is
 * written for real: pdf.js would repair a wrong one, which would hide a broken fixture.
 */
function fixturePdf(): Uint8Array {
  const content = "0 0 1 rg 20 20 100 100 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const at = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

let outDir = "";
let openPdf: (bytes: Uint8Array) => Promise<PdfDocument>;

describe("pdf.js in a release build", () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-release-"));
    outDir = join(dir, "out");
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, `export { openPdf } from ${JSON.stringify(join(ROOT, "src", "lib", "pdf-document.ts"))};\n`);
    await build({
      root: ROOT,
      configFile: join(ROOT, "vite.config.ts"),
      mode: "production",
      logLevel: "silent",
      // Absolute, so the worker's URL is one Node can import, as the webview imports `/assets/…`.
      base: `${pathToFileURL(outDir).href}/`,
      build: {
        outDir,
        emptyOutDir: true,
        // The preload helper wants a document; Node has none, and preloading is not what is tested.
        modulePreload: false,
        rolldownOptions: { input: entry, preserveEntrySignatures: "strict", output: { format: "es", entryFileNames: "entry.mjs" } },
      },
    });
    // pdf.js asks the window for the pixel ratio, as it exists in the webview.
    (globalThis as { window?: unknown }).window = {
      devicePixelRatio: 1,
      requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    };
    ({ openPdf } = await import(/* @vite-ignore */ pathToFileURL(join(outDir, "entry.mjs")).href));
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const files = () => readdirSync(join(outDir, "assets"));

  it("emits the worker as a file of its own, never inlined as a data: or blob: URL", () => {
    const worker = files().filter((name) => /^pdf\.worker\.min-.*\.mjs$/.test(name));
    expect(worker).toHaveLength(1);
    // Under the CSP a Worker may only start from 'self': an inlined worker would be refused.
    for (const name of files().filter((file) => file.endsWith(".js"))) {
      const code = readFileSync(join(outDir, "assets", name), "utf8");
      expect(code, name).not.toMatch(/workerSrc\s*=\s*["'`](data|blob):/);
    }
    const entry = readFileSync(join(outDir, "entry.mjs"), "utf8");
    expect(entry).not.toMatch(/data:(text|application)\/javascript/);
  });

  it(
    "opens a PDF and draws its first page from the built output, with eval switched off",
    async () => {
      const { createCanvas } = createRequire(createRequire(join(ROOT, "package.json")).resolve("pdfjs-dist/package.json"))("@napi-rs/canvas") as { createCanvas: (width: number, height: number) => object };
      const realEval = globalThis.eval;
      const RealFunction = globalThis.Function;
      const refuse = () => {
        throw new Error("eval is not available under the CSP");
      };
      // What `script-src 'self'` does to the page: no string is compiled into code.
      globalThis.eval = refuse as typeof eval;
      globalThis.Function = Object.assign(refuse, { prototype: RealFunction.prototype }) as unknown as FunctionConstructor;
      try {
        const doc = await openPdf(fixturePdf());
        expect(doc.pageCount).toBe(1);
        expect(doc.firstPageRatio).toBeCloseTo(0.5);

        const canvas = Object.assign(createCanvas(1, 1), { style: {} }) as unknown as HTMLCanvasElement;
        await doc.renderPage(1, canvas, 400).done;

        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(200);
        // The square is 100 of 200 units wide, from x=20 and up from the bottom edge.
        const pixel = (x: number, y: number) => Array.from(canvas.getContext("2d")!.getImageData(x, y, 1, 1).data);
        expect(pixel(120, 120)).toEqual([0, 0, 255, 255]);
        expect(pixel(380, 20)).toEqual([255, 255, 255, 255]);
        doc.destroy();
      } finally {
        globalThis.eval = realEval;
        globalThis.Function = RealFunction;
      }
    },
    BUILD_TIMEOUT_MS,
  );
});
