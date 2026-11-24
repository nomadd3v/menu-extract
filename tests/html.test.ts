import { describe, it, expect } from "vitest";
import { htmlToText, extractImageUrls } from "../src/input/html.js";

describe("htmlToText", () => {
  it("strips HTML tags", () => {
    const result = htmlToText("<p>Hello <strong>world</strong></p>");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<");
  });

  it("removes script tags and content", () => {
    expect(htmlToText('<p>Menu</p><script>alert("xss")</script><p>Items</p>')).toBe(
      "Menu\nItems",
    );
  });

  it("removes style tags and content", () => {
    expect(htmlToText("<style>body{color:red}</style><p>Text</p>")).toBe("Text");
  });

  it("decodes HTML entities", () => {
    expect(htmlToText("Fish &amp; Chips &lt;$10&gt;")).toBe('Fish & Chips <$10>');
  });

  it("decodes &nbsp; to space", () => {
    expect(htmlToText("Hello&nbsp;World")).toBe("Hello World");
  });

  it("decodes &quot; and &#39;", () => {
    expect(htmlToText("&quot;Quoted&#39;s&quot;")).toBe("\"Quoted's\"");
  });

  it("collapses multiple whitespace to newlines", () => {
    const result = htmlToText("<p>Line 1</p>   <p>Line 2</p>");
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
  });

  it("caps output at 40KB", () => {
    const longHtml = "<p>" + "A".repeat(50_000) + "</p>";
    expect(htmlToText(longHtml).length).toBeLessThanOrEqual(40_000);
  });

  it("trims whitespace", () => {
    expect(htmlToText("  <p>  Hello  </p>  ")).toBe("Hello");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});

describe("extractImageUrls", () => {
  it("extracts favicon from link tags", () => {
    const html = '<link rel="icon" href="/favicon.png">';
    const urls = extractImageUrls(html, "https://example.com");
    expect(urls).toContain("https://example.com/favicon.png");
  });

  it("extracts apple-touch-icon", () => {
    const html = '<link rel="apple-touch-icon" href="/apple-icon.png">';
    const urls = extractImageUrls(html, "https://example.com");
    expect(urls).toContain("https://example.com/apple-icon.png");
  });

  it("adds /favicon.ico as fallback", () => {
    const urls = extractImageUrls("", "https://example.com/page");
    expect(urls).toContain("https://example.com/favicon.ico");
  });

  it("extracts img src attributes", () => {
    const html = '<img src="/images/burger.jpg" alt="Burger">';
    const urls = extractImageUrls(html, "https://example.com");
    expect(urls).toContain("https://example.com/images/burger.jpg");
  });

  it("extracts data-src lazy-load attributes", () => {
    const html = '<img data-src="/images/lazy.jpg">';
    const urls = extractImageUrls(html, "https://example.com");
    expect(urls).toContain("https://example.com/images/lazy.jpg");
  });

  it("extracts srcset URLs", () => {
    const html = '<img srcset="/img/small.jpg 300w, /img/large.jpg 600w">';
    const urls = extractImageUrls(html, "https://example.com");
    expect(urls).toContain("https://example.com/img/small.jpg");
  });

  it("extracts CSS background-image URLs", () => {
    const html = '<div style="background-image: url(https://cdn.example.com/bg.jpg)"></div>';
    const urls = extractImageUrls(html, "https://example.com");
    expect(urls).toContain("https://cdn.example.com/bg.jpg");
  });

  it("skips data: URIs", () => {
    const html = '<img src="data:image/png;base64,abc123">';
    const urls = extractImageUrls(html, "https://example.com");
    const dataUrls = urls.filter((u) => u.startsWith("data:"));
    expect(dataUrls).toHaveLength(0);
  });

  it("resolves relative URLs against base", () => {
    const html = '<img src="menu/photo.jpg">';
    const urls = extractImageUrls(html, "https://example.com/restaurant/");
    expect(urls).toContain("https://example.com/restaurant/menu/photo.jpg");
  });

  it("returns favicons before other images", () => {
    const html = `
      <img src="/images/food.jpg">
      <link rel="icon" href="/favicon.png">
    `;
    const urls = extractImageUrls(html, "https://example.com");
    const faviconIdx = urls.findIndex((u) => u.includes("favicon.png"));
    const foodIdx = urls.findIndex((u) => u.includes("food.jpg"));
    expect(faviconIdx).toBeLessThan(foodIdx);
  });
});
