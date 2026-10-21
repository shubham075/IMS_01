import type { useTranslations } from "next-intl";

type T = ReturnType<typeof useTranslations>;

/**
 * The shared schemas carry English messages (so the API and any client can use them as they are). This maps each one to a
 * translation key so the web app can show it in the user's language. Unknown messages fall through unchanged.
 * (Follow-up: have the schemas emit message keys directly, and drop this table.)
 */
const RULES: Array<[RegExp, string, ((m: RegExpExecArray) => string)?]> = [
  [/^Enter a valid 10-digit Indian mobile number\.$/, "phone"],
  [/^Enter the 6-digit code\.$/, "code"],
  [/^Enter your shop name \(at least 2 letters\)\.$/, "shopName"],
  [/^This GSTIN does not look right\. Check the 15 characters\.$/, "gstin"],
  [/^PIN code must be 6 digits\.$/, "pincode"],
  [/^Enter a branch name \(at least 2 letters\)\.$/, "branchName"],
  [/^Enter the address\.$/, "address"],
  [/^Closing time must be after opening time for (\w+)\.$/, "hoursOrder", (m) => m[1]!],
  [/^Time slots overlap on (\w+)\.$/, "hoursOverlap", (m) => m[1]!],
  [/^Use HH:MM \(24-hour\)\.$/, "timeFormat"],
  [/^Enter the product name \(at least 2 letters\)\.$/, "productName"],
  [/^Product name is too long\.$/, "productNameLong"],
  [/^Price cannot be negative\.$/, "priceNegative"],
  [/^Price is too high\.$/, "priceHigh"],
  [/^Enter a whole number of paise\.$/, "priceFormat"],
  [/^Barcode must be 4–32 letters or digits\.$/, "barcode"],
  [/^Product code can use letters, digits and \. _ \/ - \(max 40\)\.$/, "sku"],
  [/^Invalid UUID.*$/, "chooseCategory"],
  [/^Choose a category from the list\.$/, "chooseCategory"],
  [/^Turn the product on before showing it to shoppers\.$/, "productOff"],
  [/^Type something to search\.$/, "searchEmpty"],
  [/^Quantity must be more than zero\.$/, "quantityPositive"],
  [/^Quantity is too large\.$/, "quantityLarge"],
  [/^Use at most 3 decimal places\.$/, "quantityDecimals"],
  [/^Choose whether stock went up or down\.$/, "chooseDirection"],
  [/^Say why you are adjusting the stock\.$/, "whyRequired"],
  [/^Remove unusual characters\.$/, "unusualChars"],
  [/^The unit cannot change after stock has been recorded\.$/, "unitLocked"],
  [/^This product is not counted\. Mark it in stock or out of stock instead\.$/, "notCounted"],
  [/^This product is counted\. Record stock in or out instead\.$/, "counted"],
  [/^Add at least one product\.$/, "addProducts"],
  [/^Choose two different branches\.$/, "differentBranches"],
  [/^A transfer can have at most 100 products\.$/, "tooManyLines"],
  [/^Each product can appear only once\.$/, "oncePerProduct"],
  [/^This product is not counted, so it cannot be transferred\.$/, "notCountedTransfer"],
  [/^Place the pin inside India\.$/, "pinOutsideIndia"],
  [/^Invalid input.*$/, "required"],
];

export function validationText(t: T, message: string | undefined): string | undefined {
  if (!message) return undefined;
  for (const [rx, key, day] of RULES) {
    const m = rx.exec(message);
    if (!m) continue;
    return t(
      `validation.${key}`,
      day ? { day: t.has(`branchForm.days.${day(m)}`) ? t(`branchForm.days.${day(m)}`) : day(m) } : {},
    );
  }
  return message;
}
