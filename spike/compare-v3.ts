import {
  extractionSchemaV1,
  extractionSchemaV2,
} from '../src/lib/recipe-schema.js'
import {
  diffLines,
  INFERRED_PAGES,
  normalizeProse,
  PAGE_E_EXPECTED_INGREDIENTS,
  runComparator,
} from './compare-runs.js'
import type { Comparison } from './compare-runs.js'

/**
 * v3's policy against the v2 archive. A content change is fatal — a line the archive has and v3 lost,
 * or prose v3 rewrote. A boundary change with the text preserved is advisory: these magazines print
 * one block of prose with no editorial step markers, so no reading of the page settles where the
 * steps divide. Inferred pages are advisory throughout — there is no model-independent reference for
 * a list the page never printed. Two-pass instability fails the run: it was the spike's discriminant.
 */

export function compareV3Extraction({
  baseline,
  candidate,
  page,
}: {
  baseline: unknown
  candidate: unknown
  page: string
}): Comparison {
  const before = extractionSchemaV1.parse(baseline)
  const after = extractionSchemaV2.parse(candidate)
  const fatal: string[] = []
  const advisory: string[] = []
  const inferredPage = INFERRED_PAGES.has(page)
  if (before.recipes.length !== after.recipes.length)
    fatal.push(
      `recipe count differs: baseline ${before.recipes.length}, candidate ${after.recipes.length}`,
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
        `${where} title: baseline "${archived.title}", candidate "${found.title}"`,
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
          `${where} steps re-chunked: baseline ${archived.steps.length}, candidate ${found.steps.length}, same prose`,
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

if (process.argv[1]?.endsWith('compare-v3.ts'))
  void runComparator({
    usage: 'Usage : tsx spike/compare-v3.ts <dossier archive v2> <dossier v3>',
    compare: compareV3Extraction,
    // Two-pass instability fails the run: it is what separated the eight models of the spike.
    fails: ({ stable, comparison }) => !stable || comparison.fatal.length > 0,
  })
