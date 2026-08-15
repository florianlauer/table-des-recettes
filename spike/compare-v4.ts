import { extractionSchemaV2 } from '../src/shared/recipe-schema.js'
import { normalizeText, stemToken } from '../src/shared/normalize.js'
import {
  diffLines,
  INFERRED_PAGES,
  normalizeProse,
  PAGE_E_EXPECTED_INGREDIENTS,
  normalizeTypography,
  runComparator,
} from './compare-runs.js'
import type { Comparison } from './compare-runs.js'

/**
 * v4 changes exactly one thing against v3: what a reconstituted ingredient list may not contain.
 * The five pages that print a list are therefore held to strict identity — any movement there is a
 * regression, not an improvement — while E and G, the two pages that print none, are judged against
 * the three rules v4 adds rather than against v3's output, which is the output being corrected.
 */

const DURATION =
  /\b\d+([.,]\d+)?\s*(mn|min|minutes?|h|heures?|secondes?|jours?|nuits?)\b/i
const TEMPERATURE = /\d\s*°|thermostat|\bth\.?\s*\d/i

// A part of something else. `jus` and `zeste` are here for the same reason as `jaune`: a shopping
// list that carries both the fruit and its juice buys the fruit twice.
const PART_WORDS = new Set([
  'jaune',
  'blanc',
  'zeste',
  'ecorce',
  'jus',
  'peau',
  'moitie',
  'coque',
])
const ARTICLES = new Set([
  'd',
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'a',
  'au',
  'aux',
])

function tokens(line: string): string[] {
  return normalizeText(line).split(' ').filter(Boolean).map(stemToken)
}

/** What a line names, once its grammar and its quantity are dropped. */
function nouns(words: readonly string[]): string[] {
  return words.filter((word) => !ARTICLES.has(word) && !/^\d+$/.test(word))
}

/**
 * A parenthetical lists what is inside a product, not the product: the `(citrons, kumquats)` of
 * `tranches d'agrumes confits` is not a lemon anyone juices. Dropping it is what keeps `jus de
 * citron` from reading as a fraction of the candied slices.
 */
function nounsOutsideParentheticals(line: string): string[] {
  return nouns(tokens(line.replace(/\([^)]*\)/g, ' ')))
}

/** The part-word this line hangs on, and the nouns it hangs it on — or null if it names a whole. */
function partReference(line: string): { part: string; nouns: string[] } | null {
  const words = tokens(line)
  const index = words.findIndex((word) => PART_WORDS.has(word))
  if (index === -1) return null
  const hangsOn = nouns(words.slice(index + 1))
  return hangsOn.length > 0
    ? { part: words[index] ?? '', nouns: hangsOn }
    : null
}

/**
 * The three things v4 forbids in a reconstituted list: a duration, a temperature, and a fraction of
 * an ingredient the list already carries whole. Measured on page E of the spike, where v3 produced
 * `1 mn sur feu doux` and counted the eggs three times.
 */
export function inferredListViolations(lines: readonly string[]): string[] {
  const violations: string[] = []
  const wholes = lines.filter((line) => partReference(line) === null)
  for (const line of lines) {
    if (DURATION.test(line))
      violations.push(`duration as an ingredient: "${line}"`)
    if (TEMPERATURE.test(line))
      violations.push(`temperature as an ingredient: "${line}"`)
    const reference = partReference(line)
    if (!reference) continue
    for (const whole of wholes) {
      const wholeNouns = nounsOutsideParentheticals(whole)
      if (reference.nouns.some((noun) => wholeNouns.includes(noun)))
        violations.push(
          `"${line}" is a ${reference.part} of "${whole}", already listed whole`,
        )
    }
  }
  return violations
}

/** A line that ends on a colon labels a section; it is not something to buy. */
export function sectionLabelLines(lines: readonly string[]): string[] {
  return lines.filter((line) => /:\s*$/.test(line))
}

const STOPWORDS = new Set([...ARTICLES, 'et', 'en', 'ou'])

/**
 * The words a list actually buys, as a sorted multiset. Page E prints no list, so where its lines
 * break is a reading and not a fact — v3 splits `sel, poivre et noix muscade` into three lines, which
 * R1 does not ask it to stop doing. Comparing content rather than lines keeps the hand transcription
 * an oracle for what must be bought without making it one for how it must be laid out.
 */
export function contentTokens(lines: readonly string[]): string[] {
  return lines
    .flatMap((line) => tokens(line))
    .filter((token) => !STOPWORDS.has(token))
    .sort()
}

/**
 * What the candidate lost against the reference, and what it invented. A loss is split in two,
 * because they mean opposite things: the hand transcription carries `sel` twice, because the page
 * seasons twice, and v4's own rule forbids listing the same ingredient twice — so dropping the
 * repeat is the rule working and the shopping list still says salt. Dropping the last copy is not.
 */
export function contentDrift(
  reference: readonly string[],
  candidate: readonly string[],
): { absent: string[]; deduplicated: string[]; extra: string[] } {
  const candidateTokens = contentTokens(candidate)
  const present = new Set(candidateTokens)
  const remaining = [...candidateTokens]
  const absent: string[] = []
  const deduplicated: string[] = []
  for (const token of contentTokens(reference)) {
    const found = remaining.indexOf(token)
    if (found !== -1) remaining.splice(found, 1)
    else if (present.has(token)) deduplicated.push(token)
    else absent.push(token)
  }
  return { absent, deduplicated, extra: remaining }
}

export function compareV4Extraction({
  baseline,
  candidate,
  page,
}: {
  baseline: unknown
  candidate: unknown
  page: string
}): Comparison {
  const before = extractionSchemaV2.parse(baseline)
  const after = extractionSchemaV2.parse(candidate)
  const fatal: string[] = []
  const advisory: string[] = []
  const inferredPage = INFERRED_PAGES.has(page)

  if (before.recipes.length !== after.recipes.length)
    fatal.push(
      `recipe count differs: v3 ${before.recipes.length}, v4 ${after.recipes.length}`,
    )

  for (const [index, recipe] of after.recipes.entries()) {
    const where = `recipe ${index + 1}`
    const lines = recipe.ingredients.map((ingredient) => ingredient.raw)
    if (recipe.ingredientsInferred !== inferredPage)
      fatal.push(
        `${where}: ingredientsInferred is ${recipe.ingredientsInferred}, the page ${inferredPage ? 'prints no list' : 'prints a list'}`,
      )
    // R2 — a section label must never land in an ingredient line, on any page.
    for (const label of sectionLabelLines(lines))
      fatal.push(`${where}: section label in an ingredient line: "${label}"`)
    if (inferredPage)
      for (const violation of inferredListViolations(lines))
        fatal.push(`${where}: ${violation}`)

    const archived = before.recipes[index]
    if (!archived) continue
    if (
      normalizeTypography(archived.title) !== normalizeTypography(recipe.title)
    ) {
      const sameName =
        normalizeTypography(withoutFootnoteMarker(archived.title)) ===
        normalizeTypography(withoutFootnoteMarker(recipe.title))
      ;(sameName ? advisory : fatal).push(
        `${where} title: v3 "${archived.title}", v4 "${recipe.title}"${sameName ? ' (footnote marker only)' : ''}`,
      )
    }
    const archivedLines = archived.ingredients.map(
      (ingredient) => ingredient.raw,
    )
    // On an inferred page the list is the thing v4 rewrites, so a divergence there is expected.
    for (const issue of diffLines(archivedLines, lines, `${where} ingredients`))
      (inferredPage ? advisory : fatal).push(issue)
    if (normalizeProse(archived.steps) === normalizeProse(recipe.steps)) {
      if (archived.steps.length !== recipe.steps.length)
        advisory.push(
          `${where} steps re-chunked: v3 ${archived.steps.length}, v4 ${recipe.steps.length}, same prose`,
        )
    } else
      for (const issue of diffLines(
        archived.steps,
        recipe.steps,
        `${where} steps`,
      ))
        fatal.push(issue)
  }

  // Page E is the only page with a hand transcription, and it is what R1 targets, so v4 owes it a
  // match on content rather than a remark.
  if (page === 'e') {
    const { absent, deduplicated, extra } = contentDrift(
      PAGE_E_EXPECTED_INGREDIENTS,
      after.recipes[0]?.ingredients.map((ingredient) => ingredient.raw) ?? [],
    )
    if (absent.length) fatal.push(`page E lost: ${absent.join(', ')}`)
    if (extra.length) fatal.push(`page E invented: ${extra.join(', ')}`)
    if (deduplicated.length)
      advisory.push(
        `page E lists once what the transcription lists twice: ${deduplicated.join(', ')}`,
      )
  }
  return { fatal, advisory }
}

/** A footnote marker points at a credit line, which the prompt is told to ignore. */
function withoutFootnoteMarker(title: string): string {
  return title.replace(/[*†‡¹²³]+\s*$/, '').trim()
}

if (process.argv[1]?.endsWith('compare-v4.ts'))
  void runComparator({
    usage: 'Usage : tsx spike/compare-v4.ts <dossier v3> <dossier v4>',
    compare: compareV4Extraction,
    // v3's own two-pass instability is not v4's to answer for: what v4 is judged on is the rules.
    fails: ({ comparison }) => comparison.fatal.length > 0,
  })
