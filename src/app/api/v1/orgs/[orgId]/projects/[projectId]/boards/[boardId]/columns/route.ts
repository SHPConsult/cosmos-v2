import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthContext } from "@/lib/auth/session";
import { Permission, hasPermission } from "@/lib/rbac/permissions";
import { canManageProject } from "@/lib/rbac/scope";
import { ConflictError } from "@/lib/rbac/check";
import { success, handleApiError, getIpAddress } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { ColumnCategory } from "@prisma/client";

const columnSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().min(1).max(50),
  key: z.string().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  wipLimit: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int(),
  category: z.nativeEnum(ColumnCategory).optional(),
});

const reorderSchema = z.object({
  columns: z.array(columnSchema),
});

type RouteParams = { params: Promise<{ orgId: string; projectId: string; boardId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId, projectId, boardId } = await params;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return new Response("Not found", { status: 404 });

    const ctx = await getAuthContext(org.slug);
    if (!ctx) return new Response("Unauthorized", { status: 401 });
    // Inheriting authority: org-wide BOARD_UPDATE holder OR project MANAGER.
    if (
      !hasPermission(ctx.permissions, Permission.BOARD_UPDATE) &&
      !(await canManageProject(ctx, projectId))
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    const board = await prisma.board.findFirst({ where: { id: boardId, projectId, orgId } });
    if (!board) return new Response("Not found", { status: 404 });

    const body = await request.json();
    const { columns } = reorderSchema.parse(body);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.boardColumn.findMany({
        where: { boardId },
        select: { id: true, name: true, key: true, category: true, locked: true },
      });
      const existingIds = existing.map((c) => c.id);

      // System-owned columns are the contract a sector's automation and reporting
      // read (field-services: a Job entering `completed` mints a draft invoice).
      // Deleting or re-keying one silently breaks billing, so reject rather than
      // letting the board editor do it. Cosmetics — color, WIP limit, ordering —
      // stay editable; identity and semantics do not.
      const lockedById = new Map(existing.filter((c) => c.locked).map((c) => [c.id, c]));

      const incomingIds = columns.filter((c) => c.id).map((c) => c.id!);
      const toDelete = existingIds.filter((id) => !incomingIds.includes(id));

      const deletingLocked = toDelete.filter((id) => lockedById.has(id));
      if (deletingLocked.length > 0) {
        const names = deletingLocked.map((id) => lockedById.get(id)!.name).join(", ");
        throw new ConflictError(`Cannot delete system-owned column(s): ${names}`);
      }

      for (const col of columns) {
        const locked = col.id ? lockedById.get(col.id) : undefined;
        if (!locked) continue;
        if (col.key !== locked.key) {
          throw new ConflictError(
            `Cannot change the key of system-owned column "${locked.name}"`,
          );
        }
        if (col.name !== locked.name) {
          throw new ConflictError(`Cannot rename system-owned column "${locked.name}"`);
        }
        if (col.category !== undefined && col.category !== locked.category) {
          throw new ConflictError(
            `Cannot change the category of system-owned column "${locked.name}"`,
          );
        }
      }

      if (toDelete.length > 0) {
        await tx.boardColumn.deleteMany({ where: { id: { in: toDelete } } });
      }

      for (const col of columns) {
        if (col.id && existingIds.includes(col.id)) {
          await tx.boardColumn.update({
            where: { id: col.id },
            data: {
              name: col.name,
              key: col.key,
              color: col.color ?? undefined,
              wipLimit: col.wipLimit ?? null,
              sortOrder: col.sortOrder,
              category: col.category,
            },
          });
        } else {
          await tx.boardColumn.create({
            data: {
              boardId,
              name: col.name,
              key: col.key,
              color: col.color ?? "#7dd3fc",
              wipLimit: col.wipLimit ?? null,
              sortOrder: col.sortOrder,
              category: col.category ?? "TODO",
            },
          });
        }
      }

      return tx.boardColumn.findMany({
        where: { boardId },
        orderBy: { sortOrder: "asc" },
      });
    });

    await logAudit({
      orgId,
      userId: ctx.userId,
      action: "board.columns_updated",
      entity: "board",
      entityId: boardId,
      metadata: { columnCount: String(columns.length) } as Record<string, string>,
      ipAddress: getIpAddress(request),
    });

    return success(result);
  } catch (error) {
    return handleApiError(error);
  }
}
