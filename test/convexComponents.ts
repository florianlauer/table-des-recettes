import aggregateTest from '@convex-dev/aggregate/test'
import migrationsTest from '@convex-dev/migrations/test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import workpoolTest from '@convex-dev/workpool/test'
import type { convexTest } from 'convex-test'

/**
 * Every component `convex.config.ts` mounts, registered on a test instance.
 *
 * One list rather than the same four lines in eleven harnesses: `convex-test` throws
 * `Component "x" is not registered` the moment any code path reaches an unregistered component, so
 * adding a component otherwise means hunting down every `convexTest()` call in the suite. The named
 * mounts must match `app.use(…, { name })` exactly.
 *
 * This file lives outside `convex/` on purpose: it imports the components' test entry points, which
 * pull in `convex-test`, and anything under `convex/` that is not a `.test.ts` gets bundled and
 * pushed by `convex deploy`.
 */
export function registerComponents(t: ReturnType<typeof convexTest>): void {
  rateLimiterTest.register(t)
  migrationsTest.register(t)
  workpoolTest.register(t, 'renditionWorkpool')
  aggregateTest.register(t, 'publishedRecipes')
}
