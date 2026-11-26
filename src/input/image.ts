/**
 * Image preparation via the optional peer `sharp`: apply EXIF orientation and downscale
 * oversized photos. Without `sharp`, images are passed through unchanged.
 *
 * @packageDocumentation
 */
type SharpFactory = (typeof import("sharp"))["default"];

let sharpPromise: Promise<SharpFactory | null> | undefined;

function loadSharp(): Promise<SharpFactory | null> {
  sharpPromise ??= import("sharp").then(
    (m) => m.default,
    () => null,
  );
  return sharpPromise;
}

/** Result of {@link prepareImage}. */
export interface PreparedImage {
  /** Image bytes to send to the model. */
  buffer: Buffer;
  /** True when the image was downscaled and re-encoded as JPEG. */
  resized: boolean;
  /** False when `sharp` is not installed and the input was passed through untouched. */
  processed: boolean;
}

/**
 * Apply EXIF orientation, then downscale to fit within `maxDimension` (re-encoding as
 * JPEG). Images that already fit keep their format. If `sharp` is missing or cannot decode
 * the image, the original bytes are returned.
 *
 * @param buffer - Image bytes (JPEG, PNG, GIF or WebP).
 * @param maxDimension - Longest allowed side in pixels.
 */
export async function prepareImage(buffer: Buffer, maxDimension: number): Promise<PreparedImage> {
  const sharp = await loadSharp();
  if (!sharp) return { buffer, resized: false, processed: false };
  try {
    const oriented = await sharp(buffer).rotate().toBuffer();
    const { width, height } = await sharp(oriented).metadata();
    if (width <= maxDimension && height <= maxDimension) {
      return { buffer: oriented, resized: false, processed: true };
    }

    const resized = await sharp(oriented)
      .resize(maxDimension, maxDimension, { fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: resized, resized: true, processed: true };
  } catch {
    return { buffer, resized: false, processed: false };
  }
}
