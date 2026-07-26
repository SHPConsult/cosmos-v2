/**
 * Document numbering — shared by invoices and quotes.
 *
 * The naive implementation is `count(rows with prefix) + 1`, and it is WRONG the
 * moment the sequence has a gap: void an invoice and delete it, or hand-key
 * historical numbers at cutover, and the count no longer equals the highest
 * number. The next mint then collides with a number already in use, which the
 * unique constraint catches as a failed document creation rather than anything
 * legible.
 *
 * Taking max(suffix) + 1 is correct under gaps, is stable under deletion, and
 * never reissues a number a customer has already seen — which matters, because
 * these numbers are quoted back by accountants.
 */

/** Highest numeric suffix among `existing` sharing `prefix`, plus one. */
export function nextSequenceNumber(
  existing: readonly string[],
  prefix: string,
): number {
  let max = 0;
  for (const n of existing) {
    if (!n.startsWith(prefix)) continue;
    const suffix = n.slice(prefix.length);
    // Only a pure-digit tail is a sequence. This deliberately ignores compound
    // numbers like "Q-2026-0042-CO-001" when minting "Q-2026-" quotes.
    if (!/^\d+$/.test(suffix)) continue;
    const v = Number(suffix);
    if (Number.isSafeInteger(v) && v > max) max = v;
  }
  return max + 1;
}

/**
 * Render a sequence as `<prefix><zero-padded seq>`. Padding is a MINIMUM: a
 * sequence that outgrows it widens rather than truncating, so 10000 renders as
 * "10000" and never silently becomes "0000".
 */
export function formatSequence(prefix: string, seq: number, pad = 4): string {
  return `${prefix}${String(seq).padStart(pad, "0")}`;
}

/** `INV-2026-` — the per-org, per-year invoice prefix. */
export function invoicePrefix(year: number): string {
  return `INV-${year}-`;
}

/** `Q-2026-` — the per-org, per-year quote prefix. Estimates only. */
export function quotePrefix(year: number): string {
  return `Q-${year}-`;
}

/**
 * A change order's number is derived from its parent estimate —
 * `Q-2026-0042-CO-001` — so it is unique org-wide by construction while still
 * being sequential *per estimate*, which is how the trade refers to them
 * ("CO-001 on the Costco job"). Surfaces render the short form.
 */
export function changeOrderPrefix(parentNumber: string): string {
  return `${parentNumber}-CO-`;
}

/** The short display form of a change-order number: "Q-2026-0042-CO-001" → "CO-001". */
export function shortChangeOrderNumber(number: string): string {
  const i = number.lastIndexOf("-CO-");
  return i === -1 ? number : number.slice(i + 1);
}
