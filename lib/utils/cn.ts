/**
 * Minimal class-name joiner.
 *
 * Deliberately not `clsx` + `tailwind-merge`: this is ~10 lines and Section
 * 12.15 says not to add a package for something that small. If genuine
 * conflicting-class merging becomes necessary, revisit then.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
