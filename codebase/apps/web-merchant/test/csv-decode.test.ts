import { describe, expect, it } from "vitest";
import { decodeCsv, templateCsv } from "@/lib/csv-decode";

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer;

describe("decodeCsv", () => {
  it("reads UTF-8 with Hindi text", () => {
    expect(decodeCsv(new TextEncoder().encode("नाम,कीमत\nहथौड़ा,250").buffer)).toBe("नाम,कीमत\nहथौड़ा,250");
  });
  it("reads UTF-16 files saved by Excel as Unicode text (little and big endian)", () => {
    const le = [
      0xff,
      0xfe,
      ...Array.from("नाम").flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]),
    ];
    const be = [
      0xfe,
      0xff,
      ...Array.from("नाम").flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255]),
    ];
    expect(decodeCsv(buf(le))).toBe("नाम");
    expect(decodeCsv(buf(be))).toBe("नाम");
  });
  it("falls back to Windows-1252 when the bytes are not valid UTF-8", () => {
    expect(decodeCsv(buf([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
  });
  it("keeps the UTF-8 marker so the server can strip it", () => {
    expect(decodeCsv(buf([0xef, 0xbb, 0xbf, 0x61])).replace(/^\uFEFF/, "")).toBe("a");
  });
});

describe("template", () => {
  it("has a header and example rows in either language", () => {
    expect(templateCsv("en").split("\r\n")[0]).toContain("name,category");
    expect(templateCsv("hi")).toContain("नाम");
    expect(templateCsv("en").startsWith("\uFEFF")).toBe(true);
  });
});
