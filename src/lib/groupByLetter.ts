import { normalizeText } from './normalize'

export type LetterGroup<T> = { letter: string; items: T[] }

export function initialLetter(title: string): string {
  const first = normalizeText(title).charAt(0)
  return /[a-z]/.test(first) ? first.toUpperCase() : '#'
}

export function groupByLetter<T extends { title: string }>(
  items: readonly T[],
): LetterGroup<T>[] {
  const sorted = [...items].sort((a, b) =>
    normalizeText(a.title).localeCompare(normalizeText(b.title), 'fr'),
  )
  const groups: LetterGroup<T>[] = []
  for (const item of sorted) {
    const letter = initialLetter(item.title)
    const last = groups[groups.length - 1]
    if (last && last.letter === letter) last.items.push(item)
    else groups.push({ letter, items: [item] })
  }
  return groups
}
