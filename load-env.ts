import { config } from 'dotenv'

// `npx convex dev` owns `.env.local` and rewrites it, so the deployment URLs live there whether we
// like it or not. Reading both files in that order means a variable can sit in either one, and the
// Node scripts stop caring which — `dotenv/config` alone would only ever read `.env`.
config({ path: ['.env.local', '.env'], quiet: true })
