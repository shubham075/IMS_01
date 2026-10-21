import { expect, type Page, test } from "@playwright/test";
import { addBranch, createShop, newPerson, phone, signIn } from "./helpers";

async function shop(page: Page) {
  await signIn(page, phone());
  await createShop(page, "Asha Verma", "Verma Hardware");
  await addBranch(page);
}
async function addProduct(page: Page, name: string, barcode: string) {
  await page.goto("/app/products/add?tab=custom");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ label: "Hardware" });
  await page.getByLabel("Barcode").fill(barcode);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
async function scan(page: Page, code: string) {
  await page.getByLabel("Barcode or code").fill(code);
  await page.keyboard.press("Enter");
}
const quickForm = (page: Page) => page.getByRole("heading", { name: "Quick update" });

test.describe("scan", () => {
  test("typing or scanning a barcode finds the product and updates its stock in a few taps", async ({
    page,
  }) => {
    await shop(page);
    await addProduct(page, "Claw hammer", "8901000000011");
    await page.goto("/app/scan");
    await scan(page, "8901000000011");
    await expect(page.getByRole("heading", { name: "Claw hammer", level: 2 })).toBeVisible();
    await expect(page.getByText("Not counted yet")).toBeVisible();

    await page.getByLabel(/How many/).fill("5");
    await page.getByRole("button", { name: "Stock received" }).click();
    await expect(page.getByText("Saved. Now 5 pieces.")).toBeVisible();
    await page.getByLabel(/How many/).fill("2");
    await page.getByRole("button", { name: "Sold" }).click();
    await expect(page.getByText("Saved. Now 3 pieces.")).toBeVisible();
    await expect(page.getByText("3 pieces").first()).toBeVisible();

    await expect(page.getByRole("button", { name: "8901000000011" })).toBeVisible(); // recent scans
    await page.getByRole("link", { name: "Open product" }).click();
    await expect(page.getByRole("heading", { name: "Claw hammer", level: 1 })).toBeVisible();
  });

  test("an unknown code offers to create a product with that barcode filled in", async ({ page }) => {
    await shop(page);
    await page.goto("/app/scan");
    await scan(page, "1234567890128");
    await expect(page.getByText("No product with this code")).toBeVisible();
    await page.getByRole("link", { name: "Create a product with this code" }).click();
    await expect(page.getByLabel("Barcode")).toHaveValue("1234567890128");
    await page.getByLabel("Product name").fill("Brand new thing");
    await page.getByLabel("Category").selectOption({ label: "Hardware" });
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByRole("heading", { name: "Brand new thing", level: 1 })).toBeVisible();
    await page.goto("/app/scan");
    await scan(page, "1234567890128");
    await expect(page.getByRole("heading", { name: "Brand new thing", level: 2 })).toBeVisible();
  });

  test("a code from the shared catalogue can be added in one tap", async ({ page }) => {
    await shop(page);
    await page.goto("/app/scan");
    await scan(page, "8900000000101");
    await expect(page.getByText("Found in our shared catalogue")).toBeVisible();
    await expect(page.getByText("Claw hammer 500g · Taparia")).toBeVisible();
    await page.getByRole("button", { name: "+ Add to my shop" }).click();
    await expect(page.getByRole("heading", { name: "Claw hammer 500g", level: 1 })).toBeVisible();
  });

  test("a code with strange characters is refused politely", async ({ page }) => {
    await shop(page);
    await page.goto("/app/scan");
    await scan(page, "🔥🔥");
    await expect(page.getByText("That code has characters we do not recognise.")).toBeVisible();
    await page.getByLabel("Barcode or code").fill("x".repeat(70));
    expect(await page.getByLabel("Barcode or code").inputValue()).toHaveLength(64); // the box stops at 64
  });

  test("the camera option is offered where the browser supports it, and typing always works", async ({
    page,
  }) => {
    await shop(page);
    await page.goto("/app/scan");
    await expect(
      page
        .getByRole("button", { name: "Use the camera" })
        .or(page.getByText(/cannot read barcodes with the camera/)),
    ).toBeVisible();
    await expect(page.getByLabel("Barcode or code")).toBeFocused();
  });

  test("a sales person can sell by scan but not receive stock, and has no Counts page", async ({
    page,
    browser,
  }) => {
    await shop(page);
    await addProduct(page, "Claw hammer", "8901000000011");
    const seller = phone();
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByLabel("Mobile number").fill(seller);
    await page.getByLabel("Role").selectOption("sales_operator");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation saved.")).toBeVisible();
    const { context, page: other } = await newPerson(browser);
    try {
      await signIn(other, seller);
      await other.getByRole("button", { name: "Accept" }).click();
      await expect(other).toHaveURL(/\/app$/);
      await expect(other.getByRole("link", { name: "Counts" })).toHaveCount(0);
      await other.getByRole("link", { name: "Scan", exact: true }).click();
      await scan(other, "8901000000011");
      await expect(other.getByRole("heading", { name: "Claw hammer", level: 2 })).toBeVisible();
      await expect(other.getByRole("button", { name: "Sold" })).toBeVisible();
      await expect(other.getByRole("button", { name: "Stock received" })).toHaveCount(0);
      await expect(quickForm(other)).toBeVisible();
      await other.goto("/app/counts");
      await expect(other).toHaveURL(/\/app$/);
    } finally {
      await context.close();
    }
  });

  test("works in Hindi", async ({ page }) => {
    await shop(page);
    await page.getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.goto("/app/scan");
    await expect(page.getByRole("heading", { name: "स्कैन", level: 1 })).toBeVisible();
    await page.getByLabel("बारकोड या कोड").fill("0000111122223");
    await page.keyboard.press("Enter");
    await expect(page.getByText("इस कोड का कोई प्रोडक्ट नहीं")).toBeVisible();
  });
});

test.describe("stock count by scanning", () => {
  test("scan to count, fix a number, finish: the stock is corrected and the count is kept", async ({
    page,
  }) => {
    await shop(page);
    await addProduct(page, "Claw hammer", "8901000000011");
    await page.goto("/app/scan");
    await scan(page, "8901000000011");
    await page.getByLabel(/How many/).fill("10");
    await page.getByRole("button", { name: "Stock received" }).click();
    await expect(page.getByText("Saved. Now 10 pieces.")).toBeVisible();

    await page.goto("/app/counts");
    await expect(page.getByText("No counts yet.")).toBeVisible();
    await page.getByRole("button", { name: "Start a count" }).click();
    await expect(page.getByRole("heading", { name: "Stock count", level: 1 })).toBeVisible();
    await expect(page.getByText("Nothing counted yet.")).toBeVisible();

    for (const n of [1, 2, 3]) {
      await scan(page, "8901000000011");
      await expect(page.getByText(`Claw hammer: ${n} counted`)).toBeVisible();
    }
    await expect(page.getByText("Records said 10")).toBeVisible();
    await expect(page.getByText("−7")).toBeVisible();
    await expect(page.getByText("Finishing will correct 1 products.")).toBeVisible();

    await page.getByLabel("Counted: Claw hammer").fill("8");
    await page.getByRole("button", { name: "Save Claw hammer" }).click();
    await expect(page.getByText("Claw hammer: 8 counted")).toBeVisible();
    await expect(page.getByText("−2")).toBeVisible();

    await page.getByRole("button", { name: "Finish count" }).click();
    await page.getByRole("button", { name: "Yes, correct it" }).click();
    await expect(page.getByText("Finished. 1 products were corrected.")).toBeVisible();

    await page.goto("/app/stock");
    await expect(page.getByText("8 pieces")).toBeVisible();
    await page.goto("/app/counts");
    await expect(page.getByText("Finished", { exact: true })).toBeVisible();
  });

  test("an unknown code during a count is reported, and a count can be cancelled without changing stock", async ({
    page,
  }) => {
    await shop(page);
    await addProduct(page, "Claw hammer", "8901000000011");
    await page.goto("/app/counts");
    await page.getByRole("button", { name: "Start a count" }).click();
    await scan(page, "0000000000000");
    await expect(page.getByText(/No product with 0000000000000/)).toBeVisible();
    await scan(page, "8901000000011");
    await expect(page.getByText("Claw hammer: 1 counted")).toBeVisible();
    await page.getByRole("button", { name: "Cancel count" }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("This count was cancelled or expired. No stock was changed.")).toBeVisible();
    // starting again begins a fresh count
    await page.goto("/app/counts");
    await page.getByRole("button", { name: "Start a count" }).click();
    await expect(page.getByText("Nothing counted yet.")).toBeVisible();
  });
});

test.describe("scan on a phone @phone", () => {
  test("the scan and count screens fit a small screen", async ({ page }) => {
    await shop(page);
    await addProduct(page, "Claw hammer", "8901000000011");
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto("/app/scan");
    await scan(page, "8901000000011");
    await expect(page.getByRole("heading", { name: "Claw hammer", level: 2 })).toBeVisible();
    expect(await fits()).toBe(true);
    await page.goto("/app/counts");
    await page.getByRole("button", { name: "Start a count" }).click();
    await expect(page.getByRole("heading", { name: "Stock count", level: 1 })).toBeVisible();
    expect(await fits()).toBe(true);
  });
});
