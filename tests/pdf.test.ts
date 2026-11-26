import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFromBuffer, MockLlmClient } from "../src/index.js";
import { at, buildPdf, canImport, expectError } from "./helpers.js";

const hasMupdf = await canImport("mupdf");

describe.skipIf(!hasMupdf)("PDF input (optional peer mupdf)", () => {
  it("sends the text layer of every page, in order", async () => {
    const client = new MockLlmClient("[]");
    const pdf = buildPdf(["Fictional Pie 6.00", "Second Page Soup 4.00", "Third Page Tea 2.00"]);
    await extractFromBuffer(pdf, "m.pdf", { client, minPdfTextChars: 5 });
    const request = at(client.calls);
    expect(request.images).toBeUndefined();
    expect(request.text).toBe("Fictional Pie 6.00\n\nSecond Page Soup 4.00\n\nThird Page Tea 2.00");
  });

  it("skips pages without text instead of adding blank sections", async () => {
    const client = new MockLlmClient("[]");
    await extractFromBuffer(buildPdf(["Front Soup 4.00", "", "Back Tea 2.00"]), "m.pdf", {
      client,
      minPdfTextChars: 5,
    });
    expect(at(client.calls).text).toBe("Front Soup 4.00\n\nBack Tea 2.00");
  });

  it("detects a PDF by its bytes even with a misleading name", async () => {
    const client = new MockLlmClient("[]");
    await extractFromBuffer(buildPdf(["Disguised Pie 5.00"]), "menu.txt", {
      client,
      minPdfTextChars: 5,
    });
    expect(at(client.calls).text).toBe("Disguised Pie 5.00");
  });

  it("renders text-poor (scanned-like) PDFs to JPEG page images", async () => {
    const client = new MockLlmClient("[]");
    await extractFromBuffer(buildPdf(["x", ""]), "m.pdf", { client, minPdfTextChars: 200 });
    const request = at(client.calls);
    expect(request.text).toBeUndefined();
    expect(request.images).toHaveLength(2);
    const page = at(request.images ?? []);
    expect(page.mediaType).toBe("image/jpeg");
    expect(Buffer.from(page.base64, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("caps rendered pages at maxPdfPages and warns", async () => {
    const client = new MockLlmClient("[]");
    const { warnings } = await extractFromBuffer(buildPdf(["", "", "", ""]), "m.pdf", {
      client,
      maxPdfPages: 2,
    });
    expect(at(client.calls).images).toHaveLength(2);
    expect(warnings).toContain("PDF has 4 pages; only the first 2 were sent");
  });

  it("rejects a corrupt PDF as UNREADABLE_INPUT", async () => {
    const corrupt = Buffer.from("%PDF-1.4\nthis is not really a pdf");
    await expectError(
      () => extractFromBuffer(corrupt, "m.pdf", { client: new MockLlmClient("[]") }),
      "UNREADABLE_INPUT",
    );
  });
});

describe("PDF input without mupdf installed", () => {
  afterEach(() => {
    vi.doUnmock("mupdf");
    vi.resetModules();
  });

  it("fails with MISSING_DEPENDENCY and an install hint", async () => {
    vi.resetModules();
    vi.doMock("mupdf", () => {
      throw new Error("Cannot find package 'mupdf'");
    });
    // A fresh module graph, so the error class is the fresh one too.
    const fresh = await import("../src/index.js");
    const result = fresh.extractFromBuffer(buildPdf(["Pie"]), "m.pdf", {
      client: new fresh.MockLlmClient("[]"),
    });
    const error: unknown = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(fresh.MenuExtractError);
    expect(error).toHaveProperty("code", "MISSING_DEPENDENCY");
    expect((error as Error).message).toContain("npm install mupdf");
  });
});
