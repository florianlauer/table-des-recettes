/**
 * A scan's name in the list. It used to be its `status`: the word "done" was the link's own label,
 * which named a state where a target should be. A repertory points at the entry, not at its state.
 */
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/** Local time, and spelled out rather than left to `Intl` so the wording cannot drift with a runtime. */
export function formatScanLabel(createdAt: number): string {
  const date = new Date(createdAt)
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `Scan du ${date.getDate()} ${MONTHS[date.getMonth()]} à ${date.getHours()} h ${minutes}`
}

const SCAN_STATUS_LABELS: Record<string, string> = {
  pending: 'en attente',
  extracting: 'en cours',
  done: 'terminé',
  failed: 'en échec',
}

/** The state stays on the line, as data. It is simply no longer what the link is called. */
export function scanStatusLabel(status: string): string {
  return SCAN_STATUS_LABELS[status] ?? status
}
