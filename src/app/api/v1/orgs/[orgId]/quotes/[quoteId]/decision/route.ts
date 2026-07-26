import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { decideQuote } from "@/lib/quoting/service";
import { quoteDecisionSchema } from "@/lib/quoting/validation";

type RouteParams = { params: Promise<{ orgId: string; quoteId: string }> };

/**
 * Record the customer's decision. Gated on QUOTE_APPROVE, not QUOTE_MANAGE:
 * building a quote and committing the company to the work are different
 * authorities, and ADR 0006's below-threshold path makes this an office action.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, quoteId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.QUOTE_APPROVE);

    const body = quoteDecisionSchema.parse(await request.json());
    return success(
      await decideQuote(orgId, quoteId, body.decision, body.declineReason),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
