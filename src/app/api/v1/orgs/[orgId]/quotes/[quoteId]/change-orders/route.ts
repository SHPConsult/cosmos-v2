import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { createChangeOrder } from "@/lib/quoting/service";
import { quoteInputSchema } from "@/lib/quoting/validation";

type RouteParams = { params: Promise<{ orgId: string; quoteId: string }> };

/** Raise CO-00n against this approved estimate. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, quoteId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.QUOTE_MANAGE);

    const input = quoteInputSchema.parse(await request.json());
    return success(await createChangeOrder(orgId, quoteId, ctx.userId, input));
  } catch (error) {
    return handleApiError(error);
  }
}
