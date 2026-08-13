import type { GestureResult } from './gestures'

/**
 * A gesture answers `{ ok, text }` and the screen printed only `text` — so "Photo publiée." and
 * "Aucun candidat à publier." arrived in the same ink, at the same size, with nothing between them.
 * On the arbitration screen an operator chains up to seven gestures on one row; they could not tell
 * at a glance whether the last one landed.
 *
 * The glyph carries the meaning and the weight only doubles it — the same reasoning as the dagger on
 * a recipe, and the reason this is not a red pill: `DESIGN.md` § Anti-slop bans any colour that does
 * not carry information, and a colour alone would carry all of it.
 */
export function gestureNoteMark(result: GestureResult): string {
  return result.ok ? '✓' : '✗'
}

/** Read in place of the glyph, which is decorative once the word is there. */
export function gestureNoteReading(result: GestureResult): string {
  return result.ok ? 'Succès :' : 'Échec :'
}
