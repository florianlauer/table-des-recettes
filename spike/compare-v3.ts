import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  extractionSchemaV1,
  extractionSchemaV2,
} from '../src/lib/recipe-schema.js'

export const REPLAY_PAGES = ['a', 'b', 'c', 'e', 'f', 'g', 'h'] as const

// Pages that print no ingredient list at all, checked by eye against the photos. E is the two
// versions of the cheese soufflé; G is the "Ma recette bonne humeur" column, whose whole recipe is
// a bulleted prose block under `LA RECETTE`. On these two the v2 archive is NOT a reference for
// ingredients — its list was already inferred, under a prompt that never asked it to be.
export const INFERRED_PAGES = new Set(['e', 'g'])

// Transcribed by hand from spike/fixtures/pages/e.jpg, in the order the prose mentions them.
// Deliberately excluded: the mould butter (no quantity given) and the "3 jaunes d'œufs" of the
// second stage, which are the yolks of the 4 eggs already listed — a shopping list must not
// count them twice.
export const PAGE_E_EXPECTED_INGREDIENTS = [
  '4 œufs',
  '2 pincées de sel',
  '25 cl de lait',
  '40 g de beurre',
  '40 g de farine',
  '1 c. à soupe de crème épaisse',
  'sel, poivre et noix muscade',
  '100 g de comté finement râpé',
] as const

/**
 * `fatal` is a content change: a line the archive has and v3 lost, or prose v3 rewrote. `advisory`
 * is a boundary change with the text preserved — v3 chunks a single prose paragraph into fewer
 * steps than v2 did, which no reading of the page settles, since these magazines print one block
 * of prose with no editorial step markers. Inferred pages are advisory throughout: there is no
 * model-independent reference for a list the page never printed.
 */
export type V3Comparison = { fatal: string[]; advisory: string[] }

export function compareV3Extraction({
  baseline,
  candidate,
  page,
}: {
  baseline: unknown
  candidate: unknown
  page: string
}): V3Comparison {
  const before = extractionSchemaV1.parse(baseline)
  const after = extractionSchemaV2.parse(candidate)
  const fatal: string[] = []
  const advisory: string[] = []
  const inferredPage = INFERRED_PAGES.has(page)
  if (before.recipes.length !== after.recipes.length)
    fatal.push(
      `recipe count differs: archive ${before.recipes.length}, v3 ${after.recipes.length}`,
    )
  for (const recipe of after.recipes)
    if (recipe.ingredientsInferred !== inferredPage)
      fatal.push(
        `${recipe.title}: ingredientsInferred is ${recipe.ingredientsInferred}, the page ${inferredPage ? 'prints no list' : 'prints a list'}`,
      )
  for (const [index, archived] of before.recipes.entries()) {
    const found = after.recipes[index]
    if (!found) continue
    const where = `recipe ${index + 1}`
    if (archived.title !== found.title)
      fatal.push(
        `${where} title: archive "${archived.title}", v3 "${found.title}"`,
      )
    const ingredientIssues = diffLines(
      archived.ingredients.map((ingredient) => ingredient.raw),
      found.ingredients.map((ingredient) => ingredient.raw),
      `${where} ingredients`,
    )
    // The printed list has real line boundaries, so a divergence there is a content change. An
    // inferred one has none, so the same divergence is only a difference of reading.
    for (const issue of ingredientIssues)
      (inferredPage ? advisory : fatal).push(issue)
    // Step boundaries are advisory, the prose they carry is not.
    if (normalizeProse(archived.steps) === normalizeProse(found.steps)) {
      if (archived.steps.length !== found.steps.length)
        advisory.push(
          `${where} steps re-chunked: archive ${archived.steps.length}, v3 ${found.steps.length}, same prose`,
        )
    } else
      for (const issue of diffLines(
        archived.steps,
        found.steps,
        `${where} steps`,
      ))
        fatal.push(issue)
  }
  if (page === 'e')
    for (const issue of diffLines(
      [...PAGE_E_EXPECTED_INGREDIENTS],
      after.recipes[0]?.ingredients.map((ingredient) => ingredient.raw) ?? [],
      'page E vs hand transcription',
    ))
      advisory.push(issue)
  return { fatal, advisory }
}

/** Joined prose, insensitive to step boundaries and to the space French sets before `!` and `?`. */
function normalizeProse(steps: readonly string[]): string {
  return steps
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([!?;:])/g, '$1')
    .trim()
}

function diffLines(
  expected: readonly string[],
  actual: readonly string[],
  label: string,
): string[] {
  const issues: string[] = []
  for (let index = 0; index < Math.max(expected.length, actual.length); index++)
    if (expected[index] !== actual[index])
      issues.push(
        `${label}[${index}] archive "${expected[index] ?? '—'}" ≠ v3 "${actual[index] ?? '—'}"`,
      )
  return issues
}

type ArchivedRun = { status?: string; parsed?: unknown }

async function readRun(path: string): Promise<ArchivedRun> {
  return JSON.parse(await readFile(path, 'utf8')) as ArchivedRun
}

/**
 * Three levels, as the plan specifies: two-pass stability, identity against the v2 archive, and the
 * hand transcription on page E. Both archive passes are tried as the baseline, so an instability
 * the archive already had is not reported as a v3 regression.
 */
async function main(): Promise<void> {
  const [archiveDirectory, candidateDirectory] = process.argv.slice(2)
  if (!archiveDirectory || !candidateDirectory)
    throw new Error(
      'Usage : tsx spike/compare-v3.ts <dossier archive v2> <dossier v3>',
    )
  let failures = 0
  for (const page of REPLAY_PAGES) {
    const [archive1, archive2, candidate1, candidate2] = await Promise.all([
      readRun(resolve(archiveDirectory, `${page}-1.json`)),
      readRun(resolve(archiveDirectory, `${page}-2.json`)),
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
    const readings = [archive1, archive2].map((archive) =>
      compareV3Extraction({
        baseline: archive.parsed,
        candidate: candidate1.parsed,
        page,
      }),
    )
    const best = readings.reduce((left, right) =>
      left.fatal.length <= right.fatal.length ? left : right,
    )
    if (!stable || best.fatal.length) failures += 1
    console.log(
      `${label} ${stable ? 'stable' : 'INSTABLE entre les deux passes'} · ${best.fatal.length ? `${best.fatal.length} divergence(s) fatale(s)` : 'conforme'}${best.advisory.length ? ` · ${best.advisory.length} à l’œil` : ''}`,
    )
    for (const issue of best.fatal) console.log(`   ✗ ${issue}`)
    for (const issue of best.advisory) console.log(`   ~ ${issue}`)
  }
  if (failures) throw new Error(`${failures} page(s) en échec.`)
  console.log('Comparaison conforme.')
}

if (process.argv[1]?.endsWith('compare-v3.ts')) void main()
