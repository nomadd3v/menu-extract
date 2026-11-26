/**
 * Plug in any model by implementing the one-method LlmClient interface. This toy client
 * "reads" a plain-text menu with a regex, so the example runs offline; a real one would
 * call your provider's API with `request.system`, `request.text` and `request.images`.
 *
 *   npx tsx examples/custom-client.ts
 */
import { extractFromText, MenuExtractError, type LlmClient } from "../src/index.js";

const regexClient: LlmClient = {
  complete(request) {
    const items = (request.text ?? "")
      .split("\n")
      .map((line) => /^(?<name>.+?)\s+(?<price>\d+\.\d{2})$/.exec(line.trim())?.groups)
      .filter((groups) => groups !== undefined)
      .map(({ name, price }) => ({ name, price, section: "Menu" }));
    return Promise.resolve({ text: JSON.stringify({ restaurantType: "cafe", items }) });
  },
};

const text = `
Jam Crumpet        3.50
Porridge            4.25
Pot of Tea          2.00
`;

const { menu, warnings } = await extractFromText(text, { client: regexClient });
console.log(JSON.stringify(menu, null, 2));
console.log(`${warnings.length} warnings`);

// Errors carry a machine-readable code.
try {
  await extractFromText("   ", { client: regexClient });
} catch (error) {
  if (error instanceof MenuExtractError) console.log(`Expected failure: ${error.code}`);
  else throw error;
}
