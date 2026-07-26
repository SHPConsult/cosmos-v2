import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { createQuote, listQuotesForJob } from "@/lib/quoting/service";
import { quoteInputSchema } from "@/lib/quoting/validation";

type RouteParams = { params: Promise<{ orgId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    // QUOTE_READ is the price-visibility bit: crew never hold it, so this route
    // is unreachable for them rather than merely empty.
    requirePermission(ctx, Permission.QUOTE_READ);

    const jobId = request.nextUrl.searchParams.get("jobId");
    if (jobId) {
      const data = await listQuotesForJob(orgId, jobId);
      return success({ data, total: data.length });
    }

    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const data = await prisma.quote.findMany({
      where: {
        orgId,
        ...(status ? { status: status as never } : {}),
      },
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return success({ data, total: data.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.QUOTE_MANAGE);

    const input = quoteInputSchema.parse(await request.json());
    return success(await createQuote(orgId, ctx.userId, input));
  } catch (error) {
    return handleApiError(error);
  }
}
