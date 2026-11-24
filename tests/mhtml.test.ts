import { describe, it, expect } from "vitest";
import { parseMhtml } from "../src/input/mhtml.js";

function buildMhtml(parts: { type: string; encoding?: string; body: string; location?: string }[]): Buffer {
  const boundary = "----=_Part_123";
  let content = `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"\r\n\r\n`;

  for (const part of parts) {
    content += `\r\n------=_Part_123\r\n`;
    content += `Content-Type: ${part.type}\r\n`;
    if (part.encoding) content += `Content-Transfer-Encoding: ${part.encoding}\r\n`;
    if (part.location) content += `Content-Location: ${part.location}\r\n`;
    content += `\r\n${part.body}`;
  }
  content += `\r\n------=_Part_123--\r\n`;

  return Buffer.from(content, "utf-8");
}

describe("parseMhtml", () => {
  it("extracts HTML text from MHTML", () => {
    const buf = buildMhtml([
      { type: "text/html", body: "<h1>Menu</h1><p>Burger $10</p>" },
    ]);
    const { html, images } = parseMhtml(buf);
    expect(html).toContain("Menu");
    expect(html).toContain("Burger");
    expect(images).toHaveLength(0);
  });

  it("extracts embedded images", () => {
    // Needs >100 base64 chars to pass the filter
    const imgBase64 = Buffer.from("A".repeat(200)).toString("base64");
    const buf = buildMhtml([
      { type: "text/html", body: "<p>Menu</p>" },
      {
        type: "image/png",
        encoding: "base64",
        body: imgBase64,
        location: "https://example.com/logo.png",
      },
    ]);
    const { html, images } = parseMhtml(buf);
    expect(html).toContain("Menu");
    expect(images).toHaveLength(1);
    expect(images[0].name).toBe("logo.png");
    expect(images[0].mimeType).toBe("image/png");
  });

  it("decodes quoted-printable HTML", () => {
    const buf = buildMhtml([
      { type: "text/html", encoding: "quoted-printable", body: "Price=3D$10" },
    ]);
    const { html } = parseMhtml(buf);
    expect(html).toContain("Price=$10");
  });

  it("decodes base64 HTML", () => {
    const encoded = Buffer.from("<p>Hello</p>").toString("base64");
    const buf = buildMhtml([
      { type: "text/html", encoding: "base64", body: encoded },
    ]);
    const { html } = parseMhtml(buf);
    expect(html).toContain("Hello");
  });

  it("falls back to raw text when no boundary found", () => {
    const raw = Buffer.from("Just some plain text without MIME structure");
    const { html, images } = parseMhtml(raw);
    expect(html).toBe("Just some plain text without MIME structure");
    expect(images).toHaveLength(0);
  });

  it("skips small images (< 100 base64 chars)", () => {
    const tinyBase64 = Buffer.from("x").toString("base64"); // very short
    const buf = buildMhtml([
      { type: "text/html", body: "<p>Menu</p>" },
      { type: "image/png", encoding: "base64", body: tinyBase64, location: "tiny.png" },
    ]);
    const { images } = parseMhtml(buf);
    expect(images).toHaveLength(0);
  });
});

describe("quoted-printable", () => {
  it("decodes multi-byte UTF-8 sequences correctly", () => {
    const { html } = parseMhtml(buildMhtml([{ type: "text/html", encoding: "quoted-printable", body: "Caf=C3=A9 =E2=80=94 soft=\r\nbreak" }]));
    expect(html).toContain("Café — softbreak");
  });
});
