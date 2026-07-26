import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  quoteTotals,
  lineAmount,
  invoiceableTotal,
  hasConflictingApprovedEstimates,
  type QuoteLike,
} from "./totals";

const D = (v: string) => new Prisma.Decimal(v);

/** Terser fixtures — the rule under test is about kind/status/total only. */
const q = (
  kind: QuoteLike["kind"],
  status: QuoteLike["status"],
  total: string,
): QuoteLike => ({ kind, status, total: D(total) });

describe("quoteTotals", () => {
  it("sums line amounts and per-line tax to the cent", () => {
    const lines = [
      { amount: lineAmount(D("1"), D("18600.00")), taxRate: D("0") },
      { amount: lineAmount(D("2"), D("1200.00")), taxRate: D("0.06") },
    ];
    const t = quoteTotals(lines);
    expect(t.subtotal.toString()).toBe("21000");
    expect(t.taxTotal.toString()).toBe("144"); // 2400 * 0.06
    expect(t.total.toString()).toBe("21144");
  });

  it("has no float drift on repeating quantities", () => {
    // 3 × 0.10 must be 0.30, not 0.30000000000000004.
    const lines = [{ amount: lineAmount(D("3"), D("0.10")), taxRate: D("0") }];
    expect(quoteTotals(lines).total.toString()).toBe("0.3");
  });

  it("totals an empty quote to zero rather than throwing", () => {
    expect(quoteTotals([]).total.toString()).toBe("0");
  });
});

describe("invoiceableTotal — approved estimate + approved change orders", () => {
  it("bills the estimate alone when there are no change orders", () => {
    expect(invoiceableTotal([q("ESTIMATE", "APPROVED", "18600")]).toString()).toBe(
      "18600",
    );
  });

  it("adds an approved change order (the Costco case: 18,600 + 2,400)", () => {
    const total = invoiceableTotal([
      q("ESTIMATE", "APPROVED", "18600"),
      q("CHANGE_ORDER", "APPROVED", "2400"),
    ]);
    expect(total.toString()).toBe("21000");
  });

  it("ignores a DECLINED change order entirely", () => {
    const total = invoiceableTotal([
      q("ESTIMATE", "APPROVED", "18600"),
      q("CHANGE_ORDER", "APPROVED", "2400"),
      q("CHANGE_ORDER", "DECLINED", "800"),
    ]);
    expect(total.toString()).toBe("21000");
  });

  it("ignores a DRAFT change order the customer has never seen", () => {
    const total = invoiceableTotal([
      q("ESTIMATE", "APPROVED", "18600"),
      q("CHANGE_ORDER", "DRAFT", "5000"),
    ]);
    expect(total.toString()).toBe("18600");
  });

  it("ignores a SENT-but-undecided change order", () => {
    const total = invoiceableTotal([
      q("ESTIMATE", "APPROVED", "18600"),
      q("CHANGE_ORDER", "SENT", "5000"),
    ]);
    expect(total.toString()).toBe("18600");
  });

  it("subtracts a credit change order (scope removed)", () => {
    const total = invoiceableTotal([
      q("ESTIMATE", "APPROVED", "18600"),
      q("CHANGE_ORDER", "APPROVED", "-800"),
    ]);
    expect(total.toString()).toBe("17800");
  });

  it("bills nothing when no estimate is approved, even with approved change orders", () => {
    // Nothing was sold, so there is nothing to bill — a change order cannot
    // stand on its own.
    const total = invoiceableTotal([
      q("ESTIMATE", "SENT", "18600"),
      q("CHANGE_ORDER", "APPROVED", "2400"),
    ]);
    expect(total.toString()).toBe("0");
  });

  it("ignores a SUPERSEDED estimate revision", () => {
    const total = invoiceableTotal([
      q("ESTIMATE", "SUPERSEDED", "15000"),
      q("ESTIMATE", "APPROVED", "18600"),
    ]);
    expect(total.toString()).toBe("18600");
  });

  it("takes the largest rather than double-billing two approved estimates", () => {
    const quotes = [
      q("ESTIMATE", "APPROVED", "15000"),
      q("ESTIMATE", "APPROVED", "18600"),
    ];
    expect(invoiceableTotal(quotes).toString()).toBe("18600");
    expect(hasConflictingApprovedEstimates(quotes)).toBe(true);
  });

  it("reports no conflict in the normal single-estimate case", () => {
    expect(
      hasConflictingApprovedEstimates([
        q("ESTIMATE", "APPROVED", "18600"),
        q("CHANGE_ORDER", "APPROVED", "2400"),
      ]),
    ).toBe(false);
  });

  it("sums many change orders without drift", () => {
    const total = invoiceableTotal([
      q("ESTIMATE", "APPROVED", "1000.10"),
      q("CHANGE_ORDER", "APPROVED", "0.10"),
      q("CHANGE_ORDER", "APPROVED", "0.20"),
    ]);
    expect(total.toString()).toBe("1000.4");
  });

  it("bills zero for a Job with no quotes at all", () => {
    expect(invoiceableTotal([]).toString()).toBe("0");
  });
});
