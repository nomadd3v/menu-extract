import { describe, expect, it } from "vitest";
import { extractFromBuffer, MockLlmClient } from "../src/index.js";
import { parseMhtml } from "../src/input/mhtml.js";
import { at, expectError } from "./helpers.js";

interface Part {
  type: string;
  encoding?: string;
  location?: string;
  body: string;
}

const BOUNDARY = "----=_Part_123";

function buildMhtml(parts: Part[]): Buffer {
  let content = `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`;
  for (const part of parts) {
    content += `\r\n--${BOUNDARY}\r\nContent-Type: ${part.type}\r\n`;
    if (part.encoding) content += `Content-Transfer-Encoding: ${part.encoding}\r\n`;
    if (part.location) content += `Content-Location: ${part.location}\r\n`;
    content += `\r\n${part.body}`;
  }
  return Buffer.from(`${content}\r\n--${BOUNDARY}--\r\n`, "utf8");
}

/** Base64 long enough to pass the tiny-image filter. */
const IMAGE_BASE64 = Buffer.from("A".repeat(200)).toString("base64");

describe("parseMhtml", () => {
  it("extracts the HTML part", () => {
    const { html, images } = parseMhtml(
      buildMhtml([{ type: "text/html", body: "<h1>Menu</h1><p>Burger $10</p>" }]),
    );
    expect(html).toBe("<h1>Menu</h1><p>Burger $10</p>");
    expect(images).toEqual([]);
  });

  it("extracts embedded images with their file name", () => {
    const { images } = parseMhtml(
      buildMhtml([
        { type: "text/html", body: "<p>Menu</p>" },
        {
          type: "image/png",
          encoding: "base64",
          body: IMAGE_BASE64,
          location: "https://example.com/a/logo.png?v=2",
        },
      ]),
    );
    expect(images).toEqual([{ name: "logo.png", mimeType: "image/png", base64: IMAGE_BASE64 }]);
  });

  it("skips tiny images such as tracking pixels", () => {
    const tiny = Buffer.from("x").toString("base64");
    const { images } = parseMhtml(
      buildMhtml([{ type: "image/png", encoding: "base64", body: tiny }]),
    );
    expect(images).toEqual([]);
  });

  it("decodes quoted-printable, including soft breaks and multi-byte UTF-8", () => {
    const body = "Price=3D$10 Caf=C3=A9 =E2=80=94 soft=\r\nbreak";
    const { html } = parseMhtml(
      buildMhtml([{ type: "text/html", encoding: "quoted-printable", body }]),
    );
    expect(html).toBe("Price=$10 Café — softbreak");
  });

  it("decodes base64 HTML", () => {
    const body = Buffer.from("<p>Hello</p>").toString("base64");
    expect(parseMhtml(buildMhtml([{ type: "text/html", encoding: "base64", body }])).html).toBe(
      "<p>Hello</p>",
    );
  });

  it("falls back to the raw text when there is no MIME boundary", () => {
    const raw = "Just some plain text without MIME structure";
    expect(parseMhtml(Buffer.from(raw))).toEqual({ html: raw, images: [] });
  });
});

describe("MHTML in the pipeline", () => {
  it("sends embedded images when the page has no text, capped at maxEmbeddedImages", async () => {
    const images = ["image/png", "image/jpeg", "image/svg+xml", "image/png"].map((type) => ({
      type,
      encoding: "base64",
      body: IMAGE_BASE64,
    }));
    const client = new MockLlmClient("[]");
    const { warnings } = await extractFromBuffer(
      buildMhtml([{ type: "text/html", body: "<img src=a.png>" }, ...images]),
      "page.mhtml",
      { client, maxEmbeddedImages: 2 },
    );
    const request = at(client.calls);
    expect(request.text).toBeUndefined();
    expect(request.images?.map((i) => i.mediaType)).toEqual(["image/png", "image/jpeg"]);
    expect(warnings).toContain("MHTML has 3 images; only the first 2 were sent");
  });

  it("rejects a page with neither text nor usable images", async () => {
    const empty = buildMhtml([{ type: "text/html", body: "<div></div>" }]);
    await expectError(
      () => extractFromBuffer(empty, "page.mhtml", { client: new MockLlmClient("[]") }),
      "UNREADABLE_INPUT",
    );
  });
});
