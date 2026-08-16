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

/**
 * Renders integer paisa as the plain rupee amount a payment gateway expects,
 * e.g. 450000 -> "4500.00".
 *
 * Deliberately not `formatPkr`: that produces "Rs 4,500" for humans, and a
 * currency symbol or a thousands separator in an API amount field is either
 * rejected or, worse, silently parsed as a different number.
 *
 * Built by integer division rather than `paisa / 100` so no float ever touches
 * a monetary value (rule 5).
 */
export function paisaToAmountString(paisa: number): string {
  if (!Number.isInteger(paisa)) {
    throw new Error(
      `paisaToAmountString expects integer paisa, received ${paisa}. Money must never be a float.`,
    );
  }
  if (paisa < 0) {
    throw new Error(`paisaToAmountString expects a non-negative amount, received ${paisa}.`);
  }

  const rupees = Math.trunc(paisa / PAISA_PER_PKR);
  const remainder = paisa % PAISA_PER_PKR;
  return `${rupees}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Parses a gateway's rupee amount back to integer paisa, or null if it is not
 * a plain decimal number.
 *
 * Returning null rather than NaN or 0 is the point: this is used to compare
 * what a gateway says was charged against what we asked for, and a
 * silently-zero parse of an unexpected format would compare equal to nothing
 * and unequal to everything — either way an unreadable amount must never be
 * treated as a matching one.
 */
export function amountStringToPaisa(amount: string | number): number | null {
  const text = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;

  const [rupees, fraction = ""] = text.split(".");
  const paisa = fraction.padEnd(2, "0");
  return Number(rupees) * PAISA_PER_PKR + Number(paisa);
}
