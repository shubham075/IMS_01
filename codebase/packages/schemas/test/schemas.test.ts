import { describe, expect, it } from "vitest";
import {
  createBranchSchema,
  createInvitationSchema,
  createOrgSchema,
  hoursSchema,
  locationSchema,
  normalizeIndianPhone,
  otpVerifySchema,
  phoneSchema,
  ROLE_RANK,
  ROLES,
  updateBranchSchema,
  updateMemberSchema,
  updateOrgSchema,
} from "../src";

describe("Indian phone numbers", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["(98765) 43210", "+919876543210"],
  ])("normalises %j", (input, expected) => {
    expect(normalizeIndianPhone(input)).toBe(expected);
    expect(phoneSchema.parse(input)).toBe(expected);
  });

  it.each(["", "12345", "5876543210", "98765432101", "abcdefghij", "+1 415 555 0100", "0987654321"])(
    "rejects %j",
    (input) => {
      expect(normalizeIndianPhone(input)).toBeNull();
      expect(phoneSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe("OTP verify", () => {
  it("needs exactly six digits", () => {
    expect(otpVerifySchema.safeParse({ phone: "9876543210", code: "123456" }).success).toBe(true);
    for (const code of ["12345", "1234567", "12345a", " 12345", ""]) {
      expect(otpVerifySchema.safeParse({ phone: "9876543210", code }).success, code).toBe(false);
    }
  });
});

describe("organisation", () => {
  it("normalises and validates GSTIN", () => {
    expect(
      createOrgSchema.parse({ name: "Shop", category: "hardware", gstin: " 29aaaaa0001a1z5 " }).gstin,
    ).toBe("29AAAAA0001A1Z5");
    for (const gstin of ["BADGSTIN", "29AAAAA0001A1Z", "29AAAAA0001A1Z55", "00AAAAA0001A1Z5X"]) {
      expect(createOrgSchema.safeParse({ name: "Shop", category: "hardware", gstin }).success, gstin).toBe(
        false,
      );
    }
  });
  it("trims the name and requires at least two characters", () => {
    expect(createOrgSchema.parse({ name: "  Sharma  ", category: "other" }).name).toBe("Sharma");
    expect(createOrgSchema.safeParse({ name: " A ", category: "other" }).success).toBe(false);
  });
  it("rejects unknown categories", () => {
    expect(createOrgSchema.safeParse({ name: "Shop", category: "weapons" }).success).toBe(false);
  });
  it("an update must change something, and may clear optional fields with null", () => {
    expect(updateOrgSchema.safeParse({}).success).toBe(false);
    expect(updateOrgSchema.parse({ gstin: null, legalName: null })).toEqual({ gstin: null, legalName: null });
  });
});

describe("opening hours", () => {
  it("accepts split shifts that do not overlap", () => {
    expect(
      hoursSchema.safeParse({
        mon: [
          ["09:00", "13:00"],
          ["16:00", "20:30"],
        ],
      }).success,
    ).toBe(true);
  });
  it("closing must be after opening", () => {
    const r = hoursSchema.safeParse({ mon: [["21:00", "09:00"]] });
    expect(r.success).toBe(false);
    expect(hoursSchema.safeParse({ mon: [["09:00", "09:00"]] }).success).toBe(false);
  });
  it("slots must not overlap", () => {
    expect(
      hoursSchema.safeParse({
        mon: [
          ["09:00", "13:00"],
          ["12:00", "18:00"],
        ],
      }).success,
    ).toBe(false);
  });
  it.each(["9:00", "24:00", "12:60", "noon", "09:00:00"])("rejects the time %j", (t) => {
    expect(hoursSchema.safeParse({ mon: [[t, "23:00"]] }).success).toBe(false);
  });
  it("rejects unknown weekdays but treats a missing day as closed", () => {
    expect(hoursSchema.safeParse({ funday: [["09:00", "10:00"]] }).success).toBe(false);
    expect(hoursSchema.safeParse({}).success).toBe(true);
  });
});

describe("location", () => {
  it("stays inside India's bounds", () => {
    expect(locationSchema.safeParse({ lat: 12.97, lng: 77.59 }).success).toBe(true);
    expect(locationSchema.safeParse({ lat: 51.5, lng: -0.12 }).success).toBe(false);
    expect(locationSchema.safeParse({ lat: 0, lng: 0 }).success).toBe(false);
  });
});

describe("branch create vs update", () => {
  const base = { name: "Main shop", addressLine: "12 Main Road", pincode: "560011" };

  it("create fills in the default contact option", () => {
    expect(createBranchSchema.parse(base).contactOptions).toEqual(["call"]);
  });

  it("update never injects defaults: an empty update is rejected, not turned into a silent overwrite", () => {
    expect(updateBranchSchema.safeParse({}).success).toBe(false);
    // Regression: a default on `contactOptions` used to leak into partial updates and reset a branch's contact options.
    expect(updateBranchSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });

  it("PIN codes are six digits and never start with 0", () => {
    for (const pincode of ["56001", "5600111", "060011", "56001a", ""]) {
      expect(createBranchSchema.safeParse({ ...base, pincode }).success, pincode).toBe(false);
    }
  });

  it("phone is normalised and may be cleared on update", () => {
    expect(createBranchSchema.parse({ ...base, phonePublic: "98765 43210" }).phonePublic).toBe(
      "+919876543210",
    );
    expect(updateBranchSchema.parse({ phonePublic: null })).toEqual({ phonePublic: null });
  });
});

describe("team", () => {
  it("an owner can never be invited or assigned", () => {
    expect(createInvitationSchema.safeParse({ phone: "9876543210", role: "owner" }).success).toBe(false);
    expect(updateMemberSchema.safeParse({ role: "owner" }).success).toBe(false);
  });
  it("invitation branches default to none (meaning all branches)", () => {
    expect(createInvitationSchema.parse({ phone: "9876543210", role: "auditor" }).branchIds).toEqual([]);
  });
  it("role ranks: owner > admin > branch manager > everyone else", () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.org_admin);
    expect(ROLE_RANK.org_admin).toBeGreaterThan(ROLE_RANK.branch_manager);
    expect(ROLE_RANK.branch_manager).toBeGreaterThan(ROLE_RANK.inventory_operator);
    expect(ROLE_RANK.inventory_operator).toBe(ROLE_RANK.sales_operator);
    expect(Object.keys(ROLE_RANK).sort()).toEqual([...ROLES].sort());
  });
});
