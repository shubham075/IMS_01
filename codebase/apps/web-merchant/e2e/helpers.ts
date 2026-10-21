import { type Browser, expect, type Page } from "@playwright/test";

export const CODE = "123456";
let counter = 0;
/** A different valid mobile number for every call, so tests never share an account. */
export const phone = () => `98${String(Date.now()).slice(-6)}${String(++counter).padStart(2, "0")}`;

export async function signIn(page: Page, number: string) {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(number);
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await page.getByRole("button", { name: /Send code/ }).click();
  await page.getByLabel("6-digit code").fill(CODE);
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

export async function createShop(page: Page, owner: string, shop: string) {
  await page.getByLabel("Your name").fill(owner);
  await page.getByLabel("Shop name").fill(shop);
  await page.locator("label", { hasText: "Electricals" }).click();
  await page.getByRole("button", { name: /Create my shop/ }).click();
  await expect(page).toHaveURL(/\/onboarding\/location/);
}

export async function addBranch(page: Page) {
  await page.getByLabel("Branch name").fill("Jayanagar 4th Block");
  await page.getByLabel("Area").fill("Jayanagar");
  await page.getByLabel("Address").fill("12, 4th Block Main Road");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByLabel("State").fill("Karnataka");
  await page.getByLabel("PIN code").fill("560011");
  // The map may still be loading: click again until the pin lands.
  await expect(async () => {
    await page
      .getByRole("application", { name: "Pin your shop on the map" })
      .click({ position: { x: 120, y: 100 } });
    await expect(page.getByText("Pin placed ✓")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/** A second person on their own browser, as a real colleague would be. */
export async function newPerson(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}
