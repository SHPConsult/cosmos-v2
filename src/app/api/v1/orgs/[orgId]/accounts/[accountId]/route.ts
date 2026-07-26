import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission, NotFoundError } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { accountInputSchema } from "@/lib/quoting/validation";

type RouteParams = { params: Promise<{ orgId: string; accountId: string }> };

async function authed(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return null;
  return getAuthContext(org.slug);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, accountId } = await params;
    const ctx = await authed(orgId);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.ACCOUNT_READ);

    const row = await prisma.crmAccount.findFirst({ where: { id: accountId, orgId } });
    if (!row) throw new NotFoundError("Account not found");
    return success(row);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, accountId } = await params;
    const ctx = await authed(orgId);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.ACCOUNT_MANAGE);

    const existing = await prisma.crmAccount.findFirst({ where: { id: accountId, orgId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Account not found");

    const input = accountInputSchema.parse(await request.json());
    return success(await prisma.crmAccount.update({ where: { id: accountId }, data: { ...input } }));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, accountId } = await params;
    const ctx = await authed(orgId);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.ACCOUNT_MANAGE);

    const existing = await prisma.crmAccount.findFirst({ where: { id: accountId, orgId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Account not found");
    // Related quotes, invoices and jobs SET NULL rather than cascade — deleting a
    // customer record must never destroy billing history.
    await prisma.crmAccount.delete({ where: { id: accountId } });
    return success({ id: accountId, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
