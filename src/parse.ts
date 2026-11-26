/**
 * Turns raw model output into a validated {@link Menu}.
 *
 * The model is treated as an untrusted source: its output is coerced where the intent is
 * clear ("$6.50" becomes 6.5), and anything unusable is dropped. Every drop or repair is
 * recorded as a warning; nothing is discarded silently.
 *
 * @packageDocumentation
 */
import { MenuExtractError } from "./errors.js";
import {
  MenuSchema,
  ModifierGroupSchema,
  PRICE_VARIANT_KEYS,
  RESTAURANT_TYPES,
  SCHEMA_VERSION,
  type Category,
  type ExtractionResult,
  type ItemKind,
  type MenuItem,
  type ModifierGroup,
  type ModifierOption,
  type ModifierSection,
  type PriceVariantKey,
  type RestaurantType,
} from "./model.js";

/** Context the input stage can supply when the model output lacks it. */
export interface ParseHints {
  /** Used when the model does not return a restaurant name (e.g. the HTML page title). */
  restaurantName?: string;
}

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A trimmed string, or `""` for anything that is not a string. */
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** True for values the model uses to mean "not given". */
const isBlank = (v: unknown): boolean => v === undefined || v === null || v === "";

const round2 = (n: number): number => Math.round(n * 100) / 100;

const KIND_ALIASES: Record<string, ItemKind> = {
  food: "food",
  meal: "food",
  dish: "food",
  beverage: "beverage",
  beverages: "beverage",
  drink: "beverage",
  drinks: "beverage",
  bar: "bar",
  alcohol: "bar",
  cocktail: "bar",
  cocktails: "bar",
};

/**
 * Remove the markdown code fences a model sometimes wraps around JSON.
 *
 * @param raw - Model output.
 * @returns The output without a leading ```` ```json ```` and trailing ```` ``` ````.
 */
export function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

/**
 * Coerce a price the model returned as a number or string.
 *
 * @example `parsePrice("$12.50") === 12.5`, `parsePrice(-1) === null`
 * @param value - A number, or a string such as `"$6.50"` or `" 4 "`.
 * @returns The price rounded to cents, or `null` if it is not a usable non-negative amount.
 */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  return /^\d+(\.\d+)?$/.test(cleaned) ? round2(Number(cleaned)) : null;
}

/**
 * Map the model's item kind (including common aliases such as `"drink"`) to an {@link ItemKind}.
 *
 * @param value - Raw kind from the model.
 * @returns The kind, or `null` when it is not recognised.
 */
export function parseKind(value: unknown): ItemKind | null {
  return KIND_ALIASES[text(value).toLowerCase()] ?? null;
}

function parseOptions(raw: unknown[], label: string, warnings: string[]): ModifierOption[] {
  const options: ModifierOption[] = [];
  for (const o of raw) {
    const name = isObject(o) ? text(o.name) : "";
    if (!isObject(o) || !name) {
      warnings.push(`${label}: option without a name dropped`);
      continue;
    }
    const price = isBlank(o.price) ? 0 : parsePrice(o.price);
    if (price === null) warnings.push(`${label}: option "${name}" has unusable price; set to 0`);
    options.push({ name, price: price ?? 0 });
  }
  return options;
}

function parseSection(
  raw: unknown,
  index: number,
  groupLabel: string,
  warnings: string[],
): ModifierSection | null {
  const name = isObject(raw) ? text(raw.name) : "";
  if (!isObject(raw) || !name || !Array.isArray(raw.options)) {
    warnings.push(`${groupLabel}: section #${index + 1} dropped (needs name and options)`);
    return null;
  }
  const options = parseOptions(raw.options, `${groupLabel}/${name}`, warnings);
  if (options.length === 0) {
    warnings.push(`${groupLabel}: section "${name}" dropped (no valid options)`);
    return null;
  }
  let min = Number.isInteger(raw.min) ? Math.max(0, raw.min as number) : 0;
  const max = Number.isInteger(raw.max) ? Math.max(1, raw.max as number) : 1;
  if (min > max) {
    warnings.push(
      `${groupLabel}: section "${name}" had min ${min} > max ${max}; min lowered to ${max}`,
    );
    min = max;
  }
  return { name, min, max, options };
}

/**
 * Validate the model's `modifierGroups`, dropping (with a warning) anything unusable.
 *
 * @param raw - The raw `modifierGroups` value.
 * @param warnings - Receives one entry per drop or repair.
 */
function parseModifierGroups(raw: unknown, warnings: string[]): ModifierGroup[] {
  if (isBlank(raw)) return [];
  if (!Array.isArray(raw)) {
    warnings.push("modifierGroups is not an array; ignored");
    return [];
  }
  const groups: ModifierGroup[] = [];
  const seen = new Set<string>();
  raw.forEach((g: unknown, gi) => {
    const name = isObject(g) ? text(g.name) : "";
    const label = name ? `modifier group "${name}"` : `modifier group #${gi + 1}`;
    if (!isObject(g) || !Array.isArray(g.sections)) {
      warnings.push(`${label} dropped: no sections`);
      return;
    }
    const sections = g.sections
      .map((s: unknown, si) => parseSection(s, si, label, warnings))
      .filter((s): s is ModifierSection => s !== null);
    if (sections.length === 0) {
      warnings.push(`${label} dropped: no valid sections`);
      return;
    }
    const parsed = ModifierGroupSchema.safeParse({ name, sections });
    if (!parsed.success) {
      warnings.push(`${label} dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      return;
    }
    const key = parsed.data.name.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`${label} dropped: duplicate name`);
      return;
    }
    seen.add(key);
    groups.push(parsed.data);
  });
  return groups;
}

function parsePriceVariants(
  raw: unknown,
  itemName: string,
  warnings: string[],
): MenuItem["priceVariants"] {
  if (!isObject(raw)) return undefined;
  const variants: Partial<Record<PriceVariantKey, number>> = {};
  for (const key of PRICE_VARIANT_KEYS) {
    const value = raw[key];
    if (isBlank(value)) continue;
    const price = parsePrice(value);
    if (price === null) {
      warnings.push(`"${itemName}": unusable ${key} price ${JSON.stringify(value)}; ignored`);
    } else {
      variants[key] = price;
    }
  }
  return Object.keys(variants).length > 0 ? variants : undefined;
}

/** A validated item plus the section it belongs to. */
interface PlacedItem {
  section: string;
  item: MenuItem;
}

/**
 * Validate one raw item. `groupNames` maps lower-cased group names to their canonical spelling.
 *
 * @returns The item and its section, or `null` if it was dropped (with a warning).
 */
function parseItem(
  raw: unknown,
  index: number,
  groupNames: ReadonlyMap<string, string>,
  warnings: string[],
): PlacedItem | null {
  if (!isObject(raw)) {
    warnings.push(`item #${index + 1} dropped: not an object`);
    return null;
  }
  const name = text(raw.name);
  if (!name) {
    warnings.push(`item #${index + 1} dropped: missing name`);
    return null;
  }
  const kind = raw.kind === undefined ? "food" : parseKind(raw.kind);
  if (!kind) {
    warnings.push(`"${name}" dropped: unknown kind ${JSON.stringify(raw.kind)}`);
    return null;
  }

  let price = 0;
  if (!isBlank(raw.price)) {
    const parsed = parsePrice(raw.price);
    if (parsed === null) {
      warnings.push(`"${name}": unusable price ${JSON.stringify(raw.price)}; set to 0`);
    } else {
      price = parsed;
    }
  }
  if (price === 0) warnings.push(`"${name}": no price found`);

  const item: MenuItem = { name, kind, price };
  const description = text(raw.description);
  if (description) item.description = description;
  const priceVariants = parsePriceVariants(raw.priceVariants, name, warnings);
  if (priceVariants) item.priceVariants = priceVariants;

  const groupRef = text(raw.modifierGroup);
  if (groupRef) {
    const canonical = groupNames.get(groupRef.toLowerCase());
    if (canonical) {
      item.modifierGroup = canonical;
    } else {
      warnings.push(
        `"${name}": references unknown modifier group "${groupRef}"; reference removed`,
      );
    }
  }

  const section = text(raw.section) || text(raw.category) || "Uncategorized";
  return { section, item };
}

/** Group items into categories in first-seen order, dropping case-insensitive duplicates. */
function groupIntoCategories(items: PlacedItem[], warnings: string[]): Category[] {
  const categories = new Map<string, Category>();
  const seen = new Set<string>();
  for (const { section, item } of items) {
    const sectionKey = section.toLowerCase();
    const itemKey = `${sectionKey}\u0000${item.name.toLowerCase()}`;
    if (seen.has(itemKey)) {
      warnings.push(`"${item.name}" in "${section}" appears more than once; duplicate dropped`);
      continue;
    }
    seen.add(itemKey);
    let category = categories.get(sectionKey);
    if (!category) {
      category = { name: section, items: [] };
      categories.set(sectionKey, category);
    }
    category.items.push(item);
  }
  return [...categories.values()];
}

function parseRestaurantType(raw: unknown): RestaurantType {
  const value = text(raw).toLowerCase();
  return RESTAURANT_TYPES.find((t) => t === value) ?? "other";
}

/**
 * Parse and validate raw model output into a {@link Menu}.
 *
 * Accepts either a bare array of items or an object
 * `{ restaurantName, restaurantType, items, modifierGroups }`, optionally wrapped in markdown
 * fences. Unusable items, options and groups are dropped with a warning; references to
 * unknown modifier groups are removed with a warning.
 *
 * @param rawText - The model's raw text output.
 * @param hints - Fallbacks from the input stage, such as a page title.
 * @returns The validated menu and every warning produced along the way.
 * @throws {@link MenuExtractError} `INVALID_JSON` when the text is not JSON, or
 *   `INVALID_RESPONSE` when it has no `items` array.
 */
export function parseModelResponse(rawText: string, hints: ParseHints = {}): ExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(rawText));
  } catch (cause) {
    throw new MenuExtractError("INVALID_JSON", "Model returned invalid JSON", { cause });
  }

  let root: JsonObject;
  if (Array.isArray(parsed)) root = { items: parsed };
  else if (isObject(parsed) && Array.isArray(parsed.items)) root = parsed;
  else throw new MenuExtractError("INVALID_RESPONSE", "Model response has no items array");
  const rawItems = root.items as unknown[];

  const warnings: string[] = [];
  const modifierGroups = parseModifierGroups(root.modifierGroups, warnings);
  const groupNames = new Map(modifierGroups.map((g) => [g.name.toLowerCase(), g.name]));

  const placed = rawItems
    .map((raw, i) => parseItem(raw, i, groupNames, warnings))
    .filter((p): p is PlacedItem => p !== null);
  const categories = groupIntoCategories(placed, warnings);

  const used = new Set(placed.map((p) => p.item.modifierGroup));
  for (const g of modifierGroups) {
    if (!used.has(g.name)) warnings.push(`modifier group "${g.name}" is not used by any item`);
  }

  if (categories.length === 0) warnings.push("no valid items were extracted");

  const restaurantName = text(root.restaurantName) || hints.restaurantName?.trim() || undefined;
  const result = MenuSchema.safeParse({
    schemaVersion: SCHEMA_VERSION,
    ...(restaurantName ? { restaurantName } : {}),
    restaurantType: parseRestaurantType(root.restaurantType),
    categories,
    modifierGroups,
  });
  if (!result.success) {
    // Unreachable by construction; kept so a future model change fails loudly, not silently.
    throw new MenuExtractError(
      "INVALID_RESPONSE",
      `Menu failed validation: ${result.error.message}`,
      {
        cause: result.error,
      },
    );
  }
  return { menu: result.data, warnings };
}
