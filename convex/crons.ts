import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.cron(
  'purge expired photos',
  '0 4 * * 1',
  internal.retention.purgeExpired,
  {},
)
crons.cron(
  'sweep extraction tickets',
  '30 4 * * 1',
  internal.extract.sweepTickets,
  {},
)

export default crons
