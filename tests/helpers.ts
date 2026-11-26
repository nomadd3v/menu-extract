import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { MenuExtractError, type MenuExtractErrorCode } from "../src/index.js";

/** Absolute path of a file in `fixtures/`. */
export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** Contents of a file in `fixtures/` as UTF-8. */
export const fixture = (name: string): string => readFileSync(fixturePath(name), "utf8");

/** The element at `index`, failing the test if it does not exist. */
export function at<T>(list: readonly T[], index = 0): T {
  const value = list[index];
  if (value === undefined) throw new Error(`expected an element at index ${index}`);
  return value;
}

/** Assert that `run` throws (or rejects with) a MenuExtractError carrying `code`. */
export async function expectError(
  run: () => unknown,
  code: MenuExtractErrorCode,
): Promise<MenuExtractError> {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(MenuExtractError);
  expect((error as MenuExtractError).code).toBe(code);
  return error as MenuExtractError;
}

/** Whether an optional peer dependency can be imported. */
export async function canImport(specifier: string): Promise<boolean> {
  try {
    await import(specifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * A minimal PDF with one line of Helvetica text per page. Each string becomes a page;
 * pass `""` for a page with no text layer.
 */
export function buildPdf(pages: readonly string[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // page tree, filled in once the kids are known
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = pages.map((line) => {
    const escaped = line.replace(/[\\()]/g, "\\$&");
    const stream = line ? `BT /F1 14 Tf 20 100 Td (${escaped}) Tj ET` : "";
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Contents ${contents} 0 R ` +
        `/Resources << /Font << /F1 ${font} 0 R >> >> >>`,
    );
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
