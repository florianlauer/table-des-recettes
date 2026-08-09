import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// This worktree has no config of its own and its `node_modules` is a symlink, so vitest resolves the
// workspace through the symlink's real path and loads the main repo's config — whose `include` covers
// only `src/**` and `convex/**`. The spike's tests were collected as zero while `npm run verify` still
// exited green. Pinning the config here is what makes the suite actually run.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["spike/**/*.test.ts", "src/**/*.test.ts"],
  },
});
