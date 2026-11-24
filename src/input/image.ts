/**
 * Server-side image processing via sharp.
 * Gracefully degrades if sharp native binary is unavailable.
 */

interface SharpModule {
  default: (input: Buffer) => {
    rotate: () => {
      toBuffer: () => Promise<Buffer>;
    };
    metadata: () => Promise<{ width?: number; height?: number }>;
    extract: (region: { left: number; top: number; width: number; height: number }) => {
      jpeg: (options: { quality: number }) => {
        toBuffer: () => Promise<Buffer>;
      };
    };
    resize: (width: number, height: number, options: { fit: string }) => {
      jpeg: (options: { quality: number }) => {
        toBuffer: () => Promise<Buffer>;
      };
    };
  };
}

let sharpModule: SharpModule | null = null;
let sharpLoaded = false;

async function getSharp(): Promise<SharpModule | null> {
  if (sharpLoaded) return sharpModule;
  sharpLoaded = true;
  try {
    sharpModule = (await import("sharp")) as unknown as SharpModule;
    return sharpModule;
  } catch {
    console.warn("[menu-extract] optional dependency 'sharp' not installed: images are sent unresized");
    return null;
  }
}

/**
 * Normalize EXIF rotation. Returns corrected buffer, or original if sharp unavailable.
 */
export async function normalizeRotation(buffer: Buffer): Promise<Buffer> {
  const mod = await getSharp();
  if (!mod) return buffer;
  try {
    return await mod.default(buffer).rotate().toBuffer();
  } catch {
    return buffer;
  }
}

export interface ResizeResult {
  buffer: Buffer;
  resized: boolean;
}

/**
 * Resize image to fit within maxDim and convert to JPEG.
 * Returns original buffer if sharp unavailable or image already fits.
 */
export async function resizeImage(
  buffer: Buffer,
  options: { maxDim?: number; quality?: number } = {},
): Promise<ResizeResult> {
  const { maxDim = 2048, quality = 85 } = options;
  const mod = await getSharp();
  if (!mod) return { buffer, resized: false };

  try {
    const sharp = mod.default(buffer);
    const meta = await sharp.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;

    if (w <= maxDim && h <= maxDim) return { buffer, resized: false };

    const scale = maxDim / Math.max(w, h);
    const newW = Math.round(w * scale);
    const newH = Math.round(h * scale);

    const resizedBuffer = await mod
      .default(buffer)
      .resize(newW, newH, { fit: "inside" })
      .jpeg({ quality })
      .toBuffer();

    return { buffer: resizedBuffer, resized: true };
  } catch {
    return { buffer, resized: false };
  }
}

