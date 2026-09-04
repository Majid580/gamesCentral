/**
 * Money handling — non-negotiable rule 5: integer paisa, never floats.
 *
 * Two of these functions sit directly on the payment path.
 * `paisaToAmountString` writes the amount we ask PayFast to charge, and
 * `amountStringToPaisa` reads back what PayFast says it charged; the equality
 * between those two numbers is the whole of the amount check in
 * `verify-payment.ts`. A parser that returns 0 for an unreadable amount, or a
 * formatter that emits "4,500.00", turns that check into a coin toss.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  PAISA_PER_PKR,
  amountStringToPaisa,
  formatPkr,
  paisaToAmountString,
  pkrToPaisa,
} from "../lib/utils/money.ts";

/**
 * `Intl` separates the currency symbol from the number with U+00A0, and which
 * whitespace ICU picks is a detail of the platform's ICU build rather than a
 * promise this codebase makes. The digits and the grouping are what matter,
 * so they are compared against a normalised string.
 */
function normalise(formatted: string): string {
  return formatted.replace(/ /g, " ");
}

test("a float can never reach a price display", () => {
  /*
   * The guard that gives rule 5 teeth. Without it a value that drifted to
   * 379.99999999999994 somewhere upstream renders as "Rs 380" and nobody ever
   * learns the arithmetic was wrong.
   */
  for (const notPaisa of [380.5, 0.1, -0.5, 1e-9, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => formatPkr(notPaisa), /integer paisa/);
    assert.throws(() => paisaToAmountString(notPaisa), /integer paisa/);
  }
});

test("paisa render as rupees, with decimals only when there are any", () => {
  assert.equal(normalise(formatPkr(0)), "Rs 0");
  assert.equal(normalise(formatPkr(38_000)), "Rs 380");
  assert.equal(normalise(formatPkr(125_000)), "Rs 1,250");
  assert.equal(normalise(formatPkr(3_770_000)), "Rs 37,700");

  // A remainder is shown rather than silently dropped.
  assert.equal(normalise(formatPkr(125_050)), "Rs 1,250.50");
  assert.equal(normalise(formatPkr(1)), "Rs 0.01");
});

test("the gateway amount carries no symbol and no thousands separator", () => {
  /*
   * The reason this is not `formatPkr`. "Rs 4,500" in an API amount field is
   * either rejected outright or, far worse, parsed as 4 — and a gateway that
   * charges 4 rupees for a 4,500 rupee order is a loss we discover from the
   * customer.
   */
  assert.equal(paisaToAmountString(450_000), "4500.00");
  assert.equal(paisaToAmountString(0), "0.00");
  assert.equal(paisaToAmountString(1), "0.01");
  assert.equal(paisaToAmountString(99), "0.99");
  assert.equal(paisaToAmountString(100), "1.00");
  assert.equal(paisaToAmountString(3_770_000), "37700.00");

  for (const amount of [450_000, 0, 1, 3_770_000]) {
    assert.doesNotMatch(paisaToAmountString(amount), /[,\s]/);
  }
});

test("a negative amount is refused rather than sent to a gateway", () => {
  assert.throws(() => paisaToAmountString(-1), /non-negative/);
});

test("what we send and what we read back are the same number", () => {
  /*
   * The round trip is the actual invariant behind the amount check. Every
   * price shape in the catalogue is exercised, plus the awkward boundaries: a
   * sub-rupee remainder, and a value beyond anything the shop sells.
   */
  const amounts = [
    0, 1, 9, 10, 99, 100, 101,
    25_000, 38_000, 76_000, 110_000, 115_000, 125_000, 3_770_000,
    99_999_999,
  ];

  for (const paisa of amounts) {
    assert.equal(
      amountStringToPaisa(paisaToAmountString(paisa)),
      paisa,
      `${paisa} paisa did not survive the round trip`,
    );
  }
});

test("an unreadable amount is null, never zero", () => {
  /*
   * The distinction rule 2 rests on. `verify-payment` compares the parsed
   * amount against the order's price; a parser that answered 0 for garbage
   * would compare equal to a zero-priced order and unequal to everything else,
   * and either outcome is a decision made on a value nobody could read.
   *
   * The last entry is Arabic-Indic digits: `\d` is ASCII-only, and reading
   * those as a Western-digit amount would be a guess about someone else's
   * numerals.
   */
  const unreadable = [
    "", " ", "abc", "Rs 4500", "4,500.00", "4500.000", "4500.", ".50",
    "-100.00", "+100.00", "1e3", "0x64", "4500 PKR", "NaN", "Infinity",
    "٤٥٠٠",
  ];

  for (const amount of unreadable) {
    assert.equal(
      amountStringToPaisa(amount),
      null,
      `${JSON.stringify(amount)} is not a plain decimal and must parse to null`,
    );
  }
});

test("a gateway amount is read at full precision", () => {
  assert.equal(amountStringToPaisa("4500"), 450_000);
  assert.equal(amountStringToPaisa("4500.0"), 450_000);
  assert.equal(amountStringToPaisa("4500.00"), 450_000);
  assert.equal(amountStringToPaisa("4500.5"), 450_050);
  assert.equal(amountStringToPaisa("4500.05"), 450_005);
  assert.equal(amountStringToPaisa("0"), 0);

  /*
   * Surrounding whitespace is trimmed rather than treated as a different
   * amount — a trailing newline included, which is what a value read from a
   * log line or a header actually looks like.
   */
  assert.equal(amountStringToPaisa("  4500.00  "), 450_000);
  assert.equal(amountStringToPaisa("4500.00\n"), 450_000);

  // Numbers are accepted as well as strings — a JSON body may carry either.
  assert.equal(amountStringToPaisa(4500), 450_000);
});

test("one paisa apart never compares equal", () => {
  /*
   * The amount check is an exact `!==`, so this is what stands between us and
   * a tampered amount. Stated as a test because a future "tolerance" — for
   * gateway rounding, say — would be a one-line change that silently accepts
   * short payments.
   */
  const asked = 450_000;
  assert.notEqual(amountStringToPaisa(paisaToAmountString(asked - 1)), asked);
  assert.notEqual(amountStringToPaisa(paisaToAmountString(asked + 1)), asked);
});

test("whole rupees convert to paisa without drift", () => {
  assert.equal(PAISA_PER_PKR, 100);
  assert.equal(pkrToPaisa(380), 38_000);
  assert.equal(pkrToPaisa(1_250), 125_000);
  assert.equal(pkrToPaisa(37_700), 3_770_000);

  // Every result is an integer, which is what the models will accept.
  for (const rupees of [0, 1, 250, 380, 1_150, 2_300, 37_700]) {
    assert.ok(Number.isInteger(pkrToPaisa(rupees)));
  }
});
