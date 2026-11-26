# menu-extract

[![CI](https://github.com/nomadd3v/menu-extract/actions/workflows/ci.yml/badge.svg)](https://github.com/nomadd3v/menu-extract/actions/workflows/ci.yml)

Restaurant menus arrive in every format: PDFs (some of them scans), phone photos, web pages, saved pages, Word and PowerPoint files, plain text. **menu-extract** turns any of these into a **validated, vendor-neutral JSON menu model** with categories, items, prices, price variants and modifier groups. An LLM does the reading. The library handles everything around it: format detection, text and image extraction, a strict prompt, and a validation layer that repairs what it can and **reports every item it drops or changes** instead of hiding it. The model sits behind a one-method interface, so the provider is swappable and the whole test suite runs offline.

- **Formats:** PDF (text layer, or rendered pages when scanned), JPEG/PNG/GIF/WebP, HTML, MHTML, DOCX, PPTX, RTF, plain text, http(s) URLs
- **Output:** JSON enforced by [Zod](https://zod.dev) schemas, plus an optional flat CSV
- **Typed:** strict TypeScript, ESM, with one error type carrying a machine-readable `code`

## Quick start

Requires Node.js 20 or later. The package is not on npm; install it from GitHub (a `prepare` script builds it) or clone it:

```bash
npm install github:nomadd3v/menu-extract
# optional peers, only if you need them (see "Optional dependencies"):
npm install mupdf sharp
```

### Library

```ts
import { AnthropicClient, extractFromFile, menuToCsv } from "menu-extract";

const { menu, warnings } = await extractFromFile("menu.pdf", {
  client: new AnthropicClient(), // reads ANTHROPIC_API_KEY from the environment
});

console.log(menu.categories.map((c) => `${c.name}: ${c.items.length} items`));
for (const w of warnings) console.warn(w); // review these: nothing is dropped silently
const csv = menuToCsv(menu);
```

`extractFromBuffer(bytes, filename, options)`, `extractFromUrl(url, options)` and `extractFromText(text, options)` work the same way. To try it without an API key, use `new MockLlmClient(savedModelReply)`.

### CLI

```bash
git clone https://github.com/nomadd3v/menu-extract && cd menu-extract
npm ci

# Offline: run the full pipeline with a saved model reply, no API call
npx tsx src/cli.ts fixtures/fictional-diner.html --mock fixtures/fictional-diner.response.json

# Offline: validate a saved model reply and list what the validator repaired
npx tsx src/cli.ts --validate fixtures/imaginary-pizza-planet.response.json

# Real extraction (calls the Anthropic API, which costs money)
export ANTHROPIC_API_KEY=...   # set it in your shell; never commit it
npx tsx src/cli.ts path/to/menu.pdf --out menu.json --csv menu.csv
npx tsx src/cli.ts https://example.com/menu
```

In a clone, `npm run build` produces `node dist/cli.js` with the same options; in a project that installed the package, run `npx menu-extract`. The menu JSON goes to stdout or `--out`; a one-line summary and every warning go to stderr. Exit codes: `0` success, `1` extraction error, `2` bad usage.

### Examples

[`examples/`](examples) runs offline with no API key:

```bash
npm run examples            # runs both scripts below
npx tsx examples/basic.ts   # HTML menu -> mock model -> printed menu and CSV
npx tsx examples/custom-client.ts   # a hand-written LlmClient, plus error handling
```

[`examples/fictional-diner.menu.json`](examples/fictional-diner.menu.json) is the CLI's output for the fictional diner fixture.

## How it works

```text
 file path / bytes / URL / text
   │
   ▼
 detectKind ── magic bytes first (%PDF, PNG, JPEG, GIF, WebP, zip, RTF), then extension and content
   │
   ├─ html ──────── strip script/style/tags, decode entities; <title> becomes a name hint ─┐
   ├─ mhtml ─────── split MIME parts, decode quoted-printable/base64, then as html ─────────┤
   ├─ docx / pptx ─ unzip and read the document / slide XML ────────────────────────────────┼─► text
   ├─ rtf ───────── drop control words and metadata groups ─────────────────────────────────┤   (capped at
   ├─ text ─────────────────────────────────────────────────────────────────────────────────┘    40k chars,
   ├─ pdf ───────── text layer (mupdf) ── enough text? ── yes ─► text                             with a warning)
   │                                      └── no (scanned) ─► pages rendered to JPEG ─┐
   └─ image ─────── EXIF orientation, downscale to 2048 px (sharp) ───────────────────┴──► images
   │
   ▼
 LlmClient.complete({ system prompt, text | images })      mock in tests, Anthropic adapter, or yours
   │                                                         truncated / refused replies become errors
   ▼
 parseModelResponse: strip fences ► JSON.parse ► lenient coercion ► Zod validation
   │    "$6.50" ► 6.5, "drink" ► "beverage", group references matched case-insensitively
   │    unnamed / unknown-kind items, empty sections, duplicates: dropped WITH a warning
   │    unknown modifier-group references removed, min > max repaired, unused groups flagged
   ▼
 { menu, warnings } ──► JSON, and optionally a flat CSV (menuToCsv)
```

Source layout: [`src/detect.ts`](src/detect.ts) (format detection), [`src/input/`](src/input) (one module per format), [`src/prepare.ts`](src/prepare.ts) (input stage), [`src/prompt.ts`](src/prompt.ts), [`src/llm/`](src/llm) (interface, mock, Anthropic adapter), [`src/parse.ts`](src/parse.ts) (validation), [`src/model.ts`](src/model.ts) (schemas), [`src/extract.ts`](src/extract.ts) (public pipeline), [`src/csv.ts`](src/csv.ts), [`src/run-cli.ts`](src/run-cli.ts).

## The menu model

Defined once in [`src/model.ts`](src/model.ts) as Zod schemas (`MenuSchema`, `MenuItemSchema`, …); the TypeScript types are inferred from them, so the two cannot drift. All schemas are exported for validating menus you store or receive.

```jsonc
{
  "schemaVersion": "1.0",
  "restaurantName": "Fictional Diner", // optional
  "restaurantType": "breakfast", // pizza | burger | bar_grill | fine_dining | cafe | mexican | asian | breakfast | sandwich | seafood | other
  "categories": [
    // in menu order
    {
      "name": "Breakfast",
      "items": [
        {
          "name": "Two Egg Plate",
          "description": "Two eggs any style with toast.", // optional
          "kind": "food", // food | beverage | bar
          "price": 8.5, // 0 = no price found (always reported as a warning)
          "priceVariants": { "delivery": 9.5 }, // optional: any of dineIn, bar, pickup, takeout, delivery
          "modifierGroup": "Egg Add-Ons", // optional; always names an entry below
        },
      ],
    },
  ],
  "modifierGroups": [
    {
      "name": "Egg Add-Ons",
      "sections": [
        {
          "name": "Add-Ons",
          "min": 0, // 0 = optional
          "max": 2,
          "options": [{ "name": "Bacon", "price": 2.0 }], // price = upcharge
        },
      ],
    },
  ],
}
```

Every function returns `{ menu, warnings }`. Warnings are plain sentences such as `"Mystery Item" dropped: unknown kind "furniture"` or `input text truncated from 51234 to 40000 characters`. Show them to whoever reviews the import.

## Errors

Everything the library throws on purpose is a `MenuExtractError` with a `code`; branch on the code, not the message. The original error, if any, is in `cause`.

| code                                | when                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `EMPTY_INPUT`                       | no text to extract from                                  |
| `UNREADABLE_INPUT`                  | corrupt PDF or Office file, MHTML with no text or images |
| `MISSING_DEPENDENCY`                | a PDF was given but `mupdf` is not installed             |
| `UNSUPPORTED_URL` / `FETCH_FAILED`  | not http(s) or malformed / network error or non-2xx      |
| `MISSING_API_KEY`                   | the Anthropic adapter has no key                         |
| `LLM_REQUEST_FAILED`                | the provider returned an error or could not be reached   |
| `LLM_TRUNCATED` / `LLM_REFUSED`     | the model hit its output limit / declined the request    |
| `INVALID_JSON` / `INVALID_RESPONSE` | the reply is not JSON / has no `items` array             |
| `INVALID_ARGUMENT`                  | bad CLI arguments                                        |

```ts
import { MenuExtractError } from "menu-extract";

try {
  await extractFromFile("menu.pdf", { client });
} catch (err) {
  if (err instanceof MenuExtractError && err.code === "MISSING_DEPENDENCY") {
    console.error("PDF support needs the optional mupdf package.");
  } else throw err;
}
```

## Using another LLM

The extractor knows exactly one thing about the model:

```ts
interface LlmClient {
  complete(request: {
    system: string; // the extraction prompt (exported as SYSTEM_PROMPT)
    text?: string; // menu text, for textual input
    images?: {
      mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      base64: string;
    }[];
    maxTokens: number;
  }): Promise<{
    text: string; // the model's raw reply, expected to be JSON
    finishReason?: "complete" | "truncated" | "refused";
    usage?: { inputTokens: number; outputTokens: number };
  }>;
}
```

Implement it for any provider, a local model, or a cache, and pass it as `client`. [`examples/custom-client.ts`](examples/custom-client.ts) shows a complete one. The bundled `AnthropicClient` is a small adapter over plain `fetch` (no SDK dependency); it takes `apiKey`, `model` (default `claude-haiku-4-5`, or `MENU_EXTRACT_MODEL`), `baseUrl` and an injectable `fetch`.

## Optional dependencies

The core needs only `zod` and `jszip`. Two optional peer dependencies add binary formats; they are loaded lazily, only when such an input arrives, and are never installed for you.

- **`mupdf` (AGPL-3.0): PDF input.** Without it, PDFs fail with `MISSING_DEPENDENCY`; every other format works. `mupdf` is licensed under the GNU AGPL v3, which is much stricter than this library's MIT license: if you install it and distribute your application, or offer it to users over a network, the AGPL's terms may apply to your application as a whole. Read the license, or get legal advice, before shipping it. Not installing `mupdf` keeps your dependency tree free of AGPL code.
- **`sharp` (Apache-2.0): image preparation.** It applies EXIF rotation and downscales large photos before they are sent. Without it, images are sent as they are (with a warning), which costs more tokens and may exceed provider size limits. Supported range: `^0.34.0 || ^0.35.0`.

## Limits

Read these before relying on the output.

- **Accuracy on real menus is unproven.** No test calls a real model, and nothing in this repository measures how well the prompt does on real menus. The tests prove the plumbing and the validation, not the LLM's reading. Always review the output and the warnings.
- **The real-LLM path is mocked in tests.** `AnthropicClient` is tested against a fake `fetch` (request shape, key handling, errors, stop reasons), never against the live API.
- **No chunking.** Text is cut at 40,000 characters (configurable, always warned), so a very long menu loses its tail. Scanned PDFs are capped at 30 rendered pages at 150 dpi.
- **PDF tests use small generated PDFs** (single- and multi-page, text and text-less). Complex layouts, multi-column menus and encrypted files are untested. Image tests cover sizing and orientation, not legibility.
- **HTML is stripped with regular expressions, not parsed with a DOM.** Menus rendered by JavaScript, or shown only as images on a live page, are not followed. URL input is one plain GET: no auth, no crawling.
- **Modifiers are the model's call.** The validator checks their structure (min/max, references, duplicates), not whether they are right.
- **Currency is not modelled;** prices are plain numbers. `restaurantType` and `kind` are coarse labels.
- **`menuToCsv` is a convenience export** (category, name, kind, price, description, modifierGroup). It targets no particular system; map the JSON to your own.

## Development

```bash
npm ci
npm run typecheck && npm run lint && npm run format:check && npm run build && npm test
npm run examples
```

The tests are offline and need no key. The PDF and image tests run when the optional peers are installed (they are dev dependencies here) and skip cleanly otherwise; the "without mupdf/sharp" paths are tested with module mocks. CI runs everything above on Node 20 and 22.

The fixtures in [`fixtures/`](fixtures) are three fictional menus (HTML, plain text, MHTML), each with a hand-written model reply. The replies are **not real model output**: they deliberately include broken entries to exercise the validator.

## Provenance

The input handlers and the prompt's pricing and modifier rules were adapted from earlier, unpublished code and then reworked. The data model, validation layer, LLM interface, adapters, CLI and tests were written for this library. A multi-byte quoted-printable bug in the MHTML decoder was found and fixed while writing the tests.

## License

MIT, see [LICENSE](LICENSE). The optional peer `mupdf` is AGPL-3.0 and `sharp` is Apache-2.0; see [Optional dependencies](#optional-dependencies).
