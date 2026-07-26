import type { PrismaClient } from "@prisma/client";

/**
 * Field-services sector — trade contractors (asphalt, paving, striping, snow).
 *
 * The load-bearing piece here is the JOB STATUS BAR. A Job is a WorkItem and its
 * status IS its board column key (ADR 0004), so these nine keys are a contract:
 * the Completed → draft-invoice transition hook and every revenue report read
 * them. They are seeded `locked: true` so the board editor cannot rename, re-key
 * or delete one and silently break billing.
 *
 * Unlike the other sectors, this one ships a SINGLE work-item type. A contractor's
 * work does not decompose into a type hierarchy — a Job is a Job. Multi-day work
 * uses WorkItem's parent/child relation, not a second type.
 */

const FIELD_SERVICES_WORK_ITEM_TYPES = [
  {
    key: "field-services.job",
    name: "Job",
    pluralName: "Jobs",
    icon: "HardHat",
    color: "#74bc44",
    sortOrder: 0,
    celebrateOnComplete: true,
  },
];

/**
 * The nine canonical statuses, left to right. `lost` and `dormant` are terminal
 * but NOT successes, so they take CANCELLED rather than DONE — this keeps them
 * out of completion metrics and cycle-time maths while still closing the Job.
 */
const JOB_STATUS_COLUMNS = [
  { name: "New", key: "new", color: "#94a3b8", category: "TODO", locked: true },
  { name: "Estimating", key: "estimating", color: "#38bdf8", category: "TODO", locked: true },
  { name: "Approved", key: "approved", color: "#74bc44", category: "TODO", locked: true },
  { name: "Scheduled", key: "scheduled", color: "#a78bfa", category: "TODO", locked: true },
  { name: "In Progress", key: "in-progress", color: "#f59e0b", category: "IN_PROGRESS", locked: true },
  { name: "Completed", key: "completed", color: "#34d399", category: "IN_PROGRESS", locked: true },
  { name: "Invoiced", key: "invoiced", color: "#1a1a1a", category: "DONE", locked: true },
  { name: "Lost", key: "lost", color: "#ef4444", category: "CANCELLED", locked: true },
  { name: "Dormant", key: "dormant", color: "#64748b", category: "CANCELLED", locked: true },
];

const FIELD_SERVICES_PROJECT_TEMPLATE = {
  slug: "field-services",
  sector: "field-services",
  name: "Operations",
  description:
    "Jobs from first call to paid invoice — quotes, scheduling, crews, and billing for a trade contractor.",
  defaultConfig: {
    intervalKinds: ["SEASON"],
    cycleNavLabel: "Seasons",
    enabledFeatures: ["kpi", "meeting_note"],
  },
};

const FIELD_SERVICES_BOARD_TEMPLATES = [
  {
    // The default view is a filterable TABLE, not a kanban — office staff live in
    // a list and scan it; the board is the secondary view.
    slug: "field-services.jobs-table",
    name: "Jobs",
    category: "tracking",
    boardType: "TABLE",
    sortOrder: 0,
    columns: JOB_STATUS_COLUMNS,
  },
  {
    slug: "field-services.pipeline",
    name: "Pipeline",
    category: "tracking",
    boardType: "KANBAN",
    sortOrder: 1,
    columns: JOB_STATUS_COLUMNS,
  },
  {
    slug: "field-services.schedule",
    name: "Schedule",
    category: "planning",
    boardType: "CALENDAR",
    sortOrder: 2,
    columns: [],
  },
];

export async function seedFieldServices(prisma: PrismaClient) {
  // 1. Work item types (orgId: null, projectTemplateId: null for built-ins)
  for (const t of FIELD_SERVICES_WORK_ITEM_TYPES) {
    const existing = await prisma.workItemType.findFirst({
      where: { orgId: null, key: t.key },
    });
    if (existing) {
      await prisma.workItemType.update({
        where: { id: existing.id },
        data: { name: t.name, pluralName: t.pluralName, icon: t.icon, color: t.color },
      });
    } else {
      await prisma.workItemType.create({
        data: {
          key: t.key,
          name: t.name,
          pluralName: t.pluralName ?? null,
          icon: t.icon,
          color: t.color,
          isBuiltIn: true,
          sortOrder: t.sortOrder,
          defaultParentTypeKey: null,
          celebrateOnComplete: t.celebrateOnComplete,
        },
      });
    }
  }
  console.log(
    `  field-services: upserted ${FIELD_SERVICES_WORK_ITEM_TYPES.length} work item types`,
  );

  // 2. Project template
  const existingPt = await prisma.projectTemplate.findFirst({
    where: { orgId: null, slug: FIELD_SERVICES_PROJECT_TEMPLATE.slug },
  });
  let projectTemplate: { id: string };
  if (existingPt) {
    projectTemplate = await prisma.projectTemplate.update({
      where: { id: existingPt.id },
      data: {
        name: FIELD_SERVICES_PROJECT_TEMPLATE.name,
        description: FIELD_SERVICES_PROJECT_TEMPLATE.description,
        sector: FIELD_SERVICES_PROJECT_TEMPLATE.sector,
        defaultConfig: FIELD_SERVICES_PROJECT_TEMPLATE.defaultConfig,
        isBuiltIn: true,
        isPublished: true,
      },
    });
  } else {
    projectTemplate = await prisma.projectTemplate.create({
      data: {
        slug: FIELD_SERVICES_PROJECT_TEMPLATE.slug,
        sector: FIELD_SERVICES_PROJECT_TEMPLATE.sector,
        name: FIELD_SERVICES_PROJECT_TEMPLATE.name,
        description: FIELD_SERVICES_PROJECT_TEMPLATE.description,
        defaultConfig: FIELD_SERVICES_PROJECT_TEMPLATE.defaultConfig,
        isBuiltIn: true,
        isPublished: true,
      },
    });
  }
  console.log(`  field-services: upserted project template (id=${projectTemplate.id})`);

  // 3. Board templates
  for (const bt of FIELD_SERVICES_BOARD_TEMPLATES) {
    const existingBt = await prisma.boardTemplate.findFirst({
      where: { orgId: null, slug: bt.slug },
    });
    const defaultConfig = bt.columns.length > 0 ? { columns: bt.columns } : {};
    if (existingBt) {
      await prisma.boardTemplate.update({
        where: { id: existingBt.id },
        data: {
          name: bt.name,
          category: bt.category,
          boardType: bt.boardType,
          sortOrder: bt.sortOrder,
          sector: "field-services",
          projectTemplateId: projectTemplate.id,
          isBuiltIn: true,
          isPublished: true,
          defaultConfig,
        },
      });
    } else {
      await prisma.boardTemplate.create({
        data: {
          slug: bt.slug,
          name: bt.name,
          category: bt.category,
          boardType: bt.boardType,
          sortOrder: bt.sortOrder,
          sector: "field-services",
          projectTemplateId: projectTemplate.id,
          isBuiltIn: true,
          isPublished: true,
          defaultConfig,
        },
      });
    }
  }
  console.log(
    `  field-services: upserted ${FIELD_SERVICES_BOARD_TEMPLATES.length} board templates`,
  );
}
