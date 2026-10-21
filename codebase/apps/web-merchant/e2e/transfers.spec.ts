import { expect, type Page, test } from "@playwright/test";
import { addBranch, createShop, phone, signIn } from "./helpers";

async function addSecondBranch(page: Page, name: string) {
  await page.goto("/app/branches/new");
  await page.getByLabel("Branch name").fill(name);
  await page.getByLabel("Area").fill("Indiranagar");
  await page.getByLabel("Address").fill("1, 100 Feet Road");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByLabel("State").fill("Karnataka");
  await page.getByLabel("PIN code").fill("560038");
  await expect(async () => {
    await page.getByRole("application", { name: "Pin your shop on the map" }).click();
    await expect(page.getByText("Pin placed ✓")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await expect(page).toHaveURL(/\/app\/branches$/);
}

/** A shop with two branches and a Claw hammer with 10 in stock at the first branch. */
async function twoBranchShop(page: Page) {
  await signIn(page, phone());
  await createShop(page, "Asha Verma", "Verma Hardware");
  await addBranch(page);
  await addSecondBranch(page, "South branch");
  await page.goto("/app/products/add?tab=custom");
  await page.getByLabel("Product name").fill("Claw hammer");
  await page.getByLabel("Category").selectOption({ label: "Hardware" });
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name: "Claw hammer", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "See and update stock" }).click();
  await page.getByLabel("What happened?").selectOption({ label: "Stock received" });
  await page.getByLabel(/How many/).fill("10");
  await page.getByRole("button", { name: /^Sav/ }).first().click();
  await expect(page.getByText("Saved. Now 10 pieces.")).toBeVisible();
}

test.describe("transfers", () => {
  test("draft, send, receive with a shortage: stock moves between branches and the shortage is written off", async ({
    page,
  }) => {
    await twoBranchShop(page);
    await page.getByRole("link", { name: "Transfers", exact: true }).click();
    await expect(page.getByText("No transfers yet.")).toBeVisible();
    await page.getByRole("link", { name: "New transfer" }).click();

    await page.getByLabel("Find a product").fill("hammer");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("button", { name: "Add Claw hammer" }).click();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Enter a number, like 5 or 2.5.")).toBeVisible();
    await page.getByLabel(/How many/).fill("4");
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByRole("heading", { name: /Jayanagar 4th Block → South branch/ })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Yes, send" }).click();
    await expect(page.getByText("On the way", { exact: true })).toBeVisible();
    await expect(page.getByText(/not at the other branch yet/)).toBeVisible();

    // stock left the sender and is not yet at the receiver
    await page.goto("/app/stock");
    await expect(page.getByText("6 pieces")).toBeVisible();

    await page.goto("/app/transfers");
    await page.getByRole("link", { name: /Jayanagar 4th Block → South branch/ }).click();
    await page.getByLabel("Arrived: Claw hammer").fill("5");
    await page.getByRole("button", { name: "Confirm received" }).click();
    await expect(page.getByText("More than was sent (4).")).toBeVisible();
    await page.getByLabel("Arrived: Claw hammer").fill("3");
    await expect(page.getByText(/Products arriving short: 1/)).toBeVisible();
    await page.getByRole("button", { name: "Confirm received" }).click();

    await expect(page.getByText("Received", { exact: true })).toBeVisible();
    await expect(page.getByText("3 of 4 pieces")).toBeVisible();
    await expect(page.getByText("1 short")).toBeVisible();

    await page.goto("/app/stock");
    await page.getByRole("link", { name: "South branch" }).click();
    await expect(page.getByText("3 pieces")).toBeVisible();
  });

  test("a draft can be edited and cancelled; the list filters by status", async ({ page }) => {
    await twoBranchShop(page);
    await page.goto("/app/transfers/new");
    await page.getByLabel("Find a product").fill("hammer");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("button", { name: "Add Claw hammer" }).click();
    await page.getByLabel(/How many/).fill("2");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    await page.getByLabel(/How many/).fill("20");
    await expect(page.getByText(/has only 10 now/)).toBeVisible();
    await page.getByLabel(/How many/).fill("3");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.getByRole("button", { name: "Cancel transfer" }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();

    await page.goto("/app/transfers?status=draft");
    await expect(page.getByText("No transfers yet.")).toBeVisible();
    await page.goto("/app/transfers?status=cancelled");
    await expect(page.getByRole("link", { name: /Jayanagar 4th Block → South branch/ })).toBeVisible();
  });

  test("the form refuses nonsense before sending anything", async ({ page }) => {
    await twoBranchShop(page);
    await page.goto("/app/transfers/new");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Add at least one product.")).toBeVisible();
    await page.getByLabel("To branch").selectOption({ label: "Jayanagar 4th Block" });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Choose two different branches.")).toBeVisible();
  });

  test("a shop with one branch is told it needs two", async ({ page }) => {
    await signIn(page, phone());
    await createShop(page, "Asha Verma", "Verma Hardware");
    await addBranch(page);
    await page.goto("/app/transfers/new");
    await expect(page.getByText("You need at least two branches to move stock between them.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Transfers", exact: true })).toHaveCount(0);
  });

  test("works in Hindi", async ({ page }) => {
    await twoBranchShop(page);
    await page.getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.goto("/app/transfers");
    await expect(page.getByRole("heading", { name: "ट्रांसफर", level: 1 })).toBeVisible();
    await expect(page.getByText("अभी कोई ट्रांसफर नहीं।")).toBeVisible();
  });
});

test.describe("transfers on a phone @phone", () => {
  test("transfer screens fit a small screen", async ({ page }) => {
    await twoBranchShop(page);
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto("/app/transfers/new");
    await page.getByLabel("Find a product").fill("hammer");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("button", { name: "Add Claw hammer" }).click();
    expect(await fits()).toBe(true);
    await page.goto("/app/transfers");
    expect(await fits()).toBe(true);
  });
});
