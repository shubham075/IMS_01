import { expect, type Page, test } from "@playwright/test";
import { addBranch, createShop, newPerson, phone, signIn } from "./helpers";

async function shopWithBranch(page: Page) {
  await signIn(page, phone());
  await createShop(page, "Asha Verma", "Verma Hardware");
  await addBranch(page);
}

async function addAndShowProduct(page: Page, name = "Claw hammer") {
  await page.goto("/app/products/add?tab=custom");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ label: "Hardware" });
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await page.getByLabel("Show to shoppers").check();
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByText("Shown", { exact: true })).toBeVisible();
}

test.describe("going live", () => {
  test("a branch goes live once it has a pin, hours and a product, and can be hidden again", async ({
    page,
  }) => {
    await shopWithBranch(page);
    await page.goto("/app/branches");
    await expect(page.getByText("Not live yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Go live" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Show at least one product (0 shown)" })).toBeVisible();

    await addAndShowProduct(page);
    await page.goto("/app/branches");
    await expect(page.getByRole("button", { name: "Go live" })).toBeEnabled();
    await page.getByRole("button", { name: "Go live" }).click();
    await expect(page.getByText("Shoppers can find this branch (1 products shown).")).toBeVisible();

    await page.goto("/app");
    await expect(page.getByText("Your branch is live")).toBeVisible();

    await page.goto("/app/branches");
    await page.getByRole("button", { name: "Hide from shoppers" }).click();
    await page.getByRole("button", { name: "Keep live" }).click();
    await expect(page.getByText("Shoppers can find this branch")).toBeVisible();
    await page.getByRole("button", { name: "Hide from shoppers" }).click();
    await page.getByRole("button", { name: "Yes, hide" }).click();
    await expect(page.getByText("Not live yet")).toBeVisible();
  });

  test("a stock keeper sees the checklist but cannot take the branch live", async ({ page, browser }) => {
    await shopWithBranch(page);
    await addAndShowProduct(page);
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
      await other.goto("/app/branches");
      await expect(
        other.getByText("Only people who manage publishing can take a branch live."),
      ).toBeVisible();
      await expect(other.getByRole("button", { name: "Go live" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("works in Hindi", async ({ page }) => {
    await shopWithBranch(page);
    await page.getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.goto("/app/branches");
    await expect(page.getByText("अभी लाइव नहीं है")).toBeVisible();
    await expect(page.getByRole("button", { name: "लाइव जाएँ" })).toBeDisabled();
  });
});

test.describe("map pin", () => {
  test("a pin placed outside India is refused with a clear message", async ({ page }) => {
    await shopWithBranch(page);
    await page.goto("/app/branches/new");
    await page.getByLabel("Branch name").fill("Far branch");
    await page.getByLabel("Address").fill("1, Some Road");
    await page.getByLabel("PIN code").fill("560038");
    await expect(async () => {
      await page
        .getByRole("application", { name: "Pin your shop on the map" })
        .click({ position: { x: 150, y: 120 } });
      await expect(page.getByText("Pin placed ✓")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("button", { name: /Save and continue/ }).click();
    await expect(page.getByText("Place the pin inside India.")).toBeVisible();
  });
});

test.describe("going live on a phone @phone", () => {
  test("the branch card fits a small screen", async ({ page }) => {
    await shopWithBranch(page);
    await page.goto("/app/branches");
    await expect(page.getByText("Not live yet")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  });
});
