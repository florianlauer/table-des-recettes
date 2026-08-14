import aggregate from '@convex-dev/aggregate/convex.config'
import migrations from '@convex-dev/migrations/convex.config'
import rateLimiter from '@convex-dev/rate-limiter/convex.config'
import workpool from '@convex-dev/workpool/convex.config'
import { defineApp } from 'convex/server'

const app = defineApp()
app.use(rateLimiter)
app.use(migrations)
// Named, because a pool is a queue with one parallelism setting: image derivation and any future
// async workload must not share a budget.
app.use(workpool, { name: 'renditionWorkpool' })
// Named for the same reason an aggregate is renamed rather than repaired: `app.use(aggregate, { name })`
// under a new name is the documented way to reset one to empty.
app.use(aggregate, { name: 'publishedRecipes' })

export default app
