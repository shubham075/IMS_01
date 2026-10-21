import { expect, type Page, test } from "@playwright/test";
import { addBranch, createShop, newPerson, phone, signIn } from "./helpers";

async function ownerWithProduct(
  page: Page,
  name = "Claw hammer",
  extra: { threshold?: string; unit?: string } = {},
) {
  await signIn(page, phone());
  await createShop(page, "Asha Verma", "Verma Hardware");
  await addBranch(page);
  await page.goto("/app/products/add?tab=custom");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ label: "Hardware" });
  if (extra.threshold) await page.getByLabel("Low-stock level").fill(extra.threshold);
  if (extra.unit) await page.getByLabel("Sold by").selectOption(extra.unit);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "See and update stock" }).click();
  await expect(page.getByText("Not counted yet")).toBeVisible();
}

const stockForm = (page: Page) => page.locator("form").filter({ has: page.getByLabel("What happened?") });
const saveStock = (page: Page) => stockForm(page).getByRole("button", { name: /^Sav/ });

async function record(
  page: Page,
  what: string,
  qty: string,
  extra: { note?: string; direction?: string; expectSaved?: boolean; saved?: string } = {},
) {
  await page.getByLabel("What happened?").selectOption({ label: what });
  await page.getByLabel(/How many/).fill(qty);
  if (extra.direction) await page.getByLabel("Did stock go up or down?").selectOption(extra.direction);
  if (extra.note) await page.getByLabel(/Why\? \(required\)|Note \(optional\)/).fill(extra.note);
  await saveStock(page).click();
  // Wait for the answer before the next entry: the form is reset when the save comes back.
  if (extra.saved) await expect(page.getByText(extra.saved)).toBeVisible();
  else if (extra.expectSaved !== false)
    await expect(stockForm(page).getByRole("status")).toContainText("Saved");
}

test.describe("stock", () => {
  test("opening stock, receipt and sale add up; the shop is warned when stock runs low; an entry can be undone", async ({
    page,
  }) => {
    await ownerWithProduct(page, "Claw hammer", { threshold: "5" });

    await record(page, "Opening stock", "20", { saved: "Saved. Now 20 pieces." });
    await expect(page.getByText("Saved. Now 20 pieces.")).toBeVisible();
    await expect(page.getByText("20 pieces", { exact: true }).first()).toBeVisible();

    // opening stock can only be set once: the option is gone
    await expect(
      page.getByLabel("What happened?").locator("option", { hasText: "Opening stock" }),
    ).toHaveCount(0);

    await record(page, "Stock received", "10", { saved: "Saved. Now 30 pieces." });
    await record(page, "Sold", "26", { saved: "Saved. Now 4 pieces." });
    await expect(page.getByText("Saved. Now 4 pieces.")).toBeVisible();
    await expect(page.getByText("Low", { exact: true })).toBeVisible();

    // quantity checks happen before anything is sent
    await page.getByLabel(/How many/).fill("abc");
    await saveStock(page).click();
    await expect(page.getByText("Enter a number, like 5 or 2.5.")).toBeVisible();
    await page.getByLabel(/How many/).fill("2.5");
    await saveStock(page).click();
    await expect(page.getByText("This product is counted in whole units.")).toBeVisible();
    await page.getByLabel(/How many/).fill("0");
    await saveStock(page).click();
    await expect(page.getByText("Quantity must be more than zero.")).toBeVisible();

    // history, then undo the sale
    await expect(page.getByText("Asha Verma").first()).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).first().click();
    await page.getByRole("button", { name: "Yes, undo" }).click();
    await expect(page.getByText("30 pieces", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("undone", { exact: true })).toBeVisible();
    await expect(page.getByText("Low", { exact: true })).toHaveCount(0);

    // the list shows it, and the dashboard stays quiet
    await page.getByRole("link", { name: "Stock", exact: true }).first().click();
    await expect(page.getByText("30 pieces")).toBeVisible();
    await page.getByRole("link", { name: "Home" }).click();
    await expect(page.getByText("Nothing needs attention.")).toBeVisible();
  });

  test("selling more than you have is allowed and flags the product to check, on the list and the dashboard", async ({
    page,
  }) => {
    await ownerWithProduct(page);
    await record(page, "Stock received", "2", { saved: "Saved. Now 2 pieces." });
    await record(page, "Sold", "5", { saved: "Saved. Now -3 pieces." });
    await expect(page.getByText("Saved. Now -3 pieces.")).toBeVisible();
    await expect(page.getByText("Check this")).toBeVisible();
    await expect(page.getByText(/went below zero/)).toBeVisible();

    await page.getByRole("link", { name: "Home" }).click();
    await expect(page.getByText("1 need a check")).toBeVisible();
    await page.getByRole("link", { name: "Open stock" }).click();
    await expect(page.getByRole("link", { name: /Claw hammer/ })).toBeVisible();

    // a recount fixes it
    await page.getByRole("link", { name: /Claw hammer/ }).click();
    await record(page, "Correction", "8", {
      direction: "in",
      note: "recounted the shelf",
      saved: "Saved. Now 5 pieces.",
    });
    await expect(page.getByText("Saved. Now 5 pieces.")).toBeVisible();
    await expect(page.getByText("Check this")).toHaveCount(0);
  });

  test("a correction must say which way and why", async ({ page }) => {
    await ownerWithProduct(page);
    await record(page, "Correction", "3", { expectSaved: false });
    await expect(page.getByText("Choose whether stock went up or down.")).toBeVisible();
    await expect(page.getByText("Say why you are adjusting the stock.")).toBeVisible();
  });

  test("an unusually large amount asks for confirmation", async ({ page }) => {
    await ownerWithProduct(page);
    let total = 0;
    for (const q of ["5", "6", "4"]) {
      total += Number(q);
      await record(page, "Stock received", q, { saved: `Saved. Now ${total} pieces.` });
    }
    await expect(page.getByText("Saved. Now 15 pieces.")).toBeVisible();
    await record(page, "Stock received", "500", { expectSaved: false });
    await expect(page.getByText("This is much larger than usual. Check it and confirm.")).toBeVisible();
    await page.getByRole("button", { name: "Yes, it is correct" }).click();
    await expect(page.getByText("Saved. Now 515 pieces.")).toBeVisible();
  });

  test("a double-click on Save records the entry once", async ({ page }) => {
    await ownerWithProduct(page);
    await page.getByLabel("What happened?").selectOption({ label: "Stock received" });
    await page.getByLabel(/How many/).fill("7");
    await saveStock(page).dblclick();
    await expect(page.getByText("Saved. Now 7 pieces.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("7 pieces", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Stock received" })).toHaveCount(1);
  });

  test("measured products accept fractions", async ({ page }) => {
    await ownerWithProduct(page, "Loose nails", { unit: "kg" });
    await record(page, "Stock received", "2.5");
    await expect(page.getByText("Saved. Now 2.5 kg.")).toBeVisible();
  });

  test("products that are not counted are marked in or out of stock", async ({ page }) => {
    await signIn(page, phone());
    await createShop(page, "Asha Verma", "Verma Hardware");
    await addBranch(page);
    await page.goto("/app/products/add?tab=custom");
    await page.getByLabel("Product name").fill("Loose screws");
    await page.getByLabel("Category").selectOption({ label: "Hardware" });
    await page.getByLabel("I do not count this product").check();
    await page.getByRole("button", { name: "Add product" }).click();
    await page.getByRole("link", { name: "See and update stock" }).click();
    await expect(page.getByText("Not set").first()).toBeVisible();
    await page.getByRole("button", { name: "Out of stock" }).click();
    await expect(page.getByRole("button", { name: "Out of stock" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "Stock", exact: true }).first().click();
    await expect(page.getByText("Out of stock").first()).toBeVisible();
  });

  test("a sales person can record sales but not receive stock or undo", async ({ page, browser }) => {
    await ownerWithProduct(page);
    await record(page, "Stock received", "10", { saved: "Saved. Now 10 pieces." });
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
      await other.getByRole("link", { name: "Stock", exact: true }).first().click();
      await other.getByRole("link", { name: /Claw hammer/ }).click();
      await expect(other.getByLabel("What happened?").locator("option")).toHaveText([
        "Customer return",
        "Sold",
      ]);
      await record(other, "Sold", "3", { saved: "Saved. Now 7 pieces." });
      await expect(other.getByText("Saved. Now 7 pieces.")).toBeVisible();
      await expect(other.getByRole("button", { name: "Undo" })).toHaveCount(0);
      await expect(other.getByText("Low-stock warning")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("everything works in Hindi", async ({ page }) => {
    await ownerWithProduct(page);
    await page.getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.getByText("स्टॉक अपडेट करें")).toBeVisible();
    await page.getByLabel("क्या हुआ?").selectOption({ label: "स्टॉक आया" });
    await page.getByLabel(/कितना/).fill("abc");
    await page.getByRole("button", { name: "सेव करें", exact: true }).first().click();
    await expect(page.getByText("संख्या लिखें, जैसे 5 या 2.5।")).toBeVisible();
  });
});

test.describe("stock on a phone @phone", () => {
  test("stock screens fit a small screen", async ({ page }) => {
    await ownerWithProduct(page);
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await record(page, "Stock received", "9", { saved: "Saved. Now 9 pieces." });
    await expect(page.getByText("Saved. Now 9 pieces.")).toBeVisible();
    expect(await fits()).toBe(true);
    await page.goto("/app/stock");
    expect(await fits()).toBe(true);
  });
});

test.describe("breaking it on purpose", () => {
  test("someone else's product id in the address bar shows nothing", async ({ page, browser }) => {
    await ownerWithProduct(page);
    const url = page.url();
    const { context, page: stranger } = await newPerson(browser);
    try {
      await signIn(stranger, phone());
      await createShop(stranger, "Other Owner", "Other Shop");
      await addBranch(stranger);
      const res = await stranger.goto(url);
      expect(res?.status()).toBe(404);
      await expect(stranger.getByText("Claw hammer")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("garbage in the address bar is a normal not-found or empty page, never a crash", async ({ page }) => {
    await ownerWithProduct(page);
    for (const path of [
      "/app/stock/not-a-uuid",
      "/app/stock?filter=everything&page=-4&q=%00",
      "/app/stock?branch=00000000-0000-0000-0000-000000000000",
      "/app/products?page=99999&status=bogus&category=zzz",
      "/app/products/00000000-0000-0000-0000-000000000000",
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(500);
    }
  });

  test("script tags in names and notes are shown as plain text", async ({ page }) => {
    const evil = `<img src=x onerror="window.__pwned=1">`;
    await ownerWithProduct(page, evil);
    await record(page, "Stock received", "1", { note: `<script>window.__pwned=1</script>` });
    await expect(page.getByText("<script>window.__pwned=1</script>")).toBeVisible();
    await expect(page.getByText(evil).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});
