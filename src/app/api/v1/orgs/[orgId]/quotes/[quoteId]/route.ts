import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission, NotFoundError, ConflictError } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { updateQuote } from "@/lib/quoting/service";
import { quoteInputSchema } from "@/lib/quoting/validation";

type RouteParams = { params: Promise<{ orgId: string; quoteId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, quoteId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.QUOTE_READ);

    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, orgId },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        changeOrders: { orderBy: { number: "asc" } },
      },
    });
    if (!quote) throw new NotFoundError("Quote not found");
    return success(quote);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, quoteId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.QUOTE_MANAGE);

    const input = quoteInputSchema.parse(await request.json());
    return success(await updateQuote(orgId, quoteId, input));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, quoteId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.QUOTE_MANAGE);

    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, orgId },
      select: { status: true },
    });
    if (!quote) throw new NotFoundError("Quote not found");
    // Anything the customer has seen is a record, not a scratch pad. Decline it
    // or supersede it — deleting would erase why a job was won or lost.
    if (quote.status !== "DRAFT") {
      throw new ConflictError("Only a draft quote can be deleted");
    }
    await prisma.quote.delete({ where: { id: quoteId } });
    return success({ id: quoteId, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
