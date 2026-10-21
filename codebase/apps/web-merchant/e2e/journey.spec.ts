import { expect, test } from "@playwright/test";
import { addBranch, CODE, createShop, newPerson, phone, signIn } from "./helpers";

test.describe("sign-in", () => {
  test("asks for the terms, rejects a wrong code, then signs in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill(phone());
    await page.getByRole("button", { name: /Send code/ }).click();
    await expect(page.getByText("Please accept the Terms and Privacy Notice to continue.")).toBeVisible();

    await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
    await page.getByRole("button", { name: /Send code/ }).click();
    await expect(page.getByRole("heading", { name: "Enter the code" })).toBeVisible();

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByText("That code is not right. 4 tries left.")).toBeVisible();

    await page.getByLabel("6-digit code").fill(CODE);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/onboarding\/shop/);
  });

  test("rejects an invalid mobile number before contacting the server", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill("12345");
    await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
    await page.getByRole("button", { name: /Send code/ }).click();
    await expect(page.getByText("Enter a valid 10-digit Indian mobile number.")).toBeVisible();
  });

  test("everything is available in Hindi, and the choice is remembered", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.getByRole("heading", { name: "अपनी दुकान में साइन इन करें" })).toBeVisible();
    await page.getByRole("button", { name: /कोड भेजें/ }).click();
    await expect(page.getByText("आगे बढ़ने के लिए शर्तें और प्राइवेसी नोटिस स्वीकार करें।")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "अपनी दुकान में साइन इन करें" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  });

  test("signed-out visitors cannot reach the console", async ({ page }) => {
    for (const path of ["/app", "/app/team", "/app/branches", "/onboarding/shop", "/join"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });
});

test.describe("setting up a shop", () => {
  test("a new owner creates the shop and branch and lands on a working dashboard", async ({ page }) => {
    await signIn(page, phone());
    await expect(page).toHaveURL(/\/onboarding\/shop/);

    // validation: nothing is sent while the form is invalid
    await page.getByLabel("Shop name").fill("V");
    await page.getByRole("button", { name: /Create my shop/ }).click();
    await expect(page.getByText("Enter your shop name (at least 2 letters).")).toBeVisible();
    await page.getByLabel("GSTIN").fill("NOTAGSTIN");
    await page.getByRole("button", { name: /Create my shop/ }).click();
    await expect(page.getByText("This GSTIN does not look right. Check the 15 characters.")).toBeVisible();
    await page.getByLabel("GSTIN").fill("");

    await createShop(page, "Asha Verma", "Verma Electricals");
    await page.getByLabel("PIN code").fill("5600");
    await page.getByRole("button", { name: /Save and continue/ }).click();
    await expect(page.getByText("PIN code must be 6 digits.")).toBeVisible();

    await addBranch(page);
    await expect(page.getByRole("heading", { name: "Welcome, Asha" })).toBeVisible();
    await expect(page.getByText("Shop location and hours added")).toBeVisible();
    await expect(page.getByText("Owner", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Branches" }).click();
    await expect(page.getByText("Jayanagar 4th Block")).toBeVisible();
    await expect(page.getByText("✓ Map pin set")).toBeVisible();
  });

  test("an existing owner who signs in again goes straight to the dashboard, and sign-out ends the session", async ({
    page,
  }) => {
    const me = phone();
    await signIn(page, me);
    await createShop(page, "Ravi Kumar", "Kumar Traders");
    await addBranch(page);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    await page.waitForTimeout(31_000); // the 30-second rule between codes
    await signIn(page, me);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "Welcome, Ravi" })).toBeVisible();
  });

  test("stays signed in when the short-lived access token expires (silent refresh)", async ({
    page,
    context,
  }) => {
    await signIn(page, phone());
    await createShop(page, "Meera Shah", "Shah Stationers");
    await addBranch(page);

    await context.clearCookies({ name: "i1_at" }); // what happens after ~15 minutes
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "Welcome, Meera" })).toBeVisible();
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).toContain("i1_at"); // a fresh one was issued
  });

  test("session cookies cannot be read by page scripts", async ({ page, context }) => {
    await signIn(page, phone());
    await expect(page).toHaveURL(/\/onboarding\/shop/);
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/i1_at|i1_rt/);
    const cookies = await context.cookies();
    for (const c of cookies.filter((c) => c.name.startsWith("i1_"))) expect(c.httpOnly, c.name).toBe(true);
  });
});

test.describe("teams and roles", () => {
  test("an owner invites a stock keeper, who joins with limited access", async ({ page, browser }) => {
    await signIn(page, phone());
    await createShop(page, "Asha Verma", "Verma Electricals");
    await addBranch(page);

    const colleague = phone();
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByLabel("Mobile number").fill(colleague);
    await page.getByLabel("Role").selectOption("inventory_operator");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`Invitation saved. +91${colleague} can join`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open invitations" })).toBeVisible();
    await expect(page.getByText(`+91${colleague}`).last()).toBeVisible();

    // inviting the same number twice is refused
    await page.getByLabel("Mobile number").fill(colleague);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("This already exists.")).toBeVisible();

    const { context, page: other } = await newPerson(browser);
    try {
      await signIn(other, colleague);
      await expect(other).toHaveURL(/\/join/);
      await expect(other.getByText("Verma Electricals")).toBeVisible();
      await other.getByRole("button", { name: "Accept" }).click();
      await expect(other).toHaveURL(/\/app$/);

      // limited access: no Team page, and the page itself bounces them back
      await expect(other.getByRole("link", { name: "Team" })).toHaveCount(0);
      await other.goto("/app/team");
      await expect(other).toHaveURL(/\/app$/);
      // can see branches but not add them
      await other.getByRole("link", { name: "Branches" }).click();
      await expect(other.getByText("Jayanagar 4th Block")).toBeVisible();
      await expect(other.getByRole("link", { name: /Add branch/ })).toHaveCount(0);
      await other.goto("/app/branches/new");
      await expect(other).toHaveURL(/\/app\/branches$/);
    } finally {
      await context.close();
    }

    // the owner now sees the colleague on the team, can change the role, and can remove them
    await page.reload();
    await expect(page.getByText(`+91${colleague}`).first()).toBeVisible();
    await page.getByLabel(new RegExp(`Role: \\+91${colleague}`)).selectOption("sales_operator");
    await expect(page.getByLabel(new RegExp(`Role: \\+91${colleague}`))).toHaveValue("sales_operator");
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await expect(page.getByText(`+91${colleague}`)).toHaveCount(0);
  });

  test("a removed person loses access on their very next page", async ({ page, browser }) => {
    await signIn(page, phone());
    await createShop(page, "Owner One", "Gone Soon Traders");
    await addBranch(page);

    const colleague = phone();
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByLabel("Mobile number").fill(colleague);
    await page.getByLabel("Role").selectOption("auditor");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation saved.")).toBeVisible();

    const { context, page: other } = await newPerson(browser);
    try {
      await signIn(other, colleague);
      await other.getByRole("button", { name: "Accept" }).click();
      await expect(other).toHaveURL(/\/app$/);

      await page.reload();
      await page.getByRole("button", { name: "Remove" }).click();
      await page.getByRole("button", { name: "Yes, remove" }).click();
      await expect(page.getByText(`+91${colleague}`)).toHaveCount(0);

      await other.goto("/app/branches");
      await expect(other).not.toHaveURL(/\/app\/branches/); // sent to set up their own shop or accept another invitation
    } finally {
      await context.close();
    }
  });

  test("an invitee can decline", async ({ page, browser }) => {
    await signIn(page, phone());
    await createShop(page, "Owner Two", "Decline Hardware");
    await addBranch(page);
    const colleague = phone();
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByLabel("Mobile number").fill(colleague);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation saved.")).toBeVisible();

    const { context, page: other } = await newPerson(browser);
    try {
      await signIn(other, colleague);
      await other.getByRole("button", { name: "Decline" }).click();
      await expect(other).toHaveURL(/\/onboarding\/shop/);
    } finally {
      await context.close();
    }
  });
});

test.describe("on a phone @phone", () => {
  test("the login and setup screens fit a small screen without sideways scrolling", async ({ page }) => {
    await page.goto("/login");
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    await signIn(page, phone());
    await expect(page).toHaveURL(/\/onboarding\/shop/);
    expect(await fits()).toBe(true);
    await createShop(page, "Phone User", "Phone Traders");
    expect(await fits()).toBe(true);
    await addBranch(page);
    expect(await fits()).toBe(true);
  });
});
