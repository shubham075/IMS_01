import { templateCsv } from "@/lib/csv-decode";

/** The starter file for imports: header and two example rows, in English or Hindi. */
export function GET(request: Request) {
  const lang = new URL(request.url).searchParams.get("lang") === "hi" ? "hi" : "en";
  return new Response(templateCsv(lang), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="products-template-${lang}.csv"`,
      "cache-control": "no-store",
    },
  });
}
