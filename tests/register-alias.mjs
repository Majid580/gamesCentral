/**
 * Entry point for `--import`, registering the alias hook above.
 *
 * Split from the hook itself because `module.register` loads its argument into
 * a separate loader thread; a file cannot cleanly register itself.
 */

import { register } from "node:module";

register("./alias-hook.mjs", import.meta.url);
