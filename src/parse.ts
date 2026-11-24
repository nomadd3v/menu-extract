import {
  MenuSchema, ModifierGroupSchema, PRICE_VARIANT_KEYS, RESTAURANT_TYPES,
  type Category, type ExtractionResult, type ItemKind, type MenuItem, type ModifierGroup,
} from "./model.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Remove markdown fences the model sometimes wraps around JSON. */
export function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

/** "$12.50", "12.5", 12.5 -> 12.5. Returns null if it is not a usable non-negative price. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? round2(v) : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return round2(Number(cleaned));
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseKind(v: unknown): ItemKind | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (["food", "meal", "dish"].includes(s)) return "food";
  if (["beverage", "beverages", "drink", "drinks"].includes(s)) return "beverage";
  if (["bar", "alcohol", "cocktail", "cocktails"].includes(s)) return "bar";
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseGroups(raw: unknown, warnings: string[]): ModifierGroup[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push("modifierGroups is not an array; ignored");
    return [];
  }
  const out: ModifierGroup[] = [];
  const seen = new Set<string>();
  raw.forEach((g, gi) => {
    const label = isObj(g) && str(g.name) ? `modifier group "${str(g.name)}"` : `modifier group #${gi + 1}`;
    if (!isObj(g) || !Array.isArray(g.sections)) {
      warnings.push(`${label} dropped: no sections`);
      return;
    }
    const sections = [];
    for (const [si, s] of g.sections.entries()) {
      if (!isObj(s) || !str(s.name) || !Array.isArray(s.options)) {
        warnings.push(`${label}: section #${si + 1} dropped (needs name and options)`);
        continue;
      }
      const options = [];
      for (const o of s.options) {
        if (!isObj(o) || !str(o.name)) {
          warnings.push(`${label}/${str(s.name)}: option without a name dropped`);
          continue;
        }
        const price = o.price === undefined || o.price === null ? 0 : parsePrice(o.price);
        if (price === null) {
          warnings.push(`${label}/${str(s.name)}: option "${str(o.name)}" has unusable price; set to 0`);
        }
        options.push({ name: str(o.name), price: price ?? 0 });
      }
      if (options.length === 0) {
        warnings.push(`${label}: section "${str(s.name)}" dropped (no valid options)`);
        continue;
      }
      let min = Number.isInteger(s.min) ? (s.min as number) : 0;
      let max = Number.isInteger(s.max) ? (s.max as number) : 1;
      if (min < 0) min = 0;
      if (max < 1) max = 1;
      if (min > max) {
        warnings.push(`${label}: section "${str(s.name)}" had min ${min} > max ${max}; min lowered to ${max}`);
        min = max;
      }
      sections.push({ name: str(s.name), min, max, options });
    }
    if (sections.length === 0) {
      warnings.push(`${label} dropped: no valid sections`);
      return;
    }
    const parsed = ModifierGroupSchema.safeParse({ name: str(g.name), sections });
    if (!parsed.success) {
      warnings.push(`${label} dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      return;
    }
    if (seen.has(parsed.data.name.toLowerCase())) {
      warnings.push(`${label} dropped: duplicate name`);
      return;
    }
    seen.add(parsed.data.name.toLowerCase());
    out.push(parsed.data);
  });
  return out;
}

/**
 * Parse and validate raw model output into a Menu.
 *
 * Accepts a bare items array or `{ restaurantName, restaurantType, items, modifierGroups }`.
 * Invalid items are dropped *with a warning* (never silently). Throws only when the text
 * is not JSON or has no recognisable structure.
 */
export function parseModelResponse(rawText: string, hints: { restaurantName?: string } = {}): ExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(rawText));
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const warnings: string[] = [];
  let root: Obj;
  if (Array.isArray(parsed)) root = { items: parsed };
  else if (isObj(parsed) && Array.isArray(parsed.items)) root = parsed;
  else throw new Error("Model response has no items array");

  const modifierGroups = parseGroups(root.modifierGroups, warnings);
  const groupNames = new Map(modifierGroups.map((g) => [g.name.toLowerCase(), g.name]));

  const categories: Category[] = [];
  const catIndex = new Map<string, Category>();
  const referenced = new Set<string>();
  const seenItems = new Set<string>();

  (root.items as unknown[]).forEach((raw, i) => {
    const where = `item #${i + 1}`;
    if (!isObj(raw)) {
      warnings.push(`${where} dropped: not an object`);
      return;
    }
    const name = str(raw.name);
    if (!name) {
      warnings.push(`${where} dropped: missing name`);
      return;
    }
    const kind = raw.kind === undefined ? "food" : parseKind(raw.kind);
    if (!kind) {
      warnings.push(`"${name}" dropped: unknown kind ${JSON.stringify(raw.kind)}`);
      return;
    }
    let price = 0;
    if (raw.price !== undefined && raw.price !== null && raw.price !== "") {
      const p = parsePrice(raw.price);
      if (p === null) warnings.push(`"${name}": unusable price ${JSON.stringify(raw.price)}; set to 0`);
      else price = p;
    }
    let priceVariants: MenuItem["priceVariants"];
    if (isObj(raw.priceVariants)) {
      const pv: Record<string, number> = {};
      for (const k of PRICE_VARIANT_KEYS) {
        const v = raw.priceVariants[k];
        if (v === undefined || v === null || v === "") continue;
        const p = parsePrice(v);
        if (p === null) warnings.push(`"${name}": unusable ${k} price ${JSON.stringify(v)}; ignored`);
        else pv[k] = p;
      }
      if (Object.keys(pv).length) priceVariants = pv;
    }
    let modifierGroup: string | undefined;
    const mg = str(raw.modifierGroup);
    if (mg) {
      const canonical = groupNames.get(mg.toLowerCase());
      if (canonical) {
        modifierGroup = canonical;
        referenced.add(canonical);
      } else {
        warnings.push(`"${name}": references unknown modifier group "${mg}"; reference removed`);
      }
    }
    const section = str(raw.section) || str(raw.category) || "Uncategorized";
    const key = `${section.toLowerCase()}\u0000${name.toLowerCase()}`;
    if (seenItems.has(key)) {
      warnings.push(`"${name}" in "${section}" appears more than once; duplicate dropped`);
      return;
    }
    seenItems.add(key);

    let cat = catIndex.get(section.toLowerCase());
    if (!cat) {
      cat = { name: section, items: [] };
      catIndex.set(section.toLowerCase(), cat);
      categories.push(cat);
    }
    const item: MenuItem = { name, kind, price };
    const desc = str(raw.description);
    if (desc) item.description = desc;
    if (priceVariants) item.priceVariants = priceVariants;
    if (modifierGroup) item.modifierGroup = modifierGroup;
    if (price === 0) warnings.push(`"${name}": no price found`);
    cat.items.push(item);
  });

  for (const g of modifierGroups) {
    if (!referenced.has(g.name)) warnings.push(`modifier group "${g.name}" is not used by any item`);
  }

  const rt = str(root.restaurantType).toLowerCase();
  const restaurantType = (RESTAURANT_TYPES as readonly string[]).includes(rt)
    ? (rt as (typeof RESTAURANT_TYPES)[number])
    : "other";
  const restaurantName = str(root.restaurantName) || hints.restaurantName || undefined;

  const menu = MenuSchema.parse({
    schemaVersion: "1.0",
    ...(restaurantName ? { restaurantName } : {}),
    restaurantType,
    categories,
    modifierGroups,
  });
  if (menu.categories.length === 0) warnings.push("no valid items were extracted");
  return { menu, warnings };
}
