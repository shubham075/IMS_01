import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The design system allows exactly four colours (design/DESIGN_SYSTEM.md). This keeps stray colours out of the code. */
const ALLOWED = new Set(["#242424", "#f2f2e8", "#dfff00", "#9b9e95"]);
const root = path.resolve(__dirname, "..");

function files(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(full).isDirectory()
      ? files(full, exts)
      : exts.some((e) => name.endsWith(e))
        ? [full]
        : [];
  });
}

describe("colour palette", () => {
  it("source code and styles only ever use the four design-system colours", () => {
    const offenders: string[] = [];
    const sources = [
      ...files(path.join(root, "src"), [".ts", ".tsx", ".css"]),
      path.resolve(root, "../../packages/ui/src/tokens.css"),
    ];
    for (const f of sources) {
      for (const m of readFileSync(f, "utf8").matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (!ALLOWED.has(m[0].toLowerCase())) offenders.push(`${path.relative(root, f)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not use Tailwind colour utilities from the default palette (the theme resets them)", () => {
    const bad =
      /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|shadow)-(?:red|blue|green|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone|amber|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose|black|white)(?:-\d{2,3})?\b/;
    const offenders = files(path.join(root, "src"), [".tsx", ".ts"]).filter((f) =>
      bad.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
