/**
 * The shared machinery of the prompt-version comparators: what the fixture set is, how two extracted
 * texts are told apart, and how a run of seven pages is walked and reported. What differs between
 * versions is a *policy* — which schema parses the baseline, what counts as fatal, whether a
 * two-pass instability fails the run — and that stays in `compare-v3.ts` and `compare-v4.ts`.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
 * `fatal` is a content change. `advisory` is a difference no reading of the page settles — a
 * boundary moved with the text preserved, or a list the page never printed.
 */
export type Comparison = { fatal: string[]; advisory: string[] }

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
export function normalizeProse(steps: readonly string[]): string {
  return normalizeTypography(steps.join(' ')).replace(/ ([!?;:])/g, '$1')
}

export function diffLines(
  baseline: readonly string[],
  candidate: readonly string[],
  label: string,
): string[] {
  const issues: string[] = []
  for (
    let index = 0;
    index < Math.max(baseline.length, candidate.length);
    index++
  )
    if (
      normalizeTypography(baseline[index] ?? '') !==
      normalizeTypography(candidate[index] ?? '')
    )
      issues.push(
        `${label}[${index}] baseline "${baseline[index] ?? '—'}" ≠ candidate "${candidate[index] ?? '—'}"`,
      )
  return issues
}

type ArchivedRun = { status?: string; parsed?: unknown }

async function readRun(path: string): Promise<ArchivedRun> {
  return JSON.parse(await readFile(path, 'utf8')) as ArchivedRun
}

export type PageResult = {
  page: string
  /** Whether the candidate's two passes rendered the same JSON, byte for byte. */
  stable: boolean
  comparison: Comparison
}

/**
 * Walks the fixture set, prints one line per page, and returns the count of pages the caller's
 * `fails` predicate rejected. Both baseline passes are tried as the reference, so an instability the
 * baseline already had is not charged to the candidate.
 */
export async function reportComparison({
  baselineDirectory,
  candidateDirectory,
  compare,
  fails,
}: {
  baselineDirectory: string
  candidateDirectory: string
  compare: (input: {
    baseline: unknown
    candidate: unknown
    page: string
  }) => Comparison
  fails: (result: PageResult) => boolean
}): Promise<number> {
  let failures = 0
  for (const page of REPLAY_PAGES) {
    const label = page.toUpperCase()
    const [baseline1, baseline2, candidate1, candidate2] = await Promise.all([
      readRun(resolve(baselineDirectory, `${page}-1.json`)),
      readRun(resolve(baselineDirectory, `${page}-2.json`)),
      readRun(resolve(candidateDirectory, `${page}-1.json`)),
      readRun(resolve(candidateDirectory, `${page}-2.json`)),
    ])
    if (candidate1.status !== 'success' || candidate2.status !== 'success') {
      console.log(
        `${label} ÉCHEC transport : ${candidate1.status} / ${candidate2.status}`,
      )
      failures += 1
      continue
    }
    const readings = [baseline1, baseline2].map((baseline) =>
      compare({
        baseline: baseline.parsed,
        candidate: candidate1.parsed,
        page,
      }),
    )
    const result: PageResult = {
      page,
      stable:
        JSON.stringify(candidate1.parsed) === JSON.stringify(candidate2.parsed),
      comparison: readings.reduce((left, right) =>
        left.fatal.length <= right.fatal.length ? left : right,
      ),
    }
    if (fails(result)) failures += 1
    const { stable, comparison } = result
    console.log(
      `${label} ${stable ? 'stable' : 'instable entre les deux passes'} · ${comparison.fatal.length ? `${comparison.fatal.length} divergence(s) fatale(s)` : 'conforme'}${comparison.advisory.length ? ` · ${comparison.advisory.length} à l’œil` : ''}`,
    )
    for (const issue of comparison.fatal) console.log(`   ✗ ${issue}`)
    for (const issue of comparison.advisory) console.log(`   ~ ${issue}`)
  }
  return failures
}

/** Shared entry point: both comparators take a baseline directory and a candidate directory. */
export async function runComparator({
  usage,
  compare,
  fails,
}: {
  usage: string
  compare: (input: {
    baseline: unknown
    candidate: unknown
    page: string
  }) => Comparison
  fails: (result: PageResult) => boolean
}): Promise<void> {
  const [baselineDirectory, candidateDirectory] = process.argv.slice(2)
  if (!baselineDirectory || !candidateDirectory) throw new Error(usage)
  const failures = await reportComparison({
    baselineDirectory,
    candidateDirectory,
    compare,
    fails,
  })
  if (failures) throw new Error(`${failures} page(s) en échec.`)
  console.log('Comparaison conforme.')
}
