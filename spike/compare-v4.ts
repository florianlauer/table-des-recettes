import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { extractionSchemaV2 } from '../src/lib/recipe-schema.js'
import { normalizeText, stemToken } from '../src/lib/normalize.js'
import {
  INFERRED_PAGES,
  PAGE_E_EXPECTED_INGREDIENTS,
  REPLAY_PAGES,
} from './compare-v3.js'

export { INFERRED_PAGES, REPLAY_PAGES }

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
const PART_WORDS = [
  'jaune',
  'blanc',
  'zeste',
  'ecorce',
  'jus',
  'peau',
  'moitie',
  'coque',
]
const ARTICLES = [
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
]

function tokens(line: string): string[] {
  return normalizeText(line).split(' ').filter(Boolean).map(stemToken)
}

/**
 * A parenthetical lists what is inside a product, not the product: the `(citrons, kumquats)` of
 * `tranches d'agrumes confits` is not a lemon anyone juices. Dropping it is what keeps `jus de
 * citron` from reading as a fraction of the candied slices.
 */
function nounsOutsideParentheticals(line: string): string[] {
  return tokens(line.replace(/\([^)]*\)/g, ' ')).filter(
    (word) => !ARTICLES.includes(word) && !/^\d+$/.test(word),
  )
}

/** The part-word this line hangs on, and the nouns it hangs it on — or null if it names a whole. */
function partReference(line: string): { part: string; nouns: string[] } | null {
  const words = tokens(line)
  const index = words.findIndex((word) => PART_WORDS.includes(word))
  if (index === -1) return null
  const nouns = words
    .slice(index + 1)
    .filter((word) => !ARTICLES.includes(word) && !/^\d+$/.test(word))
  return nouns.length > 0 ? { part: words[index] ?? '', nouns } : null
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

/** Content the reference carries and the candidate lost, and content it invented. */
export function contentDrift(
  reference: readonly string[],
  candidate: readonly string[],
): { missing: string[]; extra: string[] } {
  const remaining = [...contentTokens(candidate)]
  const missing: string[] = []
  for (const token of contentTokens(reference)) {
    const found = remaining.indexOf(token)
    if (found === -1) missing.push(token)
    else remaining.splice(found, 1)
  }
  return { missing, extra: remaining }
}

export type V4Comparison = { fatal: string[]; advisory: string[] }

export function compareV4Extraction({
  baseline,
  candidate,
  page,
}: {
  baseline: unknown
  candidate: unknown
  page: string
}): V4Comparison {
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
    const lines =
      after.recipes[0]?.ingredients.map((ingredient) => ingredient.raw) ?? []
    const drift = contentDrift(PAGE_E_EXPECTED_INGREDIENTS, lines)
    // The hand transcription carries `sel` twice, because the page seasons twice. v4's own rule
    // forbids listing the same ingredient twice, so losing the repeat is the rule working, not an
    // ingredient lost — the shopping list still says salt. Losing the last copy is not.
    const present = new Set(contentTokens(lines))
    const absent = drift.missing.filter((token) => !present.has(token))
    const deduplicated = drift.missing.filter((token) => present.has(token))
    if (absent.length) fatal.push(`page E lost: ${absent.join(', ')}`)
    if (drift.extra.length)
      fatal.push(`page E invented: ${drift.extra.join(', ')}`)
    if (deduplicated.length)
      advisory.push(
        `page E lists once what the transcription lists twice: ${deduplicated.join(', ')}`,
      )
  }
  return { fatal, advisory }
}

/**
 * Which glyph the model picks for an apostrophe or a quote is transcription style, not content:
 * `d'huile` and `d’huile` name the same oil. Left unnormalized it fails a whole page on typography.
 */
export function normalizeTypography(text: string): string {
  return (
    text
      .replace(/[’‘‚]/g, "'")
      .replace(/[“”„]/g, '"')
      // No-break and narrow no-break space, written escaped: French typography sets them before a
      // colon or a unit, and the \s+ below does not match them in every engine.
      .replace(/[\u00a0\u202f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Joined prose, insensitive to step boundaries and to the space French sets before `!` and `?`. */
function normalizeProse(steps: readonly string[]): string {
  return normalizeTypography(steps.join(' ')).replace(/ ([!?;:])/g, '$1')
}

/** A footnote marker points at a credit line, which the prompt is told to ignore. */
function withoutFootnoteMarker(title: string): string {
  return title.replace(/[*†‡¹²³]+\s*$/, '').trim()
}

function diffLines(
  expected: readonly string[],
  actual: readonly string[],
  label: string,
): string[] {
  const issues: string[] = []
  for (let index = 0; index < Math.max(expected.length, actual.length); index++)
    if (
      normalizeTypography(expected[index] ?? '') !==
      normalizeTypography(actual[index] ?? '')
    )
      issues.push(
        `${label}[${index}] v3 "${expected[index] ?? '—'}" ≠ v4 "${actual[index] ?? '—'}"`,
      )
  return issues
}

type ArchivedRun = { status?: string; parsed?: unknown }

async function readRun(path: string): Promise<ArchivedRun> {
  return JSON.parse(await readFile(path, 'utf8')) as ArchivedRun
}

async function main(): Promise<void> {
  const [baselineDirectory, candidateDirectory] = process.argv.slice(2)
  if (!baselineDirectory || !candidateDirectory)
    throw new Error('Usage : tsx spike/compare-v4.ts <dossier v3> <dossier v4>')
  let failures = 0
  for (const page of REPLAY_PAGES) {
    const [baseline1, baseline2, candidate1, candidate2] = await Promise.all([
      readRun(resolve(baselineDirectory, `${page}-1.json`)),
      readRun(resolve(baselineDirectory, `${page}-2.json`)),
      readRun(resolve(candidateDirectory, `${page}-1.json`)),
      readRun(resolve(candidateDirectory, `${page}-2.json`)),
    ])
    const label = page.toUpperCase()
    if (candidate1.status !== 'success' || candidate2.status !== 'success') {
      console.log(
        `${label} ÉCHEC transport : ${candidate1.status} / ${candidate2.status}`,
      )
      failures += 1
      continue
    }
    const stable =
      JSON.stringify(candidate1.parsed) === JSON.stringify(candidate2.parsed)
    // Both baseline passes are tried, so an instability v3 already had is not charged to v4.
    const readings = [baseline1, baseline2].map((baseline) =>
      compareV4Extraction({
        baseline: baseline.parsed,
        candidate: candidate1.parsed,
        page,
      }),
    )
    const best = readings.reduce((left, right) =>
      left.fatal.length <= right.fatal.length ? left : right,
    )
    if (best.fatal.length) failures += 1
    console.log(
      `${label} ${stable ? 'stable' : 'instable entre les deux passes'} · ${best.fatal.length ? `${best.fatal.length} divergence(s) fatale(s)` : 'conforme'}${best.advisory.length ? ` · ${best.advisory.length} à l’œil` : ''}`,
    )
    for (const issue of best.fatal) console.log(`   ✗ ${issue}`)
    for (const issue of best.advisory) console.log(`   ~ ${issue}`)
  }
  if (failures) throw new Error(`${failures} page(s) en échec.`)
  console.log('Comparaison conforme.')
}

if (process.argv[1]?.endsWith('compare-v4.ts')) void main()
