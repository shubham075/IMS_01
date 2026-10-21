import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "../src/imports/csv";
import { mapHeaders, rupeesToPaise } from "../src/imports/imports.service";

describe("CSV reader", () => {
  it("reads plain comma files with CRLF, LF, blank lines and a byte-order mark", () => {
    const r = parseCsv("﻿name,price\r\nHammer,250\n\nSaw,400\r\n", 100);
    expect(r.header).toEqual(["name", "price"]);
    expect(r.rows).toEqual([
      ["Hammer", "250"],
      ["Saw", "400"],
    ]);
  });

  it("detects semicolon and tab files (Excel in India often uses them)", () => {
    expect(parseCsv("name;price\nHammer;250", 10).rows).toEqual([["Hammer", "250"]]);
    expect(parseCsv("name\tprice\nHammer\t250", 10).rows).toEqual([["Hammer", "250"]]);
  });

  it("handles quotes: commas, new lines and doubled quotes inside a cell", () => {
    const r = parseCsv('name,note\n"Hammer, claw","He said ""hi""\nsecond line"\n', 10);
    expect(r.rows).toEqual([["Hammer, claw", 'He said "hi"\nsecond line']]);
  });

  it("keeps Hindi text intact", () => {
    expect(parseCsv("नाम,कीमत\nहथौड़ा,₹250", 10).rows).toEqual([["हथौड़ा", "₹250"]]);
  });

  it("rejects things that are not CSV text", () => {
    const code = (s: string, max = 10) => {
      try {
        parseCsv(s, max);
        return "ok";
      } catch (e) {
        return e instanceof CsvError ? e.code : "other";
      }
    };
    expect(code("")).toBe("EMPTY");
    expect(code("   \n  ")).toBe("EMPTY");
    expect(code("PK\u0003\u0004\u0000\u0000binary")).toBe("BINARY");
    expect(code('a,b\n"unclosed,1')).toBe("UNCLOSED_QUOTE");
    expect(code(`a\n${"x\n".repeat(20)}`, 10)).toBe("TOO_MANY_ROWS");
    expect(code(`a\n${"x".repeat(600)}`)).toBe("CELL_TOO_LONG");
    expect(code(`${Array.from({ length: 50 }, (_, i) => `c${i}`).join(",")}\n1`)).toBe("TOO_MANY_COLUMNS");
  });

  it("never evaluates anything: a formula is just text", () => {
    expect(parseCsv("name\n=1+1", 10).rows).toEqual([["=1+1"]]);
  });
});

describe("column names and prices", () => {
  it("recognises English and Hindi titles in any case, ignoring spaces and underscores", () => {
    const { map, recognised, ignored } = mapHeaders([
      "Product Name",
      "SELLING_PRICE",
      "कैटेगरी",
      "Opening Qty",
      "Colour",
      "",
    ]);
    expect([...map.keys()].sort()).toEqual(["category", "name", "price", "stock"]);
    expect(recognised).toHaveLength(4);
    expect(ignored).toEqual(["Colour"]);
  });
  it("uses the first of two columns that mean the same thing", () => {
    const { map } = mapHeaders(["name", "price", "rate"]);
    expect(map.get("price")).toBe(1);
  });
  it("turns rupees into paise without floating-point drift", () => {
    expect(rupeesToPaise("249")).toBe(24900);
    expect(rupeesToPaise("₹1,299.50")).toBe(129950);
    expect(rupeesToPaise("0.07")).toBe(7);
    expect(rupeesToPaise("")).toBeNull();
    for (const bad of ["abc", "-5", "1.234", "1e5", "12 34", "NaN", "Infinity"])
      expect(rupeesToPaise(bad), bad).toBeUndefined();
  });
});
