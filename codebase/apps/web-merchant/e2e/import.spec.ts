import { expect, type Page, test } from "@playwright/test";
import { addBranch, createShop, newPerson, phone, signIn } from "./helpers";

const GOOD = [
  "name,category,unit,price,barcode,stock",
  "Claw hammer,Hardware,pcs,250,8901000000011,10",
  "Nails,हार्डवेयर,kg,80.50,,2.5",
  "Tape,Hardware,piece,40,,",
].join("\n");

async function shop(page: Page) {
  await signIn(page, phone());
  await createShop(page, "Asha Verma", "Verma Hardware");
  await addBranch(page);
  await page.goto("/app/import");
}
const upload = (page: Page, content: string | Buffer, name = "stock.csv") =>
  page
    .getByLabel("CSV file")
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content as string) });
const check = (page: Page) => page.getByRole("button", { name: "Check file" }).click();

test.describe("import", () => {
  test("a good file: check, import, see the products and their stock; the report lists every row", async ({
    page,
  }) => {
    await shop(page);
    await expect(page.getByText("No imports yet.")).toBeVisible();
    await upload(page, GOOD);
    await check(page);
    await expect(page.getByText("3 ready")).toBeVisible();
    await expect(page.getByText("Nothing has been added yet.")).toBeVisible();
    await expect(page.getByText(/Columns used: name → name, category → category/)).toBeVisible();

    await page.getByRole("button", { name: "Import 3 products" }).click();
    await expect(page.getByText("3 products added.")).toBeVisible();

    await page.getByRole("link", { name: "See your products" }).click();
    await expect(page.getByText("3 products", { exact: true })).toBeVisible();
    await page.goto("/app/stock");
    await expect(page.getByText("10 pieces")).toBeVisible();
    await expect(page.getByText("2.5 kg")).toBeVisible();

    await page.goto("/app/import");
    await expect(page.getByRole("link", { name: /stock\.csv/ })).toBeVisible();
    await page.getByRole("link", { name: /stock\.csv/ }).click();
    await expect(page.getByText("3 ready")).toBeVisible();
    await expect(page.getByText("Row 2 · Claw hammer")).toBeVisible();
  });

  test("problems are explained row by row, good rows still import, and the import can be undone", async ({
    page,
  }) => {
    await shop(page);
    const csv = [
      "name,category,unit,price,barcode,stock",
      "Good one,Hardware,pcs,10,,1",
      "No category,Gadgets,pcs,10,,",
      "Bad price,Hardware,pcs,ten,,",
      "=cmd|' /C calc'!A0,Hardware,pcs,10,,",
      "Fraction,Hardware,pcs,10,,2.5",
    ].join("\n");
    await upload(page, csv);
    await check(page);
    await expect(page.getByText("1 ready")).toBeVisible();
    await expect(page.getByText("4 with problems")).toBeVisible();
    await expect(page.getByText(/Category “Gadgets” is not one we know/)).toBeVisible();
    await expect(page.getByText("“ten” is not a price. Write it like 249 or 249.50.")).toBeVisible();
    await expect(page.getByText(/starts with = \+ or @/)).toBeVisible();
    await expect(page.getByText(/not a valid stock number for this unit/)).toBeVisible();
    await expect(page.getByText("Rows with problems are left out.")).toBeVisible();

    await page.getByRole("button", { name: "Import 1 products" }).click();
    await expect(page.getByText("1 products added.")).toBeVisible();
    await page.getByRole("link", { name: "See the report" }).click();
    await page.getByRole("button", { name: "Undo this import" }).click();
    await page.getByRole("button", { name: "Yes, undo" }).click();
    await expect(page.getByText("Undone", { exact: true }).first()).toBeVisible();
    await page.goto("/app/products");
    await expect(page.getByText("You have not added any products yet.")).toBeVisible();
  });

  test("uploading the same file twice does not duplicate anything", async ({ page }) => {
    await shop(page);
    await upload(page, GOOD);
    await check(page);
    await page.getByRole("button", { name: "Import 3 products" }).click();
    await expect(page.getByText("3 products added.")).toBeVisible();
    await page.getByRole("button", { name: "Import another file" }).click();
    await upload(page, GOOD);
    await check(page);
    await expect(page.getByText("3 already in your shop")).toBeVisible();
    await expect(
      page.getByText("Nothing to import: every row has a problem or already exists."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open that product" }).first()).toBeVisible();
  });

  test("files saved by Excel as Unicode text (UTF-16) are read correctly", async ({ page }) => {
    await shop(page);
    const text = "name\tcategory\nहथौड़ा\tHardware\nकील\tHardware\n";
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    await page
      .getByLabel("CSV file")
      .setInputFiles({ name: "unicode.txt", mimeType: "text/plain", buffer: bytes });
    await check(page);
    await expect(page.getByText("2 ready")).toBeVisible();
    await expect(page.getByText("Row 2 · हथौड़ा")).toBeVisible();
  });

  test("a file without a category column can use one category for every row", async ({ page }) => {
    await shop(page);
    await upload(page, "name,price\nBrush,30");
    await check(page);
    await expect(
      page.getByText("The file needs a category column, or choose a category for all rows below."),
    ).toBeVisible();
    await page.getByLabel("Category for rows without one").selectOption({ label: "Hardware" });
    await check(page);
    await expect(page.getByText("1 ready")).toBeVisible();
  });

  test("wrong files get a plain explanation, never a crash", async ({ page }) => {
    await shop(page);
    await check(page);
    await expect(page.getByText("Choose a file first.")).toBeVisible();
    await upload(page, "");
    await check(page);
    await expect(page.getByText("The file is empty.")).toBeVisible();
    await upload(page, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]), "sheet.xlsx");
    await check(page);
    await expect(page.getByText(/does not look like a CSV file/)).toBeVisible();
    await upload(page, "product_code,category\n1,Hardware");
    await check(page);
    await expect(page.getByText("The file needs a column called name.")).toBeVisible();
    await upload(page, `name,category\n${"A".repeat(950_000)}`);
    await check(page);
    await expect(page.getByText(/too large/)).toBeVisible();
  });

  test("the sample file can be downloaded", async ({ page }) => {
    await shop(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download a sample file" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("products-template-en.csv");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("name,category,unit,price,barcode,stock");
  });

  test("a stock keeper cannot import", async ({ page, browser }) => {
    await shop(page);
    const keeper = phone();
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByLabel("Mobile number").fill(keeper);
    await page.getByLabel("Role").selectOption("inventory_operator");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation saved.")).toBeVisible();
    const { context, page: other } = await newPerson(browser);
    try {
      await signIn(other, keeper);
      await other.getByRole("button", { name: "Accept" }).click();
      await expect(other).toHaveURL(/\/app$/);
      await expect(other.getByRole("link", { name: "Import", exact: true })).toHaveCount(0);
      await other.goto("/app/import");
      await expect(other).toHaveURL(/\/app$/);
    } finally {
      await context.close();
    }
  });

  test("works in Hindi", async ({ page }) => {
    await shop(page);
    await page.getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.goto("/app/import");
    await expect(page.getByRole("heading", { name: "प्रोडक्ट इम्पोर्ट करें", level: 1 })).toBeVisible();
    await page.getByLabel("CSV फ़ाइल").setInputFiles({
      name: "a.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,category\nBrush,Hardware\nBad,Gadgets"),
    });
    await page.getByRole("button", { name: "फ़ाइल जाँचें" }).click();
    await expect(page.getByText("1 तैयार")).toBeVisible();
    await expect(page.getByText(/कैटेगरी “Gadgets” हम नहीं जानते/)).toBeVisible();
  });
});

test.describe("import on a phone @phone", () => {
  test("the import screens fit a small screen", async ({ page }) => {
    await shop(page);
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    await upload(page, GOOD);
    await check(page);
    await expect(page.getByText("3 ready")).toBeVisible();
    expect(await fits()).toBe(true);
  });
});
