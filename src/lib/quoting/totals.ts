import { Prisma } from "@prisma/client";
import { sumMoney } from "@/lib/money";
import { lineAmount, lineTax } from "@/lib/invoicing/totals";

/**
 * Quote totals + the amount a Job should be invoiced for.
 *
 * Line maths is deliberately REUSED from invoicing (`lineAmount`, `lineTax`)
 * rather than reimplemented: a Quote and the Invoice it becomes must agree to the
 * cent, and two copies of half-even rounding is how they stop agreeing.
 */

export type QuoteTotals = {
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
};

export { lineAmount, lineTax };

/** Fold computed line items into quote totals. All half-even cents. */
export function quoteTotals(
  lines: { amount: Prisma.Decimal; taxRate: Prisma.Decimal }[],
): QuoteTotals {
  const subtotal = sumMoney(lines.map((l) => l.amount));
  const taxTotal = sumMoney(lines.map((l) => lineTax(l.amount, l.taxRate)));
  return { subtotal, taxTotal, total: subtotal.plus(taxTotal) };
}

export type QuoteKindValue = "ESTIMATE" | "CHANGE_ORDER";
export type QuoteStatusValue =
  | "DRAFT"
  | "SENT"
  | "APPROVED"
  | "DECLINED"
  | "SUPERSEDED";

export interface QuoteLike {
  kind: QuoteKindValue;
  status: QuoteStatusValue;
  total: Prisma.Decimal;
}

/**
 * THE invoice rule:
 *
 *     invoice total = approved estimate + Σ approved change orders
 *
 * Everything not APPROVED contributes exactly zero — a draft change order the
 * customer never saw, one they declined, and a superseded estimate revision are
 * all worth nothing. A credit (negative-total) change order subtracts, which is
 * how scope removal is billed back.
 *
 * Returns 0 when no estimate is approved: a Job with change orders but no
 * approved estimate has nothing sold, so there is nothing to bill. Callers must
 * treat a zero total as "not invoiceable" rather than raising a zero invoice —
 * `sendInvoice` already rejects a non-positive total.
 */
export function invoiceableTotal(quotes: readonly QuoteLike[]): Prisma.Decimal {
  const approved = quotes.filter((q) => q.status === "APPROVED");
  const estimates = approved.filter((q) => q.kind === "ESTIMATE");
  if (estimates.length === 0) return new Prisma.Decimal(0);

  // More than one approved estimate means a revision was approved without its
  // predecessor being superseded. Summing them would double-bill the customer,
  // so take the largest and let the caller surface the inconsistency.
  const estimateTotal = estimates.reduce(
    (max, q) => (q.total.greaterThan(max) ? q.total : max),
    new Prisma.Decimal(0),
  );

  const changeOrders = sumMoney(
    approved.filter((q) => q.kind === "CHANGE_ORDER").map((q) => q.total),
  );

  return estimateTotal.plus(changeOrders);
}

/**
 * True when more than one ESTIMATE is APPROVED at once — an inconsistent state
 * `invoiceableTotal` tolerates rather than throws on, so billing degrades safely
 * instead of failing outright. Surface it as a warning on the Job.
 */
export function hasConflictingApprovedEstimates(
  quotes: readonly QuoteLike[],
): boolean {
  return (
    quotes.filter((q) => q.status === "APPROVED" && q.kind === "ESTIMATE").length > 1
  );
}
