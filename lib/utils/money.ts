/**
 * Money handling.
 *
 * All monetary values in this codebase are **integer paisa** (1 PKR = 100
 * paisa). Floats are never used for money — binary floating point cannot
 * represent 0.1 exactly, and the rounding drift compounds across a markup
 * calculation and a currency conversion (Section 12.13).
 *
 * The rule: compute in paisa, store in paisa, format only at the edge.
 */

/** Smallest currency unit per rupee. */
export const PAISA_PER_PKR = 100;

/**
 * Formats integer paisa as a display string, e.g. 125000 -> "Rs 1,250".
 *
 * Whole rupees are shown without decimals because top-up prices are always
 * round; a non-zero paisa remainder still renders correctly rather than being
 * silently dropped.
 */
export function formatPkr(paisa: number): string {
  if (!Number.isInteger(paisa)) {
    throw new Error(
      `formatPkr expects integer paisa, received ${paisa}. Money must never be a float.`,
    );
  }

  const rupees = paisa / PAISA_PER_PKR;
  const hasFraction = paisa % PAISA_PER_PKR !== 0;

  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(rupees);
}

/** Converts a whole-rupee amount to integer paisa. */
export function pkrToPaisa(rupees: number): number {
  return Math.round(rupees * PAISA_PER_PKR);
}
