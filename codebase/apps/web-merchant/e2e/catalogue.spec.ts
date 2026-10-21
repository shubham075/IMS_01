import { expect, test } from "@playwright/test";
import { addBranch, createShop, newPerson, phone, signIn } from "./helpers";

async function ownerWithBranch(page: import("@playwright/test").Page, shop = "Verma Hardware") {
  await signIn(page, phone());
  await createShop(page, "Asha Verma", shop);
  await addBranch(page);
}

async function addCustom(
  page: import("@playwright/test").Page,
  name: string,
  fields: { category?: string; price?: string; barcode?: string } = {},
) {
  await page.goto("/app/products/add?tab=custom");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ label: fields.category ?? "Hardware" });
  if (fields.price) await page.getByLabel("Price (₹)").fill(fields.price);
  if (fields.barcode) await page.getByLabel("Barcode").fill(fields.barcode);
  await page.getByRole("button", { name: "Add product" }).click();
}

test.describe("catalogue", () => {
  test("a new shop adds products from the catalogue and its own, then shows one to shoppers", async ({
    page,
  }) => {
    await ownerWithBranch(page);

    // the dashboard points at the next step
    await expect(page.getByRole("link", { name: "Add your products" })).toBeVisible();
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await expect(page.getByText("You have not added any products yet.")).toBeVisible();

    // from the shared catalogue
    await page.getByRole("link", { name: "Add your first products" }).click();
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("Type something to search.")).toBeVisible();
    await page.getByLabel("Product name, brand or barcode").fill("hammer");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("button", { name: "Add Claw hammer 500g" }).click();
    await expect(page.getByText("✓ Added")).toBeVisible();
    await page.getByLabel("Product name, brand or barcode").fill("zzzz-nothing");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("Nothing found in the catalogue.")).toBeVisible();

    // your own product: bad price first
    await page.goto("/app/products/add?tab=custom");
    await page.getByLabel("Product name").fill("Wall clock");
    await page.getByLabel("Price (₹)").fill("abc");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Enter a price like 249 or 249.50.")).toBeVisible();
    await expect(page.getByText("Choose a category.")).toBeVisible();
    await page.getByLabel("Category").selectOption({ label: "Electrical" });
    await page.getByLabel("Price (₹)").fill("1,499.50");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByRole("heading", { name: "Wall clock", level: 1 })).toBeVisible();
    await expect(page.getByText("Quick code:")).toBeVisible();

    // show it to shoppers at the branch
    await expect(page.getByText("Hidden")).toBeVisible();
    await expect(page.getByText("Branch not public yet")).toBeVisible();
    await page.getByLabel("Show to shoppers").check();
    await page.getByLabel("Show the price").check();
    await page.getByRole("button", { name: "Save", exact: true }).last().click();
    await expect(page.getByText("Shown", { exact: true })).toBeVisible();

    // list and dashboard reflect it
    await page.getByRole("link", { name: "All products" }).click();
    await expect(page.getByText("2 products")).toBeVisible();
    await expect(page.getByText("Shown at 1")).toBeVisible();
    await expect(page.getByText("₹1,499.50")).toBeVisible();
    await page.getByRole("link", { name: "Home" }).click();
    await expect(page.getByText("2 products added")).toBeVisible();
    await expect(page.getByText("Shoppers can see your products")).toBeVisible();

    // search and filter
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await page.getByLabel("Search products").fill("clock");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("1 product", { exact: true })).toBeVisible();
    await page.getByLabel("Search products").fill("nothing matches this");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("No products match.")).toBeVisible();
  });

  test("a barcode can belong to only one product, and the error links to it", async ({ page }) => {
    await ownerWithBranch(page);
    await addCustom(page, "Screw box", { barcode: "7770001112" });
    await expect(page.getByRole("heading", { name: "Screw box", level: 1 })).toBeVisible();
    await addCustom(page, "Other box", { barcode: "7770001112" });
    await expect(page.getByText("Another product already uses this barcode or code.")).toBeVisible();
    await page.getByRole("link", { name: "Open that product" }).click();
    await expect(page.getByRole("heading", { name: "Screw box", level: 1 })).toBeVisible();
  });

  test("a product can be switched off and on", async ({ page }) => {
    await ownerWithBranch(page);
    await addCustom(page, "Paint brush");
    await page.getByRole("button", { name: "Switch off" }).click();
    await expect(page.getByRole("button", { name: "Switch on" })).toBeVisible();
    await expect(
      page.getByText("This product is switched off, so shoppers cannot see it anywhere."),
    ).toBeVisible();
    await page.goto("/app/products");
    await expect(page.getByText("No products match.").or(page.getByText("You have not added"))).toBeVisible();
    await page.goto("/app/products?status=inactive");
    await expect(page.getByText("Paint brush")).toBeVisible();
  });

  test("medicines can be stocked but never shown to shoppers", async ({ page }) => {
    await ownerWithBranch(page);
    await addCustom(page, "Cough syrup", { category: "Pharmacy" });
    await expect(page.getByText("This category cannot be shown to shoppers yet.")).toBeVisible();
    await page.getByLabel("Show to shoppers").check();
    await page.getByRole("button", { name: "Save", exact: true }).last().click();
    await expect(
      page.getByText("Products in this category (for example medicines) cannot be shown to shoppers yet."),
    ).toBeVisible();
  });

  test("a stock keeper can add products but cannot change what shoppers see", async ({ page, browser }) => {
    await ownerWithBranch(page);
    await addCustom(page, "Owner product");
    await expect(page.getByRole("heading", { name: "Owner product", level: 1 })).toBeVisible();
    const colleague = phone();
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByLabel("Mobile number").fill(colleague);
    await page.getByLabel("Role").selectOption("inventory_operator");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation saved.")).toBeVisible();

    const { context, page: other } = await newPerson(browser);
    try {
      await signIn(other, colleague);
      await other.getByRole("button", { name: "Accept" }).click();
      await other.getByRole("link", { name: "Products", exact: true }).click();
      await expect(other.getByText("Owner product")).toBeVisible();
      await addCustom(other, "Keeper product");
      await expect(other.getByRole("heading", { name: "Keeper product", level: 1 })).toBeVisible();
      await expect(other.getByText("Only people who manage publishing can change this.")).toBeVisible();
      await expect(other.getByLabel("Show to shoppers")).toBeDisabled();
    } finally {
      await context.close();
    }
  });

  test("everything works in Hindi", async ({ page }) => {
    await ownerWithBranch(page);
    await page.getByRole("button", { name: "हिन्दी" }).click();
    await page.getByRole("link", { name: "प्रोडक्ट", exact: true }).click();
    await expect(page.getByRole("heading", { name: "प्रोडक्ट", level: 1 })).toBeVisible();
    await expect(page.getByText("आपने अभी कोई प्रोडक्ट नहीं जोड़ा है।")).toBeVisible();
  });
});

test.describe("catalogue on a phone @phone", () => {
  test("product screens fit a small screen", async ({ page }) => {
    await ownerWithBranch(page);
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await addCustom(page, "Phone product", { price: "99" });
    await expect(page.getByRole("heading", { name: "Phone product", level: 1 })).toBeVisible();
    expect(await fits()).toBe(true);
    await page.goto("/app/products");
    expect(await fits()).toBe(true);
    await page.goto("/app/products/add");
    expect(await fits()).toBe(true);
  });
});
