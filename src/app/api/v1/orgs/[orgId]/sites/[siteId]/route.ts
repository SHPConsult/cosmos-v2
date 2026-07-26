import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission, NotFoundError } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { siteInputSchema } from "@/lib/quoting/validation";

type RouteParams = { params: Promise<{ orgId: string; siteId: string }> };

async function authed(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return null;
  return getAuthContext(org.slug);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, siteId } = await params;
    const ctx = await authed(orgId);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.SITE_READ);

    const row = await prisma.site.findFirst({ where: { id: siteId, orgId } });
    if (!row) throw new NotFoundError("Site not found");
    return success(row);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, siteId } = await params;
    const ctx = await authed(orgId);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.SITE_MANAGE);

    const existing = await prisma.site.findFirst({ where: { id: siteId, orgId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Site not found");

    const input = siteInputSchema.parse(await request.json());
    return success(await prisma.site.update({ where: { id: siteId }, data: { ...input, areaSqft: input.areaSqft != null ? String(input.areaSqft) : null } }));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, siteId } = await params;
    const ctx = await authed(orgId);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.SITE_MANAGE);

    const existing = await prisma.site.findFirst({ where: { id: siteId, orgId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Site not found");
    // Related quotes, invoices and jobs SET NULL rather than cascade — deleting a
    // customer record must never destroy billing history.
    await prisma.site.delete({ where: { id: siteId } });
    return success({ id: siteId, deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
