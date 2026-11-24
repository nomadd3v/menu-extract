#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { extractFromFile, extractFromUrl } from "./extract.js";
import { AnthropicClient } from "./llm/anthropic.js";
import { MockLlmClient } from "./llm/mock.js";
import { parseModelResponse } from "./parse.js";
import { menuToCsv } from "./export.js";
import type { ExtractionResult } from "./model.js";

const USAGE = `menu-extract <file|url> [--out menu.json] [--csv menu.csv] [--model <id>]
menu-extract --validate <model-response.json>     validate a saved model response (no API call)
menu-extract <file|url> --mock <response.json>    run the pipeline with a canned response (no API call)

Real extraction needs ANTHROPIC_API_KEY in the environment.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  let result: ExtractionResult;
  const validate = flag(args, "--validate");
  if (validate) {
    result = parseModelResponse(await readFile(validate, "utf8"));
  } else {
    const input = args[0];
    const mock = flag(args, "--mock");
    const client = mock
      ? new MockLlmClient(await readFile(mock, "utf8"))
      : new AnthropicClient({ model: flag(args, "--model") });
    result = /^https?:\/\//i.test(input) ? await extractFromUrl(input, { client }) : await extractFromFile(input, { client });
  }
  const json = JSON.stringify(result.menu, null, 2);
  const out = flag(args, "--out");
  if (out) await writeFile(out, json + "\n");
  else console.log(json);
  const csv = flag(args, "--csv");
  if (csv) await writeFile(csv, menuToCsv(result.menu));
  const items = result.menu.categories.reduce((n, c) => n + c.items.length, 0);
  console.error(`${items} items, ${result.menu.categories.length} categories, ${result.menu.modifierGroups.length} modifier groups, ${result.warnings.length} warnings`);
  for (const w of result.warnings) console.error(`  warning: ${w}`);
}

main().catch((e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
