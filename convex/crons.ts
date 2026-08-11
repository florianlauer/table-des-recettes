import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.cron(
  'purge des photos expirées',
  '0 4 * * 1',
  internal.retention.purgeExpired,
  {},
)
crons.cron(
  'balayage des tickets',
  '30 4 * * 1',
  internal.extract.sweepTickets,
  {},
)

export default crons
