/**
 * The closed Type vocabulary for field services — Residential, Commercial, GC.
 *
 * ONE source of truth, because this string appears in three places that must
 * agree or reporting silently breaks:
 *   1. the seeded `field-services.type` custom field's SELECT options,
 *   2. `CrmAccount.defaultType`, which pre-fills a new Job, and
 *   3. every revenue / win-rate report that groups by it.
 *
 * These are DISPLAY strings, not an enum, because they are the custom field's
 * options and are rendered verbatim. Deliberately not a Prisma enum: the field
 * is a CustomField row, so an enum would be a second vocabulary to keep in step.
 */
export const CUSTOMER_TYPES = ["Residential", "Commercial", "GC"] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Narrow an untrusted string (an imported CSV cell, an API body) to a Type. */
export function isCustomerType(v: unknown): v is CustomerType {
  return typeof v === "string" && (CUSTOMER_TYPES as readonly string[]).includes(v);
}

/**
 * Resolve the Type for a new Job: the explicit choice wins, falling back to the
 * Account's default. Returns null when neither is usable — the caller decides
 * whether that is an error, because the field is required at the API boundary
 * but a partially-filled capture form is not yet a Job.
 */
export function resolveJobType(
  explicit: unknown,
  accountDefault: unknown,
): CustomerType | null {
  if (isCustomerType(explicit)) return explicit;
  if (isCustomerType(accountDefault)) return accountDefault;
  return null;
}
