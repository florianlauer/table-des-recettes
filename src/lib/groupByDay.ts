/**
 * Batch separators for the work screen, calqué sur `groupByLetter` — same shape, one difference that
 * matters: **no sort**. The index already returns rows in the display order (most recently touched
 * first), and re-sorting here would silently disagree with the truncation the server reported.
 */

export type DayGroup<T> = { key: string; label: string; items: T[] }

/**
 * Paris, in hard code, never the viewer's zone. `illustrationUpdatedAt` is UTC ms and this runs on
 * both sides of an SSR boundary: on Vercel (UTC) and in the browser (Paris) a row created at 23:30
 * UTC would land on two different days, which is a hydration mismatch.
 */
const ZONE = 'Europe/Paris'

const DAY_KEY = new Intl.DateTimeFormat('fr-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const SAME_YEAR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ZONE,
  day: 'numeric',
  month: 'long',
})
const OTHER_YEAR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const YEAR = new Intl.DateTimeFormat('fr-CA', {
  timeZone: ZONE,
  year: 'numeric',
})

/** `fr-CA` gives an ISO-shaped date, so the key sorts and compares as a string. */
export function dayKey(at: number): string {
  return DAY_KEY.format(at)
}

/** The year is dropped when it is the current one: it is noise on every line of a working week. */
export function dayLabel(at: number, now: number): string {
  const formatter =
    YEAR.format(at) === YEAR.format(now) ? SAME_YEAR : OTHER_YEAR
  return formatter.format(at)
}

export function groupByDay<T extends { updatedAt: number }>(
  items: readonly T[],
  now: number,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const item of items) {
    const key = dayKey(item.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else
      groups.push({ key, label: dayLabel(item.updatedAt, now), items: [item] })
  }
  return groups
}
