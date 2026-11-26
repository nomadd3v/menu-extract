import type { Menu } from "./model.js";

const esc = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Flat CSV of items: category,name,kind,price,description,modifierGroup. */
export function menuToCsv(menu: Menu): string {
  const rows = [["category", "name", "kind", "price", "description", "modifierGroup"].join(",")];
  for (const c of menu.categories) {
    for (const i of c.items) {
      rows.push([c.name, i.name, i.kind, i.price.toFixed(2), i.description ?? "", i.modifierGroup ?? ""].map(esc).join(","));
    }
  }
  return rows.join("\n") + "\n";
}
