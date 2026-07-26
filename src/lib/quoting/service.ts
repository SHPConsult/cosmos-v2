import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { ConflictError, NotFoundError } from "@/lib/rbac/check";
import {
  changeOrderPrefix,
  formatSequence,
  nextSequenceNumber,
  quotePrefix,
} from "@/lib/numbering/sequence";
import { lineAmount, quoteTotals } from "./totals";

const D = (v: number | string) => new Prisma.Decimal(v);

const withDetail: Prisma.QuoteInclude = {
  lineItems: { orderBy: { sortOrder: "asc" } },
};

export type QuoteLineInput = {
  description: string;
  serviceType?: string | null;
  quantity: number | string;
  unit?: string | null;
  unitPrice: number | string;
  taxRate?: number | string;
  productId?: string | null;
};

export type QuoteInput = {
  jobId?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  title?: string | null;
  terms?: string | null;
  notes?: string | null;
  lines: QuoteLineInput[];
};

function computeLines(lines: QuoteLineInput[]) {
  return lines.map((l, i) => {
    const quantity = D(l.quantity);
    const unitPrice = D(l.unitPrice);
    return {
      description: l.description,
      serviceType: l.serviceType ?? null,
      quantity,
      unit: l.unit ?? null,
      unitPrice,
      taxRate: D(l.taxRate ?? 0),
      amount: lineAmount(quantity, unitPrice),
      productId: l.productId ?? null,
      sortOrder: i,
    };
  });
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Highest sequence for a prefix + 1, computed inside the tx. */
async function mintNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
  prefix: string,
  pad: number,
): Promise<string> {
  const existing = await tx.quote.findMany({
    where: { orgId, number: { startsWith: prefix } },
    select: { number: true },
  });
  const seq = nextSequenceNumber(
    existing.map((r) => r.number),
    prefix,
  );
  return formatSequence(prefix, seq, pad);
}

/** Editing is only ever allowed before the customer has seen it. */
function assertEditable(status: string) {
  if (status !== "DRAFT") {
    throw new ConflictError(
      "Only a draft quote can be edited — revise it instead to keep the sent version intact",
    );
  }
}

/**
 * Create a new ESTIMATE at revision 1.
 *
 * The retry absorbs the rare number race exactly as invoicing does: the unique
 * (orgId, number, revision) constraint is the source of truth, and a collision
 * simply re-mints.
 */
export async function createQuote(
  orgId: string,
  createdById: string,
  input: QuoteInput,
) {
  const computed = computeLines(input.lines);
  const totals = quoteTotals(computed);
  const prefix = quotePrefix(new Date().getFullYear());

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const number = await mintNumber(tx, orgId, prefix, 4);
        return tx.quote.create({
          data: {
            orgId,
            number,
            revision: 1,
            kind: "ESTIMATE",
            status: "DRAFT",
            createdById,
            jobId: input.jobId ?? null,
            accountId: input.accountId ?? null,
            contactId: input.contactId ?? null,
            title: input.title ?? null,
            terms: input.terms ?? null,
            notes: input.notes ?? null,
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            lineItems: { create: computed },
          },
          include: withDetail,
        });
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/** Edit a draft in place. Line items are replaced wholesale. */
export async function updateQuote(
  orgId: string,
  quoteId: string,
  input: QuoteInput,
) {
  const existing = await prisma.quote.findFirst({
    where: { id: quoteId, orgId },
    select: { status: true },
  });
  if (!existing) throw new NotFoundError("Quote not found");
  assertEditable(existing.status);

  const computed = computeLines(input.lines);
  const totals = quoteTotals(computed);

  return prisma.$transaction(async (tx) => {
    await tx.quoteLineItem.deleteMany({ where: { quoteId } });
    return tx.quote.update({
      where: { id: quoteId },
      data: {
        jobId: input.jobId ?? null,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        title: input.title ?? null,
        terms: input.terms ?? null,
        notes: input.notes ?? null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        lineItems: { create: computed },
      },
      include: withDetail,
    });
  });
}

/**
 * Supersede a quote and open the next revision.
 *
 * The new revision KEEPS the number — the customer keeps saying "Q-2026-0042"
 * — and carries its own line items, so the version they actually saw is never
 * mutated. Lines are copied when the caller doesn't supply replacements, which
 * is the common case: revise, then tweak.
 *
 * An APPROVED estimate cannot be revised. Once work is sold, a change in scope
 * is a Change Order (which is billable and separately approved), not a quiet
 * edit to what was agreed.
 */
export async function reviseQuote(
  orgId: string,
  quoteId: string,
  createdById: string,
  input?: Partial<QuoteInput>,
) {
  const current = await prisma.quote.findFirst({
    where: { id: quoteId, orgId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!current) throw new NotFoundError("Quote not found");
  if (current.kind !== "ESTIMATE") {
    throw new ConflictError("Only an estimate can be revised");
  }
  if (current.status === "APPROVED") {
    throw new ConflictError(
      "An approved estimate cannot be revised — raise a change order instead",
    );
  }

  const computed = input?.lines
    ? computeLines(input.lines)
    : current.lineItems.map((l, i) => ({
        description: l.description,
        serviceType: l.serviceType,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        amount: l.amount,
        productId: l.productId,
        sortOrder: i,
      }));
  const totals = quoteTotals(computed);

  return prisma.$transaction(async (tx) => {
    await tx.quote.update({
      where: { id: quoteId },
      data: { status: "SUPERSEDED" },
    });
    return tx.quote.create({
      data: {
        orgId,
        number: current.number,
        revision: current.revision + 1,
        kind: "ESTIMATE",
        status: "DRAFT",
        createdById,
        jobId: input?.jobId ?? current.jobId,
        accountId: input?.accountId ?? current.accountId,
        contactId: input?.contactId ?? current.contactId,
        title: input?.title ?? current.title,
        terms: input?.terms ?? current.terms,
        notes: input?.notes ?? current.notes,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        lineItems: { create: computed },
      },
      include: withDetail,
    });
  });
}

/**
 * Raise a Change Order against an APPROVED estimate.
 *
 * Numbered per parent (CO-001, CO-002) but stored compound so it stays unique
 * org-wide. A negative total is legitimate — that is how removed scope is
 * credited back.
 */
export async function createChangeOrder(
  orgId: string,
  parentQuoteId: string,
  createdById: string,
  input: QuoteInput,
) {
  const parent = await prisma.quote.findFirst({
    where: { id: parentQuoteId, orgId },
  });
  if (!parent) throw new NotFoundError("Estimate not found");
  if (parent.kind !== "ESTIMATE") {
    throw new ConflictError("A change order must hang off an estimate");
  }
  if (parent.status !== "APPROVED") {
    throw new ConflictError(
      "A change order can only be raised against an approved estimate",
    );
  }

  const computed = computeLines(input.lines);
  const totals = quoteTotals(computed);
  const prefix = changeOrderPrefix(parent.number);

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const number = await mintNumber(tx, orgId, prefix, 3);
        return tx.quote.create({
          data: {
            orgId,
            number,
            revision: 1,
            kind: "CHANGE_ORDER",
            status: "DRAFT",
            parentQuoteId: parent.id,
            createdById,
            // A change order always belongs to the same job and customer as the
            // estimate it varies — never taken from the request body.
            jobId: parent.jobId,
            accountId: parent.accountId,
            contactId: parent.contactId,
            title: input.title ?? null,
            terms: input.terms ?? null,
            notes: input.notes ?? null,
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            lineItems: { create: computed },
          },
          include: withDetail,
        });
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/** DRAFT → SENT. Stamps issuedAt; the document is immutable from here. */
export async function sendQuote(orgId: string, quoteId: string) {
  const q = await prisma.quote.findFirst({
    where: { id: quoteId, orgId },
    select: { status: true },
  });
  if (!q) throw new NotFoundError("Quote not found");
  if (q.status !== "DRAFT") {
    throw new ConflictError("Only a draft quote can be sent");
  }
  return prisma.quote.update({
    where: { id: quoteId },
    data: { status: "SENT", issuedAt: new Date() },
    include: withDetail,
  });
}

/**
 * Record the customer's decision.
 *
 * SENT is the only state a decision can be recorded from — approving a draft the
 * customer never received would put unseen money on an invoice. A decline reason
 * is captured because losing is the more informative outcome.
 */
export async function decideQuote(
  orgId: string,
  quoteId: string,
  decision: "APPROVED" | "DECLINED",
  declineReason?: string | null,
) {
  const q = await prisma.quote.findFirst({
    where: { id: quoteId, orgId },
    select: { status: true },
  });
  if (!q) throw new NotFoundError("Quote not found");
  if (q.status !== "SENT") {
    throw new ConflictError("Only a sent quote can be approved or declined");
  }
  return prisma.quote.update({
    where: { id: quoteId },
    data: {
      status: decision,
      decidedAt: new Date(),
      declineReason: decision === "DECLINED" ? (declineReason ?? null) : null,
    },
    include: withDetail,
  });
}

/** Every quote on a Job, newest first — the Paperwork tab's query. */
export async function listQuotesForJob(orgId: string, jobId: string) {
  return prisma.quote.findMany({
    where: { orgId, jobId },
    include: withDetail,
    orderBy: [{ createdAt: "desc" }],
  });
}
