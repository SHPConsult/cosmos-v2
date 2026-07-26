import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { sendQuote } from "@/lib/quoting/service";

type RouteParams = { params: Promise<{ orgId: string; quoteId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, quoteId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.QUOTE_MANAGE);

    return success(await sendQuote(orgId, quoteId));
  } catch (error) {
    return handleApiError(error);
  }
}
