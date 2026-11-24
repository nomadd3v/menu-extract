import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { detectKind, extractFromBuffer, extractFromFile, extractFromText, extractFromUrl } from "../src/extract.js";
import { MockLlmClient } from "../src/llm/mock.js";
import { menuToCsv } from "../src/export.js";

const path = (n: string) => new URL(`../fixtures/${n}`, import.meta.url).pathname;
const resp = (n: string) => readFileSync(path(n), "utf8");

describe("extraction pipeline with a mock model", () => {
  it("HTML: sends cleaned text (no script/style) and uses the page title as name hint", async () => {
    const client = new MockLlmClient('[{"name":"Soup","price":1}]');
    const { menu } = await extractFromFile(path("fictional-diner.html"), { client });
    expect(client.calls).toHaveLength(1);
    const sent = client.calls[0].text ?? "";
    expect(sent).toContain("Two Egg Plate");
    expect(sent).not.toContain("ignore me");
    expect(sent).not.toContain("font-family");
    expect(client.calls[0].images).toBeUndefined();
    expect(menu.restaurantName).toBe("Fictional Diner");
  });

  it("HTML end to end: golden response is validated into the model", async () => {
    const client = new MockLlmClient(resp("fictional-diner.response.json"));
    const { menu, warnings } = await extractFromFile(path("fictional-diner.html"), { client });
    expect(menu.categories.flatMap((c) => c.items)).toHaveLength(6);
    expect(warnings).toEqual([]);
  });

  it("plain text", async () => {
    const client = new MockLlmClient(resp("nowhere-noodle-bar.response.txt"));
    const { menu } = await extractFromFile(path("nowhere-noodle-bar.txt"), { client });
    expect(client.calls[0].text).toContain("Paper Dumplings");
    expect(menu.restaurantType).toBe("asian");
  });

  it("MHTML: decodes quoted-printable and extracts the page text", async () => {
    const client = new MockLlmClient(resp("imaginary-pizza-planet.response.json"));
    const { menu } = await extractFromFile(path("imaginary-pizza-planet.mhtml"), { client });
    expect(client.calls[0].text).toContain("Margherita Moon 12 / 16 inch — $13.00");
    expect(menu.modifierGroups.map((g) => g.name)).toContain("Pizza Toppings");
  });

  it("DOCX: reads word/document.xml", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Fictional Soup 4.00</w:t></w:r></w:p></w:body></w:document>");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const client = new MockLlmClient("[]");
    await extractFromBuffer(buf, "menu.docx", { client });
    expect(client.calls[0].text).toContain("Fictional Soup 4.00");
  });

  it("PPTX and RTF routes", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "<a:t>Slide Soup 3.00</a:t>");
    const client = new MockLlmClient("[]");
    await extractFromBuffer(await zip.generateAsync({ type: "nodebuffer" }), "m.pptx", { client });
    await extractFromBuffer(Buffer.from("{\\rtf1\\ansi Rtf Soup 2.00\\par}"), "m.rtf", { client });
    expect(client.calls[0].text).toContain("Slide Soup 3.00");
    expect(client.calls[1].text).toContain("Rtf Soup 2.00");
  });

  it("URL: fetch is injected, nothing touches the network", async () => {
    const html = readFileSync(path("fictional-diner.html"));
    const fakeFetch = (async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const client = new MockLlmClient(resp("fictional-diner.response.json"));
    const { menu } = await extractFromUrl("https://example.com/menu", { client }, fakeFetch);
    expect(menu.categories).toHaveLength(3);
    await expect(extractFromUrl("file:///etc/passwd", { client }, fakeFetch)).rejects.toThrow(/http/);
    const bad = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    await expect(extractFromUrl("https://example.com/x", { client }, bad)).rejects.toThrow(/404/);
  });

  it("propagates model garbage as an error and rejects empty input", async () => {
    await expect(extractFromText("Soup 1", { client: new MockLlmClient("nope") })).rejects.toThrow(/invalid JSON/);
    expect(() => extractFromText("   ", { client: new MockLlmClient("[]") })).toThrow(/No text/);
  });
});

describe("detectKind", () => {
  it("uses magic bytes before extensions", () => {
    expect(detectKind(Buffer.from("%PDF-1.4"), "x.txt")).toBe("pdf");
    expect(detectKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), "x.txt")).toBe("image");
    expect(detectKind(Buffer.from([0xff, 0xd8, 0xff]), "x")).toBe("image");
    expect(detectKind(Buffer.from("<html><body>"), "x")).toBe("html");
    expect(detectKind(Buffer.from("hello"), "menu.txt")).toBe("text");
    expect(detectKind(Buffer.from("MIME-Version: 1.0\n"), "x.mht")).toBe("mhtml");
    expect(detectKind(Buffer.from("PK\u0003\u0004"), "a.pptx")).toBe("pptx");
  });
});

describe("menuToCsv", () => {
  it("escapes commas and quotes", async () => {
    const client = new MockLlmClient('[{"name":"Fish, \\"Fresh\\"","section":"Mains","price":9}]');
    const { menu } = await extractFromText("x", { client });
    const csv = menuToCsv(menu);
    expect(csv.split("\n")[0]).toBe("category,name,kind,price,description,modifierGroup");
    expect(csv).toContain('Mains,"Fish, ""Fresh""",food,9.00,,');
  });
});
