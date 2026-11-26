/**
 * Extract a menu from an HTML file with a canned model reply: no API key, no network.
 *
 *   npx tsx examples/basic.ts
 *
 * In your own project, import from "menu-extract" instead of "../src/index.js", and swap
 * MockLlmClient for `new AnthropicClient()` (reads ANTHROPIC_API_KEY) to call a real model.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractFromFile, menuToCsv, MockLlmClient } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const client = new MockLlmClient(await readFile(fixture("fictional-diner.response.json"), "utf8"));
const { menu, warnings } = await extractFromFile(fixture("fictional-diner.html"), { client });

console.log(`${menu.restaurantName ?? "Unnamed restaurant"} (${menu.restaurantType})`);
for (const category of menu.categories) {
  console.log(`\n${category.name}`);
  for (const item of category.items) {
    const modifiers = item.modifierGroup ? `  [${item.modifierGroup}]` : "";
    console.log(`  ${item.name.padEnd(24)} ${item.price.toFixed(2).padStart(6)}${modifiers}`);
  }
}
console.log(`\n${warnings.length} warnings`);

console.log("\nAs CSV:\n" + menuToCsv(menu));
