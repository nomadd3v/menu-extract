import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFromBuffer, MockLlmClient } from "../src/index.js";
import { at, canImport } from "./helpers.js";

const hasSharp = await canImport("sharp");

async function png(width: number, height: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
}

describe.skipIf(!hasSharp)("image input (optional peer sharp)", () => {
  it("downscales oversized images to JPEG within maxImageDimension", async () => {
    const sharp = (await import("sharp")).default;
    const client = new MockLlmClient("[]");
    const { warnings } = await extractFromBuffer(await png(3000, 1000), "m.png", { client });
    const image = at(at(client.calls).images ?? []);
    expect(image.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(image.base64, "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([2048, 683]);
    expect(warnings.filter((w) => w.includes("sharp"))).toEqual([]);
  });

  it("keeps the original format when the image already fits", async () => {
    const client = new MockLlmClient("[]");
    await extractFromBuffer(await png(100, 100), "m.png", { client, maxImageDimension: 512 });
    expect(at(at(client.calls).images ?? []).mediaType).toBe("image/png");
  });

  it("applies EXIF orientation", async () => {
    const sharp = (await import("sharp")).default;
    const rotated = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#000" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 }) // "rotate 90° clockwise to display"
      .toBuffer();
    const client = new MockLlmClient("[]");
    await extractFromBuffer(rotated, "photo.jpg", { client });
    const meta = await sharp(
      Buffer.from(at(at(client.calls).images ?? []).base64, "base64"),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
  });
});

describe("image input without sharp installed", () => {
  afterEach(() => {
    vi.doUnmock("sharp");
    vi.resetModules();
  });

  it("sends the image untouched and warns", async () => {
    vi.resetModules();
    vi.doMock("sharp", () => {
      throw new Error("Cannot find package 'sharp'");
    });
    const { extractFromBuffer: extract, MockLlmClient: Mock } = await import("../src/index.js");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const client = new Mock("[]");
    const { warnings } = await extract(jpeg, "photo.jpg", { client });
    expect(at(client.calls).images).toEqual([
      { mediaType: "image/jpeg", base64: jpeg.toString("base64") },
    ]);
    expect(warnings.some((w) => w.includes("sharp is not installed"))).toBe(true);
  });
});
