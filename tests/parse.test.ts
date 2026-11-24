import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseModelResponse, parsePrice, stripFences } from "../src/parse.js";
import { MenuSchema } from "../src/model.js";

const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");

describe("parsePrice", () => {
  it("handles numbers, $ strings and rejects junk", () => {
    expect(parsePrice(12.5)).toBe(12.5);
    expect(parsePrice("$6.50")).toBe(6.5);
    expect(parsePrice(" 4 ")).toBe(4);
    expect(parsePrice(-1)).toBeNull();
    expect(parsePrice("free")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice(Number.NaN)).toBeNull();
  });
});

describe("stripFences", () => {
  it("removes json fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseModelResponse", () => {
  it("parses a clean response into categories in menu order", () => {
    const { menu, warnings } = parseModelResponse(fx("fictional-diner.response.json"));
    expect(MenuSchema.safeParse(menu).success).toBe(true);
    expect(menu.restaurantName).toBe("Fictional Diner");
    expect(menu.categories.map((c) => c.name)).toEqual(["Breakfast", "Burgers", "Drinks"]);
    expect(menu.categories[0].items.map((i) => i.name)).toEqual(["Two Egg Plate", "Pancake Stack"]);
    expect(menu.categories[2].items[1]).toMatchObject({ kind: "bar", priceVariants: { bar: 5 } });
    expect(menu.modifierGroups).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it("accepts fenced output, string prices, kind aliases, case-insensitive group refs", () => {
    const { menu } = parseModelResponse(fx("nowhere-noodle-bar.response.txt"));
    const starters = menu.categories[0].items;
    expect(starters[0].price).toBe(6.5);
    const noodles = menu.categories[1].items;
    expect(noodles.map((i) => i.modifierGroup)).toEqual(["Broth", "Broth", undefined]);
    expect(menu.categories[2].items[0].kind).toBe("beverage");
  });

  it("reports every drop instead of hiding it", () => {
    const { menu, warnings } = parseModelResponse(fx("nowhere-noodle-bar.response.txt"));
    const all = menu.categories.flatMap((c) => c.items);
    expect(all).toHaveLength(7);
    expect(warnings).toContain("item #8 dropped: missing name");
    expect(warnings.some((w) => w.includes("Mystery Item") && w.includes("unknown kind"))).toBe(true);
  });

  it("repairs bad modifier data and cross-checks references", () => {
    const { menu, warnings } = parseModelResponse(fx("imaginary-pizza-planet.response.json"));
    expect(warnings.some((w) => w.includes('unknown modifier group "Does Not Exist"'))).toBe(true);
    expect(menu.categories[1].items[0].modifierGroup).toBeUndefined();
    // "Unused Group" survives after min is lowered and the unusable price is zeroed
    const unused = menu.modifierGroups.find((g) => g.name === "Unused Group");
    expect(unused?.sections[0]).toMatchObject({ min: 1, max: 1 });
    expect(unused?.sections[0].options[0].price).toBe(0);
    expect(warnings.some((w) => w.includes("min 3 > max 1"))).toBe(true);
    expect(warnings).toContain('modifier group "Unused Group" is not used by any item');
  });

  it("accepts a bare array and defaults missing section and kind", () => {
    const { menu } = parseModelResponse('[{"name":"Soup","price":4}]');
    expect(menu.categories).toEqual([{ name: "Uncategorized", items: [{ name: "Soup", kind: "food", price: 4 }] }]);
    expect(menu.restaurantType).toBe("other");
  });

  it("drops exact duplicates within a section with a warning", () => {
    const { menu, warnings } = parseModelResponse(
      '[{"name":"Soup","section":"A","price":4},{"name":"soup","section":"a","price":5}]',
    );
    expect(menu.categories[0].items).toHaveLength(1);
    expect(warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });

  it("warns on zero price and unusable price", () => {
    const { menu, warnings } = parseModelResponse('[{"name":"A","price":"n/a"},{"name":"B"}]');
    expect(menu.categories[0].items.map((i) => i.price)).toEqual([0, 0]);
    expect(warnings.filter((w) => w.includes("no price found"))).toHaveLength(2);
  });

  it("falls back to the page-title hint for the name", () => {
    const { menu } = parseModelResponse('[{"name":"Soup","price":1}]', { restaurantName: "Hinted Cafe" });
    expect(menu.restaurantName).toBe("Hinted Cafe");
  });

  it("throws on non-JSON and on structure without items", () => {
    expect(() => parseModelResponse("sorry, I cannot")).toThrow(/invalid JSON/);
    expect(() => parseModelResponse('{"foo":1}')).toThrow(/no items/);
  });
});
