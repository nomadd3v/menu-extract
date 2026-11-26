import { describe, expect, it } from "vitest";
import {
  MenuSchema,
  parseKind,
  parseModelResponse,
  parsePrice,
  stripFences,
} from "../src/index.js";
import { at, expectError, fixture } from "./helpers.js";

describe("parsePrice", () => {
  it("accepts numbers and currency strings, rounding to cents", () => {
    expect(parsePrice(12.5)).toBe(12.5);
    expect(parsePrice("$6.50")).toBe(6.5);
    expect(parsePrice(" 4 ")).toBe(4);
    expect(parsePrice(3.14159)).toBe(3.14);
  });

  it("rejects negatives, non-numbers and junk", () => {
    expect(parsePrice(-1)).toBeNull();
    expect(parsePrice("-2.00")).toBeNull();
    expect(parsePrice("free")).toBeNull();
    expect(parsePrice("1.2.3")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice(Number.NaN)).toBeNull();
    expect(parsePrice(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("parseKind", () => {
  it("maps aliases case-insensitively and rejects unknown kinds", () => {
    expect(parseKind("Drinks")).toBe("beverage");
    expect(parseKind(" cocktail ")).toBe("bar");
    expect(parseKind("dish")).toBe("food");
    expect(parseKind("furniture")).toBeNull();
    expect(parseKind(42)).toBeNull();
  });
});

describe("stripFences", () => {
  it("removes json fences and leaves bare JSON alone", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences("```\n[1]\n```")).toBe("[1]");
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseModelResponse", () => {
  it("parses a clean response into categories in menu order", () => {
    const { menu, warnings } = parseModelResponse(fixture("fictional-diner.response.json"));
    expect(MenuSchema.safeParse(menu).success).toBe(true);
    expect(menu.schemaVersion).toBe("1.0");
    expect(menu.restaurantName).toBe("Fictional Diner");
    expect(menu.categories.map((c) => c.name)).toEqual(["Breakfast", "Burgers", "Drinks"]);
    expect(at(menu.categories, 0).items.map((i) => i.name)).toEqual([
      "Two Egg Plate",
      "Pancake Stack",
    ]);
    expect(at(at(menu.categories, 2).items, 1)).toMatchObject({
      kind: "bar",
      priceVariants: { bar: 5 },
    });
    expect(menu.modifierGroups).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it("accepts fenced output, string prices, kind aliases and case-insensitive group refs", () => {
    const { menu } = parseModelResponse(fixture("nowhere-noodle-bar.response.txt"));
    expect(at(at(menu.categories, 0).items).price).toBe(6.5);
    expect(at(menu.categories, 1).items.map((i) => i.modifierGroup)).toEqual([
      "Broth",
      "Broth",
      undefined,
    ]);
    expect(at(at(menu.categories, 2).items).kind).toBe("beverage");
  });

  it("reports every drop instead of hiding it", () => {
    const { menu, warnings } = parseModelResponse(fixture("nowhere-noodle-bar.response.txt"));
    expect(menu.categories.flatMap((c) => c.items)).toHaveLength(7);
    expect(warnings).toContain("item #8 dropped: missing name");
    expect(warnings.some((w) => w.includes("Mystery Item") && w.includes("unknown kind"))).toBe(
      true,
    );
  });

  it("repairs bad modifier data and cross-checks references", () => {
    const { menu, warnings } = parseModelResponse(fixture("imaginary-pizza-planet.response.json"));
    expect(warnings.some((w) => w.includes('unknown modifier group "Does Not Exist"'))).toBe(true);
    expect(at(at(menu.categories, 1).items).modifierGroup).toBeUndefined();
    const unused = menu.modifierGroups.find((g) => g.name === "Unused Group");
    expect(unused?.sections[0]).toMatchObject({ min: 1, max: 1 });
    expect(unused?.sections[0]?.options[0]?.price).toBe(0);
    expect(warnings.some((w) => w.includes("min 3 > max 1"))).toBe(true);
    expect(warnings).toContain('modifier group "Unused Group" is not used by any item');
  });

  it("drops malformed modifier groups, sections and options with warnings", () => {
    const { menu, warnings } = parseModelResponse(
      JSON.stringify({
        items: [{ name: "Soup", price: 4, modifierGroup: "Size" }],
        modifierGroups: [
          {
            name: "Size",
            sections: [{ name: "Size", min: 1, max: 1, options: [{ name: "Cup" }, {}] }],
          },
          { name: "size", sections: [{ name: "Again", options: [{ name: "Bowl" }] }] },
          { name: "Empty", sections: [{ name: "Nothing", options: [] }, "junk"] },
          { name: "No Sections" },
        ],
      }),
    );
    expect(menu.modifierGroups.map((g) => g.name)).toEqual(["Size"]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'modifier group "Size"/Size: option without a name dropped',
        'modifier group "size" dropped: duplicate name',
        'modifier group "Empty": section "Nothing" dropped (no valid options)',
        'modifier group "Empty": section #2 dropped (needs name and options)',
        'modifier group "Empty" dropped: no valid sections',
        'modifier group "No Sections" dropped: no sections',
      ]),
    );
  });

  it("warns when modifierGroups is not an array", () => {
    const { warnings } = parseModelResponse(
      '{"items":[{"name":"A","price":1}],"modifierGroups":{}}',
    );
    expect(warnings).toContain("modifierGroups is not an array; ignored");
  });

  it("keeps valid price variants and drops unusable ones", () => {
    const { menu, warnings } = parseModelResponse(
      '[{"name":"Tea","price":2,"priceVariants":{"delivery":"$2.50","bar":"n/a","patio":9}}]',
    );
    expect(at(at(menu.categories).items).priceVariants).toEqual({ delivery: 2.5 });
    expect(warnings).toContain('"Tea": unusable bar price "n/a"; ignored');
  });

  it("accepts a bare array and defaults the section, kind and restaurant type", () => {
    const { menu } = parseModelResponse('[{"name":"Soup","price":4}]');
    expect(menu.categories).toEqual([
      { name: "Uncategorized", items: [{ name: "Soup", kind: "food", price: 4 }] },
    ]);
    expect(menu.restaurantType).toBe("other");
  });

  it("drops case-insensitive duplicates within a section with a warning", () => {
    const { menu, warnings } = parseModelResponse(
      '[{"name":"Soup","section":"A","price":4},{"name":"soup","section":"a","price":5}]',
    );
    expect(at(menu.categories).items).toHaveLength(1);
    expect(warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });

  it("warns on missing and unusable prices", () => {
    const { menu, warnings } = parseModelResponse('[{"name":"A","price":"n/a"},{"name":"B"}]');
    expect(at(menu.categories).items.map((i) => i.price)).toEqual([0, 0]);
    expect(warnings.filter((w) => w.includes("no price found"))).toHaveLength(2);
    expect(warnings).toContain('"A": unusable price "n/a"; set to 0');
  });

  it("warns when nothing usable was extracted", () => {
    const { menu, warnings } = parseModelResponse('[{"price":1}, 7]');
    expect(menu.categories).toEqual([]);
    expect(warnings).toEqual([
      "item #1 dropped: missing name",
      "item #2 dropped: not an object",
      "no valid items were extracted",
    ]);
  });

  it("falls back to the hinted restaurant name", () => {
    const { menu } = parseModelResponse('[{"name":"Soup","price":1}]', {
      restaurantName: "Hinted Cafe",
    });
    expect(menu.restaurantName).toBe("Hinted Cafe");
  });

  it("throws INVALID_JSON for non-JSON and INVALID_RESPONSE without an items array", async () => {
    const invalid = await expectError(() => parseModelResponse("sorry, I cannot"), "INVALID_JSON");
    expect(invalid.cause).toBeInstanceOf(SyntaxError);
    await expectError(() => parseModelResponse('{"foo":1}'), "INVALID_RESPONSE");
    await expectError(() => parseModelResponse('"just a string"'), "INVALID_RESPONSE");
  });
});
