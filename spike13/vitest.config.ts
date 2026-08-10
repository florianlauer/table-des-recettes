import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// `node_modules` is a symlink to the main checkout, so vitest resolves the workspace through the
// symlink's real path and would load the app config — which runs in `edge-runtime` (no `node:fs`)
// and only includes `src/**` and `convex/**`. Left unpinned, the bench's tests are collected as
// zero and the command still exits green.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    environment: "node",
    include: ["spike13/**/*.test.ts"],
  },
});
