# menu-extract

Turn a restaurant menu (PDF, photo, web page, saved page, Word/PowerPoint/RTF, plain text) into a **validated, vendor-neutral JSON menu model**: categories, items, prices, price variants and modifier groups.

An LLM does the reading. This library does everything around it: input handling, a strict prompt, and a validation layer that repairs what it can and **reports every item it drops or changes** instead of hiding it.

The model is behind a small interface, so tests run fully offline against a mock, and the provider is swappable. An Anthropic Messages API adapter is included (key from the `ANTHROPIC_API_KEY` environment variable).

## Pipeline

```
 input (file path / bytes / URL / text)
   |
   v
 detectKind (magic bytes, then extension)
   |
   +-- html ---- strip script/style, decode entities, page <title> as name hint --+
   +-- mhtml --- split MIME parts, decode quoted-printable/base64, then as html ---+
   +-- docx/pptx/rtf - unzip XML / strip control words ----------------------------+--> text (capped at 40k chars)
   +-- text ---------------------------------------------------------------------+
   +-- pdf ----- extract text (mupdf) -- enough text? --yes--> text
   |                                      \--no (scanned)--> render pages to JPEG
   +-- image --- fix EXIF rotation, downscale to 2048px (sharp) -> image block
   |
   v
 LlmClient.complete({ system prompt, text | images })      <- mock in tests, Anthropic adapter in production
   |
   v
 parseModelResponse: strip fences -> JSON -> lenient coercion -> Zod validation
   |      - bad/unnamed/unknown-kind items dropped WITH a warning
   |      - "$6.50" -> 6.5, "drink" -> "beverage", group refs matched case-insensitively
   |      - unknown modifier-group refs removed, min>max repaired, duplicates dropped
   v
 { menu, warnings }   ->  JSON (and optional flat CSV)
```

## Quick start

```bash
npm install
npm test                    # fully offline, no API key needed

# Run the whole pipeline with a canned model response (no API call):
npx tsx src/cli.ts fixtures/fictional-diner.html --mock fixtures/fictional-diner.response.json

# Validate a saved model response:
npx tsx src/cli.ts --validate fixtures/imaginary-pizza-planet.response.json

# Real extraction (this calls the API and costs money):
export ANTHROPIC_API_KEY=...        # set in your shell; never commit it
npx tsx src/cli.ts path/to/menu.pdf --out menu.json --csv menu.csv
npx tsx src/cli.ts https://example.com/menu
```

As a library:

```ts
import { extractFromFile, AnthropicClient, MockLlmClient } from "menu-extract";

const { menu, warnings } = await extractFromFile("menu.pdf", { client: new AnthropicClient() });
```

To use another provider, implement `LlmClient` (one method, `complete({ system, text?, images?, maxTokens }) -> { text }`).

## Output schema

Defined and enforced with Zod in [`src/model.ts`](src/model.ts). See [`examples/fictional-diner.menu.json`](examples/fictional-diner.menu.json).

```jsonc
{
  "schemaVersion": "1.0",
  "restaurantName": "Fictional Diner",            // optional
  "restaurantType": "breakfast",                  // pizza|burger|bar_grill|fine_dining|cafe|mexican|asian|breakfast|sandwich|seafood|other
  "categories": [                                 // in menu order
    { "name": "Breakfast", "items": [
      { "name": "Two Egg Plate",
        "description": "...",                     // optional
        "kind": "food",                           // food | beverage | bar
        "price": 8.5,                             // 0 = no price found (also emitted as a warning)
        "priceVariants": { "dineIn": 8, "bar": 7, "pickup": 8, "takeout": 8, "delivery": 9 },  // optional, any subset
        "modifierGroup": "Egg Add-Ons" }          // optional; must name an entry below
    ] }
  ],
  "modifierGroups": [
    { "name": "Egg Add-Ons",
      "sections": [ { "name": "Add-Ons", "min": 0, "max": 2,
                      "options": [ { "name": "Bacon", "price": 2.0 } ] } ] }   // price = upcharge
  ]
}
```

## Tests

`npm test` runs 54 tests in 6 files, offline:

| file | covers |
|---|---|
| `tests/parse.test.ts` | price/kind coercion, fences, warnings for every drop, modifier cross-checks, duplicates, hard failures |
| `tests/extract.test.ts` | HTML/text/MHTML/DOCX/PPTX/RTF routes, injected-fetch URL path, input detection, CSV escaping |
| `tests/optional-deps.test.ts` | PDF text path, scanned-PDF page-image fallback, image resize (skipped automatically if `mupdf`/`sharp` are absent) |
| `tests/anthropic.test.ts` | request shape and key-from-env behavior against a fake `fetch` |
| `tests/html.test.ts`, `tests/mhtml.test.ts` | text and image-URL extraction, MIME parsing, quoted-printable |

Three fictional sample menus live in `fixtures/` (HTML, plain text, MHTML), each with a hand-written model response. The responses are **not real model output**; they exercise the validator (including deliberately broken entries).

## Limits (read these)

- **No test has called a real model.** The extraction quality of the prompt on real menus is unmeasured here. The tests prove the plumbing and the validation, not the LLM's accuracy. Always review the output and the `warnings`.
- Text inputs are truncated to 40,000 characters; there is no chunking, so very large multi-page menus can lose their tail. PDFs rendered as images are limited to 30 pages at 150 dpi.
- PDF and image handling needs the optional peers `mupdf` (**AGPL-3.0**) and `sharp`. Without `mupdf`, PDFs are unreadable (a warning is logged); without `sharp`, images are sent unresized. Review the AGPL terms before shipping `mupdf` in a product; the core library does not require it.
- PDF coverage is a hand-made one-page PDF; complex, multi-column or encrypted PDFs are untested. Image input is tested only for sizing, not for legibility.
- HTML handling is regex-based text stripping, not a DOM parser; pages that render their menu with JavaScript, or menus that exist only as images on a page, are not followed. URL fetching is a single plain GET with no auth or crawling.
- Modifier detection is entirely up to the model; the validator can only check the structure (min/max, references), not whether the modifiers are right.
- Currency is not modelled; prices are plain numbers. `restaurantType` and `kind` are coarse labels.
- `menuToCsv` is a flat convenience export (category, name, kind, price, description, modifierGroup). It does not target any specific system; map the JSON to your own target.

## Provenance

The input handlers (HTML, MHTML, Office/RTF text, PDF, image) and the extraction prompt rules were extracted from an internal menu-import tool and then reworked; the data model, validation layer, LLM interface, adapters, CLI and tests are new. One inherited bug (multi-byte quoted-printable decoding in MHTML) was found and fixed while writing tests.

## License

MIT, see [LICENSE](LICENSE). Optional peer `mupdf` is AGPL-3.0; `sharp` is Apache-2.0.
