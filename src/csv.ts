import type { Menu } from "./model.js";

/** Column order of {@link menuToCsv}. */
export const CSV_COLUMNS = [
  "category",
  "name",
  "kind",
  "price",
  "description",
  "modifierGroup",
] as const;

/** Quote a field when it contains a comma, quote or line break (RFC 4180). */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Flatten a menu to CSV, one row per item, with the header {@link CSV_COLUMNS}.
 * Prices use two decimals; missing optional fields are empty. Modifier groups and price
 * variants are not included: this is a convenience export, not a target-system format.
 *
 * @param menu - A validated menu.
 * @returns CSV text with `\n` line endings and a trailing newline.
 */
export function menuToCsv(menu: Menu): string {
  const rows = menu.categories.flatMap((category) =>
    category.items.map((item) =>
      [
        category.name,
        item.name,
        item.kind,
        item.price.toFixed(2),
        item.description ?? "",
        item.modifierGroup ?? "",
      ]
        .map(csvField)
        .join(","),
    ),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}
