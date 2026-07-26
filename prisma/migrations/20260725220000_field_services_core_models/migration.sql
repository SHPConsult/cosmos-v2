-- Field-services Phase 1 — core domain models (ADR 0004, 0005).
-- Entirely additive: new tables, new nullable columns, no data migration.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "QuoteKind" AS ENUM ('ESTIMATE', 'CHANGE_ORDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Accounts ────────────────────────────────────────────────────────────────
-- The billing entity. Named crm_accounts (not accounts) because the ledger's
-- chart-of-accounts already owns `accounts`; mirrors crm_contacts.
CREATE TABLE IF NOT EXISTS "crm_accounts" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"             UUID NOT NULL,
  "name"               TEXT NOT NULL,
  "default_type"       TEXT,
  "billing_email"      TEXT,
  "billing_address"    TEXT,
  "payment_terms_days" INTEGER,
  "notes"              TEXT,
  "logo_url"           TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_accounts_org_id_idx" ON "crm_accounts"("org_id");

ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "account_id" UUID;
CREATE INDEX IF NOT EXISTS "crm_contacts_org_id_account_id_idx"
  ON "crm_contacts"("org_id", "account_id");

-- ── Sites ───────────────────────────────────────────────────────────────────
-- Org-scoped, NOT owned by a customer: the same lot survives a change of GC.
CREATE TABLE IF NOT EXISTS "sites" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     UUID NOT NULL,
  "account_id" UUID,
  "label"      TEXT,
  "address"    TEXT,
  "lat"        DOUBLE PRECISION,
  "lng"        DOUBLE PRECISION,
  "area_sqft"  DECIMAL(12,2),
  "aerial_ref" TEXT,
  "notes"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "sites_org_id_idx" ON "sites"("org_id");
CREATE INDEX IF NOT EXISTS "sites_org_id_account_id_idx" ON "sites"("org_id", "account_id");

-- ── Job detail ──────────────────────────────────────────────────────────────
-- 1:1 extension of work_items. Separate table so the other seven sectors carry
-- none of these columns.
CREATE TABLE IF NOT EXISTS "job_details" (
  "work_item_id" UUID PRIMARY KEY,
  "org_id"       UUID NOT NULL,
  "account_id"   UUID,
  "contact_id"   UUID,
  "site_id"      UUID,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "job_details_org_id_idx" ON "job_details"("org_id");
CREATE INDEX IF NOT EXISTS "job_details_org_id_account_id_idx" ON "job_details"("org_id", "account_id");
CREATE INDEX IF NOT EXISTS "job_details_org_id_site_id_idx" ON "job_details"("org_id", "site_id");

-- ── Quotes ──────────────────────────────────────────────────────────────────
-- One table for estimates AND change orders (`kind`); a change order points at
-- its estimate via parent_quote_id.
CREATE TABLE IF NOT EXISTS "quotes" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          UUID NOT NULL,
  "number"          TEXT NOT NULL,
  "kind"            "QuoteKind" NOT NULL DEFAULT 'ESTIMATE',
  "status"          "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "parent_quote_id" UUID,
  "revision"        INTEGER NOT NULL DEFAULT 1,
  "job_id"          UUID,
  "account_id"      UUID,
  "contact_id"      UUID,
  "title"           TEXT,
  "currency"        TEXT NOT NULL DEFAULT 'USD',
  "subtotal"        DECIMAL(19,4) NOT NULL DEFAULT 0,
  "tax_total"       DECIMAL(19,4) NOT NULL DEFAULT 0,
  "total"           DECIMAL(19,4) NOT NULL DEFAULT 0,
  "issued_at"       TIMESTAMP(3),
  "decided_at"      TIMESTAMP(3),
  "decline_reason"  TEXT,
  "terms"           TEXT,
  "notes"           TEXT,
  "created_by_id"   UUID NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_org_id_number_key" ON "quotes"("org_id", "number");
CREATE INDEX IF NOT EXISTS "quotes_org_id_status_idx" ON "quotes"("org_id", "status");
CREATE INDEX IF NOT EXISTS "quotes_org_id_job_id_idx" ON "quotes"("org_id", "job_id");
CREATE INDEX IF NOT EXISTS "quotes_parent_quote_id_idx" ON "quotes"("parent_quote_id");

CREATE TABLE IF NOT EXISTS "quote_line_items" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_id"     UUID NOT NULL,
  "description"  TEXT NOT NULL,
  "service_type" TEXT,
  "quantity"     DECIMAL(19,4) NOT NULL DEFAULT 1,
  "unit"         TEXT,
  "unit_price"   DECIMAL(19,4) NOT NULL,
  "tax_rate"     DECIMAL(9,6) NOT NULL DEFAULT 0,
  "amount"       DECIMAL(19,4) NOT NULL,
  "product_id"   UUID,
  "sort_order"   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "quote_line_items_quote_id_idx" ON "quote_line_items"("quote_id");

-- ── Invoice linkage ─────────────────────────────────────────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "account_id" UUID;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "job_id" UUID;
CREATE INDEX IF NOT EXISTS "invoices_org_id_job_id_idx" ON "invoices"("org_id", "job_id");

-- THE idempotency guarantee for the Completed -> draft-invoice transition hook:
-- at most one live invoice per Job. A voided invoice is excluded so a Job can be
-- re-invoiced after a void. Partial indexes cannot be expressed in the Prisma
-- schema, so this lives only here — do not "reconcile" it away.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_job_id_live_key"
  ON "invoices"("job_id") WHERE "job_id" IS NOT NULL AND "status" <> 'VOID';

-- ── Foreign keys ────────────────────────────────────────────────────────────
-- SET NULL on customer records so deleting an Account never destroys billing
-- history; CASCADE from work_items so a deleted Job takes its detail row.
ALTER TABLE "crm_contacts"     DROP CONSTRAINT IF EXISTS "crm_contacts_account_id_fkey";
ALTER TABLE "crm_contacts"     ADD CONSTRAINT "crm_contacts_account_id_fkey"     FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sites"            DROP CONSTRAINT IF EXISTS "sites_account_id_fkey";
ALTER TABLE "sites"            ADD CONSTRAINT "sites_account_id_fkey"            FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_details"      DROP CONSTRAINT IF EXISTS "job_details_work_item_id_fkey";
ALTER TABLE "job_details"      ADD CONSTRAINT "job_details_work_item_id_fkey"    FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_details"      DROP CONSTRAINT IF EXISTS "job_details_account_id_fkey";
ALTER TABLE "job_details"      ADD CONSTRAINT "job_details_account_id_fkey"      FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_details"      DROP CONSTRAINT IF EXISTS "job_details_contact_id_fkey";
ALTER TABLE "job_details"      ADD CONSTRAINT "job_details_contact_id_fkey"      FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_details"      DROP CONSTRAINT IF EXISTS "job_details_site_id_fkey";
ALTER TABLE "job_details"      ADD CONSTRAINT "job_details_site_id_fkey"         FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes"           DROP CONSTRAINT IF EXISTS "quotes_parent_quote_id_fkey";
ALTER TABLE "quotes"           ADD CONSTRAINT "quotes_parent_quote_id_fkey"      FOREIGN KEY ("parent_quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes"           DROP CONSTRAINT IF EXISTS "quotes_job_id_fkey";
ALTER TABLE "quotes"           ADD CONSTRAINT "quotes_job_id_fkey"               FOREIGN KEY ("job_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes"           DROP CONSTRAINT IF EXISTS "quotes_account_id_fkey";
ALTER TABLE "quotes"           ADD CONSTRAINT "quotes_account_id_fkey"           FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes"           DROP CONSTRAINT IF EXISTS "quotes_contact_id_fkey";
ALTER TABLE "quotes"           ADD CONSTRAINT "quotes_contact_id_fkey"           FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_line_items" DROP CONSTRAINT IF EXISTS "quote_line_items_quote_id_fkey";
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_fkey"   FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices"         DROP CONSTRAINT IF EXISTS "invoices_account_id_fkey";
ALTER TABLE "invoices"         ADD CONSTRAINT "invoices_account_id_fkey"         FOREIGN KEY ("account_id") REFERENCES "crm_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices"         DROP CONSTRAINT IF EXISTS "invoices_job_id_fkey";
ALTER TABLE "invoices"         ADD CONSTRAINT "invoices_job_id_fkey"             FOREIGN KEY ("job_id") REFERENCES "work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
