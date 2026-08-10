import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The repository root config is the application's: `environment: "edge-runtime"` and an `include`
// covering only `src/**` and `convex/**`. Left to resolve on its own, vitest loaded it and collected
// zero spike test files while `npm run verify` still exited green. The spike therefore pins its own
// config, in Node's default environment.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["spike/**/*.test.ts"],
  },
});
