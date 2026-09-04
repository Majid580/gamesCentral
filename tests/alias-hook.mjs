/**
 * Resolves the `@/…` TypeScript path alias for `node --test`.
 *
 * The app's source uses `@/lib/x`, which is a tsconfig `paths` entry. Next.js
 * and `tsc` both understand it; plain Node does not, and never will — path
 * mapping is a compiler feature, not a resolution one. Without this hook every
 * test that touches a module using the alias fails at import.
 *
 * Kept as `.mjs` rather than `.mts` deliberately: loader hooks run on their own
 * thread, ahead of the main thread's TypeScript stripping. Plain JavaScript
 * removes a moving part from the one file everything else depends on loading.
 */

/** Repo root — this file lives in `tests/`. */
const ROOT = new URL("../", import.meta.url);

/**
 * The alias is written without a file extension (`@/lib/env`), which Node's
 * ESM resolver rejects. Source files here are `.ts`, so append it unless the
 * specifier already carries an extension of its own.
 */
function withTsExtension(href) {
  return /\.[a-z]+$/i.test(href) ? href : `${href}.ts`;
}

export function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

  const target = new URL(specifier.slice(2), ROOT);
  return nextResolve(withTsExtension(target.href), context);
}
