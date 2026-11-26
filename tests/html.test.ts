import { describe, expect, it } from "vitest";
import { decodeEntities } from "../src/input/entities.js";
import { extractPageTitle, htmlToText } from "../src/input/html.js";

describe("htmlToText", () => {
  it("strips tags", () => {
    const text = htmlToText("<p>Hello <strong>world</strong></p>");
    expect(text).toMatch(/^Hello\s+world$/);
  });

  it("removes script and style contents", () => {
    expect(htmlToText('<p>Menu</p><script>alert("x")</script><p>Items</p>')).toBe("Menu\nItems");
    expect(htmlToText("<style>body{color:red}</style><p>Text</p>")).toBe("Text");
  });

  it("decodes entities after stripping, so encoded markup stays text", () => {
    expect(htmlToText("Fish &amp; Chips &lt;$10&gt;")).toBe("Fish & Chips <$10>");
    expect(htmlToText("Hello&nbsp;World")).toBe("Hello World");
    expect(htmlToText("&quot;Quoted&#39;s&quot;")).toBe('"Quoted\'s"');
  });

  it("turns runs of whitespace into line breaks and trims", () => {
    expect(htmlToText("  <p>Line 1</p>   <p>Line 2</p>  ")).toBe("Line 1\nLine 2");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});

describe("extractPageTitle", () => {
  it("keeps the part before a separator", () => {
    expect(extractPageTitle("<title>Example Pizza | Menu</title>")).toBe("Example Pizza");
    expect(extractPageTitle("<title>Example Grill — Dinner</title>")).toBe("Example Grill");
  });

  it("decodes entities in the title", () => {
    expect(extractPageTitle("<title>Fish &amp; Fry</title>")).toBe("Fish & Fry");
  });

  it("returns null when there is no usable title", () => {
    expect(extractPageTitle("<p>no title</p>")).toBeNull();
    expect(extractPageTitle("<title>   </title>")).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities in one pass", () => {
    expect(decodeEntities("&apos;&#8212;&#x2014;&AMP;")).toBe("'——&");
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves unknown and invalid entities alone", () => {
    expect(decodeEntities("&copy; &#0; &#x110000;")).toBe("&copy; &#0; &#x110000;");
  });
});
