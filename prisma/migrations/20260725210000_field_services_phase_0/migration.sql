-- Field-services Phase 0 (ADR 0004). Two additive changes, no data migration.

-- 1. System-owned board columns.
--
-- A Job's status IS its board column key, so a sector's automation and reporting
-- read those keys as a contract (field-services: a Job entering `completed`
-- mints a draft invoice). `locked` marks a column the board editor may not
-- rename, re-key or delete — enforced server-side in the columns PUT.
--
-- Default false, so every existing board on every deployment is unaffected.
ALTER TABLE "board_columns"
  ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT false;

-- 2. SEASON interval kind.
--
-- A trade contractor plans in seasons (paving, snow) the way software plans in
-- sprints. Additive; ADD VALUE is non-destructive and IF NOT EXISTS keeps this
-- re-runnable. The value is not referenced elsewhere in this migration, so it is
-- safe inside the transaction Prisma wraps around it.
ALTER TYPE "IntervalKind" ADD VALUE IF NOT EXISTS 'SEASON';
