/**
 * Pakistani mobile number normalisation.
 *
 * Exists for one job: guest order lookup. A customer types their number at
 * checkout as `0322 4810876` and, days later, types it into the tracking form
 * as `+923224810876`. Both are the same number and neither is wrong, but an
 * exact string comparison says they are different people — which means the
 * customer cannot see their own order and contacts support instead. That is
 * the manual workflow this site exists to replace.
 *
 * So the number is stored twice: as the customer typed it, for anyone reading
 * the order, and normalised, for matching. Normalising at write time rather
 * than query time is deliberate — a query cannot normalise a stored value
 * without an aggregation, and an index cannot help it if it could.
 *
 * Free of `server-only` so the same rule can be applied in a form later; it
 * reads no environment and no database.
 */

/**
 * Reduces a Pakistani mobile number to `92XXXXXXXXXX`.
 *
 * Handles the four spellings people actually use — `03224810876`,
 * `+92 322 4810876`, `92-322-4810876`, `3224810876` — and returns null for
 * anything it cannot confidently place. Null means "do not match on this",
 * never "match everything": a normaliser that guesses would let one customer's
 * lookup return another customer's order.
 */
export function normalisePkPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // Pakistani mobiles are 3XXXXXXXXX — ten digits beginning with 3.
  let national: string;

  if (digits.startsWith("92") && digits.length === 12) {
    national = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 11) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else if (digits.startsWith("0092") && digits.length === 14) {
    national = digits.slice(4);
  } else {
    return null;
  }

  if (!/^3\d{9}$/.test(national)) return null;

  return `92${national}`;
}
