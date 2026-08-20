/**
 * Validates the two brand marks in public/brand/.
 *
 * The logo files are pasted in by hand, from whatever an design tool exported.
 * Four things go wrong every time, all of them invisible in a file listing:
 *
 *   1. no viewBox        the mark will not scale; it renders at its raw pixel
 *                        size or collapses entirely
 *   2. mismatched ratio  the light and dark files have different aspect
 *                        ratios, so the header changes width when the visitor
 *                        toggles the theme and the whole nav bar jumps
 *   3. baked background  the dark export keeps its navy rectangle, which then
 *                        reads as a navy box floating on the header
 *   4. embedded raster   an <image> element means the "SVG" is a traced JPG in
 *                        an SVG wrapper — it will be soft on retina screens
 *
 * Run:
 *   npm run brand:check
 *
 * Exits non-zero on 1 and 2, which are broken. 3 and 4 are reported as
 * warnings: they are judgement calls, and a baked background is survivable
 * because --dark-background is deliberately set close to the mark's own navy.
 *
 * Touches no network and no database. Reads two files.
 */

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BRAND_DIR = new URL("../public/brand/", import.meta.url);
const CSS_PATH = fileURLToPath(new URL("../app/globals.css", import.meta.url));

/** Height the header renders the mark at — `h-9` in components/brand/logo.tsx. */
const RENDERED_HEIGHT_PX = 36;

type Mark = {
  file: string;
  /** The canvas each mark is designed to sit on. */
  usedOn: "light" | "dark";
};

const MARKS: Mark[] = [
  { file: "logo-light.svg", usedOn: "light" },
  { file: "logo-dark.svg", usedOn: "dark" },
];

type Report = {
  file: string;
  usedOn: "light" | "dark";
  bytes: number;
  ratio: number | null;
  viewBox: string | null;
  bakedBackground: string | null;
  hasRaster: boolean;
  hasScript: boolean;
  isPlaceholder: boolean;
};

function inspect({ file, usedOn }: Mark): Report | null {
  const path = fileURLToPath(new URL(file, BRAND_DIR));

  let svg: string;
  try {
    svg = readFileSync(path, "utf8");
  } catch {
    console.error(`  MISSING  public/brand/${file}`);
    return null;
  }

  const viewBox = svg.match(/viewBox\s*=\s*["']([^"']+)["']/)?.[1] ?? null;

  let ratio: number | null = null;
  if (viewBox) {
    const [, , w, h] = viewBox.trim().split(/[\s,]+/).map(Number);
    if (Number.isFinite(w) && Number.isFinite(h) && h > 0) ratio = w / h;
  }

  /*
   * A background rectangle is one that starts at the origin and covers the
   * whole canvas. Matching on "rect with a fill, no x/y offset" catches the
   * common exports; anything cleverer (a <path> tracing the frame) is beyond
   * what a regex should attempt, which is why this is a warning and not a
   * gate.
   */
  let bakedBackground: string | null = null;
  for (const [tag] of svg.matchAll(/<rect\b[^>]*\/?>/g)) {
    const hasOffset = /\b(x|y)\s*=\s*["'](?!0["'])/.test(tag);
    const fill = tag.match(/\bfill\s*=\s*["']([^"']+)["']/)?.[1];
    const coversWidth = /\bwidth\s*=\s*["'](100%|\d{2,})["']/.test(tag);
    const coversHeight = /\bheight\s*=\s*["'](100%|\d{2,})["']/.test(tag);

    if (!hasOffset && coversWidth && coversHeight && fill && fill !== "none") {
      bakedBackground = fill;
      break;
    }
  }

  return {
    file,
    usedOn,
    bytes: statSync(path).size,
    ratio,
    viewBox,
    bakedBackground,
    hasRaster: /<image\b/.test(svg),
    hasScript: /<script\b/i.test(svg),
    isPlaceholder: svg.includes("PLACEHOLDER"),
  };
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

console.log("\nBrand marks — public/brand/\n");

const reports = MARKS.map(inspect);
const errors: string[] = [];
const warnings: string[] = [];

if (reports.some((r) => r === null)) {
  console.error(
    "\nPaste the owner's exports into public/brand/ using exactly the names\n" +
      "above, then run this again.\n",
  );
  process.exit(1);
}

const found = reports as Report[];

for (const r of found) {
  console.log(`  ${r.file}`);
  console.log(`    used on      ${r.usedOn} backgrounds`);
  console.log(`    size         ${(r.bytes / 1024).toFixed(1)} KB`);
  console.log(`    viewBox      ${r.viewBox ?? "— none —"}`);
  console.log(
    `    aspect       ${r.ratio ? `${r.ratio.toFixed(3)}  (renders ${Math.round(r.ratio * RENDERED_HEIGHT_PX)}x${RENDERED_HEIGHT_PX}px in the header)` : "— unknown —"}`,
  );
  if (r.bakedBackground) console.log(`    background   ${r.bakedBackground}  (baked in)`);
  console.log("");

  if (!r.viewBox) {
    errors.push(`${r.file} has no viewBox — it cannot scale. Re-export with one.`);
  }
  if (r.hasScript) {
    errors.push(`${r.file} contains a <script> element. Remove it before shipping.`);
  }
  if (r.hasRaster) {
    warnings.push(
      `${r.file} embeds a bitmap via <image> — this is a traced raster, not true vector, and will look soft on high-DPI screens.`,
    );
  }
  if (r.isPlaceholder) {
    warnings.push(`${r.file} is still the placeholder shipped with the palette work.`);
  }
}

// The ratio check is the one that produces a visible bug rather than a
// theoretical one: an unequal pair makes the header resize on every toggle.
const [light, dark] = found;
if (light.ratio && dark.ratio) {
  const drift = Math.abs(light.ratio - dark.ratio) / Math.max(light.ratio, dark.ratio);
  const widths = found.map((r) => Math.round((r.ratio ?? 0) * RENDERED_HEIGHT_PX));

  if (drift > 0.02) {
    errors.push(
      `aspect ratios differ by ${(drift * 100).toFixed(1)}% — the header would jump from ` +
        `${widths[0]}px to ${widths[1]}px wide when the theme is toggled. Re-export both ` +
        `marks on the same canvas, or trim the padding on the wider one.`,
    );
  } else {
    console.log(`  Aspect ratios agree within ${(drift * 100).toFixed(1)}% — no layout shift on toggle.\n`);
  }
}

// --dark-background is deliberately tuned to the dark mark's own field, so a
// baked-in rectangle sinks into the page instead of showing as a navy box.
if (dark.bakedBackground) {
  const canvas = readFileSync(CSS_PATH, "utf8")
    .match(/--dark-background:\s*(#[0-9a-fA-F]{3,8})\s*;/)?.[1]
    ?.toLowerCase();

  warnings.push(
    `${dark.file} has a baked-in ${dark.bakedBackground} background. Ideally re-export it ` +
      `transparent. If you cannot, set --dark-background in app/globals.css to ` +
      `${dark.bakedBackground} so the rectangle disappears into the page` +
      (canvas ? ` (it is currently ${canvas}).` : "."),
  );
}

if (light.bakedBackground) {
  warnings.push(
    `${light.file} has a baked-in ${light.bakedBackground} background, which will show as a ` +
      `solid block on the site's tinted canvas. Re-export it transparent.`,
  );
}

for (const w of warnings) console.log(`  warn   ${w}\n`);
for (const e of errors) console.error(`  FAIL   ${e}\n`);

if (errors.length) {
  console.error(`${errors.length} problem(s) would be visible on the site.\n`);
  process.exit(1);
}

console.log("Both marks are usable.\n");
