/**
 * Measures every foreground/surface pair in the palette against WCAG AA.
 *
 * The palette is derived from the brand marks, and "derived from a logo" is
 * exactly the kind of constraint that quietly produces unreadable text: the
 * logo's azure is #1ca9e8, which measures 2.66:1 on white. Picking colours by
 * eye and checking them later means shipping the failure. This checks them
 * first, and the numbers in the globals.css comments come from this script.
 *
 * Run:
 *   npm run design:contrast
 *
 * Exits non-zero if any pair drops below its floor, so it can gate a deploy.
 *
 * Parses app/globals.css rather than restating the values. A copy of the
 * palette here would drift from the real one within a week, and a contrast
 * check that measures the wrong colours is worse than no check at all.
 *
 * Touches no network and no database.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS_PATH = fileURLToPath(new URL("../app/globals.css", import.meta.url));

/* ------------------------------------------------------------------ */
/* WCAG 2.1 relative luminance                                         */
/* ------------------------------------------------------------------ */

function channels(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Flattens `color-mix(in oklab, C 14%, transparent)` sitting on `over`.
 *
 * Approximated in sRGB rather than oklab. The result is only ever used to ask
 * "does the stop still clear 4.5:1 on its own tint chip", and sRGB mixing is
 * the more pessimistic of the two here — it cannot report a pass that oklab
 * would fail.
 */
function tint(colour: string, over: string, alpha = 0.14): string {
  const c = channels(colour);
  const o = channels(over);
  const mixed = c.map((v, i) => Math.round((v * alpha + o[i] * (1 - alpha)) * 255));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------------------------------------------ */
/* Read the palette out of globals.css                                 */
/* ------------------------------------------------------------------ */

const css = readFileSync(CSS_PATH, "utf8");

/**
 * Every `--name: #hex;` in the file. Light tokens are declared bare and dark
 * ones are declared as `--dark-*`, so one pass collects both themes; the
 * indirection blocks that map --dark-x onto --x hold `var(...)`, not hex, and
 * are skipped by the pattern.
 */
const declared = new Map<string, string>();
for (const [, name, value] of css.matchAll(
  /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g,
)) {
  declared.set(name, value.toLowerCase());
}

function token(name: string): string {
  const value = declared.get(name);
  if (!value) {
    console.error(`\n  Missing token --${name} in app/globals.css.`);
    process.exit(1);
  }
  return value;
}

type Theme = "light" | "dark";

/** Light tokens are bare; dark ones carry the --dark- prefix. */
const t = (theme: Theme, name: string) =>
  token(theme === "dark" ? `dark-${name}` : name);

/* ------------------------------------------------------------------ */
/* The pairs that actually appear on screen                            */
/* ------------------------------------------------------------------ */

type Check = {
  label: string;
  fg: string;
  bg: string;
  /** 4.5 for body text, 3.0 for large text, UI borders and focus rings. */
  floor: number;
};

function checksFor(theme: Theme): Check[] {
  const c = (name: string) => t(theme, name);

  const bg = c("background");
  const card = c("card");
  const muted = c("muted");

  const checks: Check[] = [
    // Body copy on every surface it can land on.
    { label: "foreground on background", fg: c("foreground"), bg, floor: 4.5 },
    { label: "foreground on card", fg: c("card-foreground"), bg: card, floor: 4.5 },
    { label: "foreground on muted", fg: c("foreground"), bg: muted, floor: 4.5 },

    // Secondary copy. The tightest of the three is nearly always on muted.
    { label: "muted-foreground on background", fg: c("muted-foreground"), bg, floor: 4.5 },
    { label: "muted-foreground on card", fg: c("muted-foreground"), bg: card, floor: 4.5 },
    { label: "muted-foreground on muted", fg: c("muted-foreground"), bg: muted, floor: 4.5 },

    // Filled buttons and badges: the label sitting on its own fill.
    { label: "primary-foreground on primary", fg: c("primary-foreground"), bg: c("primary"), floor: 4.5 },
    { label: "accent-foreground on accent", fg: c("accent-foreground"), bg: c("accent"), floor: 4.5 },
    { label: "highlight-foreground on highlight", fg: c("highlight-foreground"), bg: c("highlight"), floor: 4.5 },
    { label: "destructive-foreground on destructive", fg: c("destructive-foreground"), bg: c("destructive"), floor: 4.5 },

    // Soft badges: components/admin/status-pill.tsx and product-card.tsx put
    // the colour ON its own soft surface, which is far tighter than on a card.
    { label: "primary on primary-soft", fg: c("primary"), bg: c("primary-soft"), floor: 4.5 },
    { label: "accent on accent-soft", fg: c("accent"), bg: c("accent-soft"), floor: 4.5 },

    // Links and inline emphasis.
    { label: "primary as text on background", fg: c("primary"), bg, floor: 4.5 },
    { label: "primary as text on card", fg: c("primary"), bg: card, floor: 4.5 },
    { label: "accent as text on card", fg: c("accent"), bg: card, floor: 4.5 },

    // Focus ring — a UI component boundary, so 3:1 (WCAG 1.4.11).
    { label: "ring on background", fg: c("ring"), bg, floor: 3 },
    { label: "ring on card", fg: c("ring"), bg: card, floor: 3 },
  ];

  // The dispersion stops run as text (eyebrows, step numbers) on a card, on
  // the page, and on a 14% chip of themselves — that chip is the tight one.
  for (const n of [1, 2, 3, 4]) {
    const stop = c(`spectrum-${n}`);
    checks.push(
      { label: `spectrum-${n} on background`, fg: stop, bg, floor: 4.5 },
      { label: `spectrum-${n} on card`, fg: stop, bg: card, floor: 4.5 },
      { label: `spectrum-${n} on its own 14% chip (page)`, fg: stop, bg: tint(stop, bg), floor: 4.5 },
      { label: `spectrum-${n} on its own 14% chip (card)`, fg: stop, bg: tint(stop, card), floor: 4.5 },
    );
  }

  return checks;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

console.log("\nContrast audit — app/globals.css\n");

let failures = 0;

for (const theme of ["light", "dark"] as const) {
  console.log(`=== ${theme} ===`);

  for (const { label, fg, bg, floor } of checksFor(theme)) {
    const value = contrast(fg, bg);
    const pass = value >= floor;
    if (!pass) failures += 1;

    const mark = pass ? "  ok " : "FAIL ";
    const ratio = value.toFixed(2).padStart(6);
    console.log(`  ${mark} ${ratio}:1  (min ${floor})  ${label}   ${fg} on ${bg}`);
  }

  console.log("");
}

// The two marks in public/brand/ must be legible on the canvas each is used
// on. This is the whole reason --primary is not the logo's own azure.
console.log("=== brand literals (reference — not a gate) ===");
console.log(
  `   ${contrast(token("brand-azure"), token("card")).toFixed(2)}:1  --brand-azure on a light card` +
    `  (why --primary is a darkened form of it)`,
);
console.log(
  `   ${contrast(token("brand-azure"), token("dark-background")).toFixed(2)}:1  --brand-azure on the dark canvas\n`,
);

if (failures > 0) {
  console.error(`${failures} pair(s) below the WCAG AA floor. Palette not shippable.\n`);
  process.exit(1);
}

console.log("All pairs clear WCAG AA in both themes.\n");
