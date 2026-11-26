import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, menuToCsv, parseModelResponse, type Menu } from "../src/index.js";
import { fixture } from "./helpers.js";

const menu = (categories: Menu["categories"]): Menu => ({
  schemaVersion: "1.0",
  restaurantType: "other",
  categories,
  modifierGroups: [],
});

describe("menuToCsv", () => {
  it("writes the header, one row per item in menu order, and a trailing newline", () => {
    const csv = menuToCsv(parseModelResponse(fixture("fictional-diner.response.json")).menu);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[0]).toBe("category,name,kind,price,description,modifierGroup");
    expect(lines).toHaveLength(1 + 6 + 1);
    expect(lines.at(-1)).toBe("");
    expect(lines[1]).toBe(
      "Breakfast,Two Egg Plate,food,8.50,Two eggs any style with toast.,Egg Add-Ons",
    );
  });

  it("formats prices with two decimals and leaves missing optional fields empty", () => {
    const csv = menuToCsv(
      menu([{ name: "Mains", items: [{ name: "Stew", kind: "food", price: 9 }] }]),
    );
    expect(csv).toBe(
      "category,name,kind,price,description,modifierGroup\nMains,Stew,food,9.00,,\n",
    );
  });

  it("quotes fields containing commas, quotes and line breaks", () => {
    const csv = menuToCsv(
      menu([
        {
          name: "Fish, Fresh",
          items: [
            { name: 'The "Big" One', kind: "food", price: 12.5, description: "Line one\nline two" },
          ],
        },
      ]),
    );
    expect(csv.split("\n").slice(1).join("\n")).toBe(
      '"Fish, Fresh","The ""Big"" One",food,12.50,"Line one\nline two",\n',
    );
  });

  it("writes only the header for an empty menu", () => {
    expect(menuToCsv(menu([]))).toBe("category,name,kind,price,description,modifierGroup\n");
  });
});
