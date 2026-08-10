import { normalizeText } from './normalize'

export function slugify(title: string): string {
  return normalizeText(title).replace(/ /g, '-')
}

export function resolveSlugCollision(
  base: string,
  existing: readonly string[],
): string {
  if (!existing.includes(base)) return base
  let suffix = 2
  while (existing.includes(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
