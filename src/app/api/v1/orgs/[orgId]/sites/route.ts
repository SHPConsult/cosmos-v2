import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/check";
import { Permission } from "@/lib/rbac/permissions";
import { success, handleApiError } from "@/lib/api-helpers";
import { siteInputSchema } from "@/lib/quoting/validation";

type RouteParams = { params: Promise<{ orgId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });
    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    requirePermission(ctx, Permission.SITE_READ);

    const q = request.nextUrl.searchParams.get("q");
    const accountId = request.nextUrl.searchParams.get("accountId");
    const data = await prisma.site.findMany({
      where: {
        orgId,
        ...(accountId ? { accountId } : {}),
        // A site is found by what it is called OR where it is — the crew know
        // the address, the office knows the name.
        ...(q
          ? {
              OR: [
                { label: { contains: q, mode: "insensitive" as const } },
                { address: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ label: "asc" }, { address: "asc" }],
      take: 500,
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
    requirePermission(ctx, Permission.SITE_MANAGE);

    const input = siteInputSchema.parse(await request.json());
    return success(
      await prisma.site.create({
        data: {
          orgId,
          ...input,
          areaSqft: input.areaSqft != null ? String(input.areaSqft) : null,
        },
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
