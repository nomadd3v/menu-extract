import { describe, expect, it } from "vitest";
import { detectKind } from "../src/index.js";
import { asImageMediaType, sniffImageType } from "../src/detect.js";

const bytes = (...values: number[]): Buffer => Buffer.from(values);

describe("detectKind", () => {
  it("trusts binary signatures over the extension", () => {
    expect(detectKind(Buffer.from("%PDF-1.4"), "menu.txt")).toBe("pdf");
    expect(detectKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d), "menu.txt")).toBe("image");
    expect(detectKind(bytes(0xff, 0xd8, 0xff), "menu")).toBe("image");
    expect(detectKind(Buffer.from("GIF89a"), "menu")).toBe("image");
    expect(detectKind(Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "menu")).toBe("image");
    expect(detectKind(Buffer.from("{\\rtf1\\ansi"), "menu.txt")).toBe("rtf");
  });

  it("uses the extension to tell zip-based Office formats apart", () => {
    expect(detectKind(Buffer.from("PK\u0003\u0004"), "a.pptx")).toBe("pptx");
    expect(detectKind(Buffer.from("PK\u0003\u0004"), "a.docx")).toBe("docx");
    expect(detectKind(Buffer.from("PK\u0003\u0004"), "")).toBe("docx");
  });

  it("recognises MHTML by extension or MIME header", () => {
    expect(detectKind(Buffer.from("anything"), "page.mht")).toBe("mhtml");
    expect(detectKind(Buffer.from("anything"), "page.MHTML")).toBe("mhtml");
    expect(detectKind(Buffer.from("MIME-Version: 1.0\n"), "x")).toBe("mhtml");
    expect(detectKind(Buffer.from("From: <Saved by a browser>\nSubject: Menu\n"), "x")).toBe(
      "mhtml",
    );
  });

  it("recognises HTML by extension or markup and defaults to text", () => {
    expect(detectKind(Buffer.from("plain"), "menu.htm")).toBe("html");
    expect(detectKind(Buffer.from("<!DOCTYPE html><title>x</title>"), "x")).toBe("html");
    expect(detectKind(Buffer.from("  <body>Soup</body>"), "x")).toBe("html");
    expect(detectKind(Buffer.from("Soup 4.00"), "menu.txt")).toBe("text");
    expect(detectKind(Buffer.from("not really a jpeg"), "photo.jpg")).toBe("text");
  });
});

describe("image type helpers", () => {
  it("sniff image signatures", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("hello"))).toBeNull();
  });

  it("accept only media types the LLM layer supports", () => {
    expect(asImageMediaType("image/webp")).toBe("image/webp");
    expect(asImageMediaType("image/svg+xml")).toBeNull();
  });
});
