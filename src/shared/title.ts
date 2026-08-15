// Magazines set titles in capitals, wrap them in guillemets and hang dashes off them. Only
// separators and quotes are stripped at the edges: `)`, `%` and digits carry meaning and stay,
// exactly as for an ingredient line.
const EDGE_NOISE =
  /^[\s,;:.!?…·•‣▪◦*+–—\-«»"'’]+|[\s,;:.!?…·•‣▪◦*+–—\-«»"'’]+$/g

const SHOUTING_RATIO = 0.8

function isShouted(value: string): boolean {
  // Code points and not graphemes, deliberately: half a split emoji has no case and drops out of
  // the filter, which is the only thing this function reads.
  // oxlint-disable-next-line typescript/no-misused-spread
  const cased = [...value].filter(
    (char) => char.toLowerCase() !== char.toUpperCase(),
  )
  if (cased.length < 2) return false
  const capitals = cased.filter((char) => char === char.toUpperCase())
  return capitals.length / cased.length >= SHOUTING_RATIO
}

/**
 * Restoring « NOIX DE SAINT-JACQUES A LA TAPENADE » to « Noix de Saint-Jacques à la tapenade »
 * needs accents the capitals destroyed and a proper noun recognised — the extraction prompt asks
 * the model for that. This pass is the net under it: whitespace, edge punctuation, and a sentence
 * case applied only when the model shouted anyway. Lost accents stay lost; review fixes them.
 */
export function cleanTitle(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  const stripped = collapsed.replace(EDGE_NOISE, '')
  // A title made only of punctuation keeps its text: `resolveSlug` already refuses to publish it,
  // and an empty field would hide from the operator what the model actually returned.
  if (stripped === '') return collapsed
  if (!isShouted(stripped)) return stripped
  return stripped
    .toLocaleLowerCase('fr-FR')
    .replace(/\p{L}/u, (char) => char.toLocaleUpperCase('fr-FR'))
}
