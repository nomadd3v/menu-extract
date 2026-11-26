import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  extractFromBuffer,
  extractFromFile,
  extractFromText,
  extractFromUrl,
  MockLlmClient,
  SYSTEM_PROMPT,
} from "../src/index.js";
import { at, expectError, fixture, fixturePath } from "./helpers.js";

type ResponseBody = ConstructorParameters<typeof Response>[0];

const htmlResponse =
  (body: ResponseBody, contentType = "text/html"): typeof fetch =>
  () =>
    Promise.resolve(new Response(body, { headers: { "content-type": contentType } }));

describe("extraction pipeline (mock model)", () => {
  it("HTML: sends cleaned text with the system prompt and uses the title as a name hint", async () => {
    const client = new MockLlmClient('[{"name":"Soup","price":1}]');
    const { menu } = await extractFromFile(fixturePath("fictional-diner.html"), { client });
    expect(client.calls).toHaveLength(1);
    const request = at(client.calls);
    expect(request.system).toBe(SYSTEM_PROMPT);
    expect(request.maxTokens).toBe(16_000);
    expect(request.text).toContain("Two Egg Plate");
    expect(request.text).not.toContain("ignore me");
    expect(request.text).not.toContain("font-family");
    expect(request.images).toBeUndefined();
    expect(menu.restaurantName).toBe("Fictional Diner");
  });

  it("HTML end to end: the golden response validates without warnings", async () => {
    const client = new MockLlmClient(fixture("fictional-diner.response.json"));
    const { menu, warnings } = await extractFromFile(fixturePath("fictional-diner.html"), {
      client,
    });
    expect(menu.categories.flatMap((c) => c.items)).toHaveLength(6);
    expect(warnings).toEqual([]);
  });

  it("plain text", async () => {
    const client = new MockLlmClient(fixture("nowhere-noodle-bar.response.txt"));
    const { menu } = await extractFromFile(fixturePath("nowhere-noodle-bar.txt"), { client });
    expect(at(client.calls).text).toContain("Paper Dumplings");
    expect(menu.restaurantType).toBe("asian");
  });

  it("MHTML: decodes quoted-printable and extracts the page text", async () => {
    const client = new MockLlmClient(fixture("imaginary-pizza-planet.response.json"));
    const { menu } = await extractFromFile(fixturePath("imaginary-pizza-planet.mhtml"), { client });
    expect(at(client.calls).text).toContain("Margherita Moon 12 / 16 inch — $13.00");
    expect(menu.modifierGroups.map((g) => g.name)).toContain("Pizza Toppings");
  });

  it("DOCX, PPTX and RTF are routed to their text extractors", async () => {
    const docx = new JSZip().file(
      "word/document.xml",
      "<w:document><w:body><w:p><w:r><w:t>Fictional Soup 4.00</w:t></w:r></w:p></w:body></w:document>",
    );
    const pptx = new JSZip().file("ppt/slides/slide1.xml", "<a:t>Slide Soup 3.00</a:t>");
    const client = new MockLlmClient("[]");
    await extractFromBuffer(await docx.generateAsync({ type: "nodebuffer" }), "m.docx", { client });
    await extractFromBuffer(await pptx.generateAsync({ type: "nodebuffer" }), "m.pptx", { client });
    await extractFromBuffer(Buffer.from("{\\rtf1\\ansi Rtf Soup 2.00\\par}"), "m.rtf", { client });
    expect(client.calls.map((c) => c.text)).toEqual([
      "Fictional Soup 4.00",
      "Slide Soup 3.00",
      "Rtf Soup 2.00",
    ]);
  });

  it("an explicit kind overrides detection", async () => {
    const client = new MockLlmClient("[]");
    await extractFromBuffer(Buffer.from("<p>Tagged Soup</p>"), "x.txt", { client }, "text");
    expect(at(client.calls).text).toBe("<p>Tagged Soup</p>");
  });

  it("truncates long text to maxTextChars and says so", async () => {
    const client = new MockLlmClient('[{"name":"Soup","price":1}]');
    const { warnings } = await extractFromText("A".repeat(50), { client, maxTextChars: 10 });
    expect(at(client.calls).text).toBe("A".repeat(10));
    expect(warnings).toContain("input text truncated from 50 to 10 characters");
  });

  it("passes maxTokens through and prefixes input warnings to parse warnings", async () => {
    const client = new MockLlmClient('[{"name":"Soup"}]');
    const { warnings } = await extractFromText("Soup ".repeat(5), {
      client,
      maxTokens: 42,
      maxTextChars: 4,
    });
    expect(at(client.calls).maxTokens).toBe(42);
    expect(warnings).toEqual([
      "input text truncated from 24 to 4 characters",
      '"Soup": no price found',
    ]);
  });

  it("rejects blank input before calling the model", async () => {
    const client = new MockLlmClient("[]");
    await expectError(() => extractFromText("  \n ", { client }), "EMPTY_INPUT");
    await expectError(
      () => extractFromBuffer(Buffer.from("<html><script>x</script></html>"), "a.html", { client }),
      "EMPTY_INPUT",
    );
    expect(client.calls).toHaveLength(0);
  });

  it("turns truncated and refused model replies into errors instead of parsing them", async () => {
    const truncated = new MockLlmClient({ text: '[{"name":"So', finishReason: "truncated" });
    await expectError(() => extractFromText("Soup", { client: truncated }), "LLM_TRUNCATED");
    const refused = new MockLlmClient({ text: "", finishReason: "refused" });
    await expectError(() => extractFromText("Soup", { client: refused }), "LLM_REFUSED");
  });

  it("propagates unparseable model output as INVALID_JSON", async () => {
    await expectError(
      () => extractFromText("Soup 1", { client: new MockLlmClient("nope") }),
      "INVALID_JSON",
    );
  });
});

describe("extractFromUrl (injected fetch, no network)", () => {
  const page = readFileSync(fixturePath("fictional-diner.html"));

  it("fetches the page and extracts from it", async () => {
    const client = new MockLlmClient(fixture("fictional-diner.response.json"));
    const { menu } = await extractFromUrl("https://example.com/menu", {
      client,
      fetch: htmlResponse(page),
    });
    expect(menu.categories).toHaveLength(3);
    expect(at(client.calls).text).toContain("Two Egg Plate");
  });

  it("sends a user agent and follows redirects", async () => {
    let init: RequestInit | undefined;
    const spy = ((_url: URL, i: RequestInit) => {
      init = i;
      return Promise.resolve(new Response(page));
    }) as typeof fetch;
    await extractFromUrl("https://example.com/menu", {
      client: new MockLlmClient("[]"),
      fetch: spy,
    });
    expect(init).toMatchObject({ redirect: "follow", headers: { "user-agent": "menu-extract" } });
  });

  it("rejects non-http URLs, malformed URLs, HTTP errors and network failures", async () => {
    const client = new MockLlmClient("[]");
    const ok = htmlResponse(page);
    await expectError(
      () => extractFromUrl("file:///etc/hosts", { client, fetch: ok }),
      "UNSUPPORTED_URL",
    );
    await expectError(() => extractFromUrl("not a url", { client, fetch: ok }), "UNSUPPORTED_URL");
    const notFound = (() => Promise.resolve(new Response("no", { status: 404 }))) as typeof fetch;
    const error = await expectError(
      () => extractFromUrl("https://example.com/x", { client, fetch: notFound }),
      "FETCH_FAILED",
    );
    expect(error.message).toContain("404");
    const offline = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    const network = await expectError(
      () => extractFromUrl("https://example.com/x", { client, fetch: offline }),
      "FETCH_FAILED",
    );
    expect(network.cause).toBeInstanceOf(TypeError);
    expect(client.calls).toHaveLength(0);
  });
});
