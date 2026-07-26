import { z } from "zod";

/** Money and quantities arrive as strings to survive JSON without float drift. */
const decimalish = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);

export const quoteLineSchema = z.object({
  description: z.string().min(1).max(500),
  serviceType: z.string().max(100).nullish(),
  // Negative quantities are rejected here; a CREDIT is expressed as a negative
  // unitPrice on a change order, so there is exactly one way to say it.
  quantity: decimalish.refine((v) => Number(v) >= 0, "quantity must be >= 0"),
  unit: z.string().max(30).nullish(),
  unitPrice: decimalish,
  taxRate: decimalish
    .refine((v) => Number(v) >= 0 && Number(v) < 1, "taxRate is a fraction, e.g. 0.06")
    .optional(),
  productId: z.string().uuid().nullish(),
});

export const quoteInputSchema = z.object({
  jobId: z.string().uuid().nullish(),
  accountId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  title: z.string().max(200).nullish(),
  terms: z.string().max(5000).nullish(),
  notes: z.string().max(5000).nullish(),
  lines: z.array(quoteLineSchema).min(1, "a quote needs at least one line"),
});

/** Revision may omit lines entirely — they are copied from the superseded row. */
export const quoteReviseSchema = quoteInputSchema.partial().extend({
  lines: z.array(quoteLineSchema).min(1).optional(),
});

export const quoteDecisionSchema = z
  .object({
    decision: z.enum(["APPROVED", "DECLINED"]),
    declineReason: z.string().max(1000).nullish(),
  })
  .refine(
    (v) => v.decision !== "DECLINED" || !!v.declineReason,
    { message: "a decline needs a reason", path: ["declineReason"] },
  );

export const accountInputSchema = z.object({
  name: z.string().min(1).max(200),
  defaultType: z.enum(["Residential", "Commercial", "GC"]).nullish(),
  billingEmail: z.string().email().nullish(),
  billingAddress: z.string().max(500).nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  notes: z.string().max(5000).nullish(),
  logoUrl: z.string().url().nullish(),
});

export const siteInputSchema = z.object({
  accountId: z.string().uuid().nullish(),
  label: z.string().max(200).nullish(),
  // Address is nullable everywhere by design — a Job is captured on a phone call
  // and the address arrives later.
  address: z.string().max(500).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  areaSqft: decimalish.nullish(),
  aerialRef: z.string().max(500).nullish(),
  notes: z.string().max(5000).nullish(),
});
