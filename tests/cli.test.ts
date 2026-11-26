import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MenuSchema } from "../src/index.js";
import { runCli, USAGE } from "../src/run-cli.js";
import { fixturePath } from "./helpers.js";

/** Run the CLI in-process and capture its output. */
async function cli(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr };
}

const savedKey = process.env.ANTHROPIC_API_KEY;
let dir: string;
beforeEach(async () => {
  Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
  dir = await mkdtemp(join(tmpdir(), "menu-extract-"));
});
afterEach(async () => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  await rm(dir, { recursive: true, force: true });
});

describe("menu-extract CLI", () => {
  it("prints usage for --help and for no arguments", async () => {
    expect(await cli("--help")).toEqual({ code: 0, stdout: USAGE + "\n", stderr: "" });
    expect((await cli()).stdout).toBe(USAGE + "\n");
  });

  it("runs the pipeline with --mock and prints the menu JSON and a summary", async () => {
    const { code, stdout, stderr } = await cli(
      fixturePath("fictional-diner.html"),
      "--mock",
      fixturePath("fictional-diner.response.json"),
    );
    expect(code).toBe(0);
    const menu = MenuSchema.parse(JSON.parse(stdout));
    expect(menu.restaurantName).toBe("Fictional Diner");
    expect(stderr).toBe("6 items, 3 categories, 2 modifier groups, 0 warnings\n");
  });

  it("accepts options before the input and writes --out and --csv files", async () => {
    const out = join(dir, "menu.json");
    const csv = join(dir, "menu.csv");
    const result = await cli(
      "--mock",
      fixturePath("fictional-diner.response.json"),
      "--out",
      out,
      "--csv",
      csv,
      fixturePath("fictional-diner.html"),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(MenuSchema.parse(JSON.parse(await readFile(out, "utf8"))).categories).toHaveLength(3);
    expect((await readFile(csv, "utf8")).split("\n")[0]).toBe(
      "category,name,kind,price,description,modifierGroup",
    );
  });

  it("validates a saved response and lists its warnings", async () => {
    const { code, stderr } = await cli(
      "--validate",
      fixturePath("imaginary-pizza-planet.response.json"),
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/^\d+ items, \d+ categories, \d+ modifier groups, [1-9]\d* warnings\n/);
    expect(stderr).toContain('  warning: modifier group "Unused Group" is not used by any item');
  });

  it("exits 2 with a hint on bad usage", async () => {
    for (const argv of [
      ["--bogus"],
      ["--mock", "x.json"],
      ["a.txt", "b.txt"],
      ["--validate", "r.json", "a.txt"],
    ]) {
      const { code, stderr } = await cli(...argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(stderr).toContain("Run menu-extract --help for usage.");
    }
  });

  it("exits 1 on extraction errors: missing key, missing file, bad response", async () => {
    const noKey = await cli(fixturePath("nowhere-noodle-bar.txt"));
    expect(noKey).toMatchObject({ code: 1, stderr: "error: ANTHROPIC_API_KEY is not set\n" });
    expect(
      (await cli(join(dir, "missing.pdf"), "--mock", fixturePath("fictional-diner.response.json")))
        .code,
    ).toBe(1);
    const garbage = await cli("--validate", fixturePath("nowhere-noodle-bar.txt"));
    expect(garbage).toMatchObject({ code: 1, stderr: "error: Model returned invalid JSON\n" });
  });
});
