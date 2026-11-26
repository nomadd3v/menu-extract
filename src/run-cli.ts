/**
 * The `menu-extract` command, as a function so it can be tested in-process.
 *
 * @packageDocumentation
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { menuToCsv } from "./csv.js";
import { MenuExtractError } from "./errors.js";
import { extractFromFile, extractFromUrl } from "./extract.js";
import { AnthropicClient } from "./llm/anthropic.js";
import { MockLlmClient } from "./llm/mock.js";
import type { LlmClient } from "./llm/types.js";
import type { ExtractionResult } from "./model.js";
import { parseModelResponse } from "./parse.js";

/** Usage text printed by `--help`. */
export const USAGE = `Usage:
  menu-extract <file|url> [--out menu.json] [--csv menu.csv] [--model <id>]
  menu-extract <file|url> --mock <response.json>   run the pipeline with a saved model reply (no API call)
  menu-extract --validate <response.json>          validate a saved model reply (no API call)

Options:
  --out <path>     write the menu JSON here instead of stdout
  --csv <path>     also write a flat CSV of the items
  --model <id>     Anthropic model id (default: $MENU_EXTRACT_MODEL or the built-in default)
  -h, --help       show this help

Real extraction calls the Anthropic API and needs ANTHROPIC_API_KEY in the environment.`;

/** Where the CLI writes. Swap these out in tests. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function parseCliArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: "string" },
        csv: { type: "string" },
        model: { type: "string" },
        mock: { type: "string" },
        validate: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new MenuExtractError("INVALID_ARGUMENT", message, { cause });
  }
}

async function extract(input: string, client: LlmClient): Promise<ExtractionResult> {
  return /^https?:\/\//i.test(input)
    ? extractFromUrl(input, { client })
    : extractFromFile(input, { client });
}

function summarize(result: ExtractionResult): string {
  const { categories, modifierGroups } = result.menu;
  const items = categories.reduce((n, c) => n + c.items.length, 0);
  const lines = [
    `${items} items, ${categories.length} categories, ${modifierGroups.length} modifier groups, ${result.warnings.length} warnings`,
    ...result.warnings.map((w) => `  warning: ${w}`),
  ];
  return lines.join("\n") + "\n";
}

/**
 * Run the CLI.
 *
 * @param argv - Arguments after the executable, e.g. `process.argv.slice(2)`.
 * @param io - Output streams; defaults to the process's stdout and stderr.
 * @returns The exit code: `0` on success, `1` on an extraction error, `2` on bad usage.
 */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const { values, positionals } = parseCliArgs(argv);
    if (values.help || argv.length === 0) {
      io.stdout(USAGE + "\n");
      return 0;
    }

    let result: ExtractionResult;
    if (values.validate !== undefined) {
      if (positionals.length > 0) {
        throw new MenuExtractError("INVALID_ARGUMENT", "--validate takes no input file");
      }
      result = parseModelResponse(await readFile(values.validate, "utf8"));
    } else {
      const [input, ...extra] = positionals;
      if (!input) throw new MenuExtractError("INVALID_ARGUMENT", "Missing input file or URL");
      if (extra.length > 0) {
        throw new MenuExtractError("INVALID_ARGUMENT", `Unexpected argument: ${extra[0]}`);
      }
      const client =
        values.mock !== undefined
          ? new MockLlmClient(await readFile(values.mock, "utf8"))
          : new AnthropicClient({ model: values.model });
      result = await extract(input, client);
    }

    const json = JSON.stringify(result.menu, null, 2) + "\n";
    if (values.out) await writeFile(values.out, json);
    else io.stdout(json);
    if (values.csv) await writeFile(values.csv, menuToCsv(result.menu));
    io.stderr(summarize(result));
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const usage = err instanceof MenuExtractError && err.code === "INVALID_ARGUMENT";
    io.stderr(`error: ${message}\n${usage ? "Run menu-extract --help for usage.\n" : ""}`);
    return usage ? 2 : 1;
  }
}
