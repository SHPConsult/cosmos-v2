-- Quote revisions share a number.
--
-- The customer keeps quoting "Q-2026-0042" across v1/v2/v3, so the number alone
-- cannot be unique — each revision is its own row with its own line items and
-- its own audit trail, and only (number, revision) together identify one.
--
-- Change orders stay unique by construction: their number is derived from the
-- parent estimate's ("Q-2026-0042-CO-001"), so two estimates can each carry a
-- CO-001 without colliding.
DROP INDEX IF EXISTS "quotes_org_id_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_org_id_number_revision_key"
  ON "quotes"("org_id", "number", "revision");
