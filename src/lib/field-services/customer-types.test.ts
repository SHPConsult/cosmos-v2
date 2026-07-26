import { describe, expect, it } from "vitest";
import { CUSTOMER_TYPES, isCustomerType, resolveJobType } from "./customer-types";
import { SECTOR_FIELD_TEMPLATES } from "@/lib/custom-fields/sector-field-templates";

describe("customer types", () => {
  it("is the closed three-value vocabulary", () => {
    expect([...CUSTOMER_TYPES]).toEqual(["Residential", "Commercial", "GC"]);
  });

  it("is the SAME vocabulary the seeded Type field offers", () => {
    // The whole point of the shared constant: if these drift, a Job can carry a
    // Type no report groups by, and the row vanishes from revenue silently.
    const typeField = SECTOR_FIELD_TEMPLATES["field-services"].find(
      (f) => f.key === "field-services.type",
    );
    expect(typeField?.options).toEqual([...CUSTOMER_TYPES]);
  });

  it("rejects near-misses rather than coercing them", () => {
    expect(isCustomerType("Residential")).toBe(true);
    expect(isCustomerType("residential")).toBe(false); // case matters — it is a display string
    expect(isCustomerType("Gc")).toBe(false);
    expect(isCustomerType("")).toBe(false);
    expect(isCustomerType(null)).toBe(false);
    expect(isCustomerType(undefined)).toBe(false);
    expect(isCustomerType(3)).toBe(false);
  });

  it("prefers an explicit choice over the account default", () => {
    expect(resolveJobType("GC", "Commercial")).toBe("GC");
  });

  it("falls back to the account default during fast capture", () => {
    expect(resolveJobType(undefined, "Commercial")).toBe("Commercial");
    expect(resolveJobType(null, "GC")).toBe("GC");
  });

  it("returns null when neither is usable — the caller decides if that is an error", () => {
    expect(resolveJobType(undefined, undefined)).toBeNull();
    expect(resolveJobType("nonsense", "also nonsense")).toBeNull();
  });

  it("ignores an invalid explicit value and still uses a valid default", () => {
    expect(resolveJobType("Resedential", "Residential")).toBe("Residential");
  });
});
