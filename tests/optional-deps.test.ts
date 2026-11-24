import { describe, it, expect } from "vitest";
import { extractFromBuffer } from "../src/extract.js";
import { MockLlmClient } from "../src/llm/mock.js";

async function has(mod: string) {
  try { await import(mod); return true; } catch { return false; }
}
const hasMupdf = await has("mupdf");
const hasSharp = await has("sharp");

/** Smallest practical PDF with one text line. Offsets are not required by mupdf's repair pass. */
function tinyPdf(line: string): Buffer {
  const stream = `BT /F1 14 Tf 20 100 Td (${line}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe.skipIf(!hasMupdf)("PDF input (needs optional mupdf)", () => {
  it("uses extracted text when the PDF has enough of it", async () => {
    const client = new MockLlmClient("[]");
    await extractFromBuffer(tinyPdf("Fictional Pie 6.00"), "m.pdf", { client, minPdfTextChars: 5 });
    expect(client.calls[0].text).toContain("Fictional Pie 6.00");
    expect(client.calls[0].images).toBeUndefined();
  });

  it("falls back to rendered page images for text-poor (scanned-like) PDFs", async () => {
    const client = new MockLlmClient("[]");
    await extractFromBuffer(tinyPdf("x"), "m.pdf", { client, minPdfTextChars: 200 });
    expect(client.calls[0].text).toBeUndefined();
    expect(client.calls[0].images?.[0].mediaType).toBe("image/jpeg");
    expect(client.calls[0].images?.[0].base64.length).toBeGreaterThan(100);
  });
});

describe.skipIf(!hasSharp)("image input (needs optional sharp)", () => {
  it("sends an image block and downsizes oversized images to JPEG", async () => {
    const sharp = (await import("sharp")).default;
    const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const client = new MockLlmClient("[]");
    await extractFromBuffer(big, "m.png", { client });
    await extractFromBuffer(small, "m.png", { client });
    expect(client.calls[0].images?.[0].mediaType).toBe("image/jpeg");
    expect(client.calls[1].images?.[0].mediaType).toBe("image/png");
    const meta = await sharp(Buffer.from(client.calls[0].images![0].base64, "base64")).metadata();
    expect(meta.width).toBe(2048);
  });
});
