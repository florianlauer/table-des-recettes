// Magazines punctuate their ingredient lists, so the OCR hands back `12 pêches nectarines,` and the
// storefront prints that comma. Only separators are stripped: `)`, `%`, `°` and digits carry meaning
// and stay, even at the edge of the line.
const EDGE_SEPARATORS = /^[\s,;:.!?·•‣▪◦*+–—-]+|[\s,;:.!?·•‣▪◦*+–—-]+$/g

export function trimIngredientLine(value: string): string {
  const trimmed = value.replace(EDGE_SEPARATORS, '')
  // A line made only of separators keeps its original text: dropping it would silently break the
  // one-entry-per-printed-line rule the extraction promises.
  return trimmed === '' ? value.trim() : trimmed
}
