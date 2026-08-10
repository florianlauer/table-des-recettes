import { readFile } from 'node:fs/promises'
import {
  extractionSchemaV1,
  extractionSchemaV2,
} from '../src/lib/recipe-schema.js'

export const PAGE_E_EXPECTED_INGREDIENTS = [
  '4 œufs',
  '2 pincées de sel',
  '25 cl de lait',
  '40 g de beurre',
  '40 g de farine',
  '1 c. à soupe de crème épaisse',
  'sel, poivre et noix muscade',
  '100 g de comté râpé',
] as const

export function compareV3Extraction({
  baseline,
  candidate,
  page,
}: {
  baseline: unknown
  candidate: unknown
  page: string
}): string[] {
  const before = extractionSchemaV1.parse(baseline)
  const after = extractionSchemaV2.parse(candidate)
  const issues: string[] = []
  if (before.recipes.length !== after.recipes.length)
    issues.push('recipe count differs')
  if (page === 'e') {
    const raw =
      after.recipes[0]?.ingredients.map((ingredient) => ingredient.raw) ?? []
    if (JSON.stringify(raw) !== JSON.stringify(PAGE_E_EXPECTED_INGREDIENTS))
      issues.push('page E inferred ingredients differ')
    if (!after.recipes[0]?.ingredientsInferred)
      issues.push('page E inference signal is false')
  } else {
    if (after.recipes.some((recipe) => recipe.ingredientsInferred))
      issues.push('printed ingredient list marked inferred')
    const withoutSignal = after.recipes.map(
      ({ ingredientsInferred: _, ...recipe }) => recipe,
    )
    if (JSON.stringify(before.recipes) !== JSON.stringify(withoutSignal))
      issues.push('archived extraction differs')
  }
  return issues
}

async function main(): Promise<void> {
  const [baselinePath, candidatePath, page] = process.argv.slice(2)
  if (!baselinePath || !candidatePath || !page)
    throw new Error(
      'Usage : tsx spike/compare-v3.ts <v2.json> <v3.json> <page>',
    )
  const baselineRun = JSON.parse(await readFile(baselinePath, 'utf8')) as {
    parsed?: unknown
  }
  const candidateRun = JSON.parse(await readFile(candidatePath, 'utf8')) as {
    parsed?: unknown
  }
  const issues = compareV3Extraction({
    baseline: baselineRun.parsed,
    candidate: candidateRun.parsed,
    page,
  })
  if (issues.length) throw new Error(issues.join('\n'))
  console.log('Comparaison conforme.')
}

if (process.argv[1]?.endsWith('compare-v3.ts')) void main()
