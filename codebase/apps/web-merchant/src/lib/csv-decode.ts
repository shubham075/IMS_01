/**
 * Turns the bytes of a spreadsheet export into text. Excel on Windows saves "CSV" as UTF-8 with a marker, UTF-16
 * ("Unicode text"), or the old Windows-1252 code page; picking the wrong one turns Hindi names into garbage.
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("windows-1252").decode(u8);
  }
}

/** The file as people see it in the template: a header and two example rows. */
export function templateCsv(lang: "en" | "hi"): string {
  const head = lang === "hi" ? "नाम,कैटेगरी,इकाई,कीमत,बारकोड,स्टॉक" : "name,category,unit,price,barcode,stock";
  const rows =
    lang === "hi"
      ? ["क्लॉ हथौड़ा 500 ग्राम,हार्डवेयर,पीस,250,8901234567890,10", "कील,हार्डवेयर,किलो,80.50,,2.5"]
      : ["Claw hammer 500g,Hardware,pcs,250,8901234567890,10", "Nails,Hardware,kg,80.50,,2.5"];
  return `﻿${[head, ...rows].join("\r\n")}\r\n`;
}
