import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDocxText, extractPptxText, stripRtf } from "../src/input/office.js";
import { expectError } from "./helpers.js";

const zip = async (files: Record<string, string>): Promise<Buffer> => {
  const archive = new JSZip();
  for (const [path, body] of Object.entries(files)) archive.file(path, body);
  return archive.generateAsync({ type: "nodebuffer" });
};

describe("extractDocxText", () => {
  it("puts each paragraph on its own line and decodes entities", async () => {
    const xml =
      "<w:document><w:body>" +
      '<w:p w:rsidR="1"><w:r><w:t>Soup &amp; Bread</w:t></w:r></w:p>' +
      "<w:p><w:r><w:t>Tea </w:t></w:r><w:r><w:t>2.00</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    expect(await extractDocxText(await zip({ "word/document.xml": xml }))).toBe(
      "Soup & Bread\nTea 2.00",
    );
  });

  it("returns an empty string when the document part is missing", async () => {
    expect(await extractDocxText(await zip({ "other.xml": "<x/>" }))).toBe("");
  });

  it("rejects bytes that are not a zip archive", async () => {
    await expectError(
      () => extractDocxText(Buffer.from("PK\u0003\u0004 truncated")),
      "UNREADABLE_INPUT",
    );
  });
});

describe("extractPptxText", () => {
  it("reads slides in numeric order, not string order", async () => {
    const slides = Object.fromEntries(
      [1, 2, 10].map((n) => [`ppt/slides/slide${n}.xml`, `<a:t>Slide ${n}</a:t>`]),
    );
    expect(await extractPptxText(await zip(slides))).toBe("Slide 1\n\nSlide 2\n\nSlide 10");
  });

  it("ignores non-slide parts and empty slides", async () => {
    const text = await extractPptxText(
      await zip({
        "ppt/slides/slide1.xml": "<a:t>Only</a:t>",
        "ppt/slides/slide2.xml": "<a:t></a:t>",
        "ppt/notesSlides/notesSlide1.xml": "<a:t>Speaker notes</a:t>",
      }),
    );
    expect(text).toBe("Only");
  });
});

describe("stripRtf", () => {
  it("removes control words and groups", () => {
    const rtf = "{\\rtf1\\ansi{\\fonttbl\\f0 Helvetica;}\\f0\\b Soup\\b0  4.00\\par Tea 2.00\\par}";
    expect(stripRtf(rtf)).toBe("Soup 4.00\nTea 2.00");
  });

  it("decodes hex escapes and drops nested metadata groups", () => {
    const rtf =
      "{\\rtf1{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Some{Tool};}Caf\\'e9 Cr\\'e8me\\line 3.50}";
    expect(stripRtf(rtf)).toBe("Café Crème\n3.50");
  });
});
