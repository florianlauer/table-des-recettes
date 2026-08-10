#!/usr/bin/env node
import '../load-env.js'

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import { extractionSchema, repairExtraction } from '../src/lib/recipe-schema.js'
import type { Extraction } from '../src/lib/recipe-schema.js'
import { BudgetCounter } from './budget.js'
import { CORRECTION_COST_CEILING_USD, runCorrectionPass } from './correct.js'
import type { Correction } from './correct.js'
import {
  requireOpenRouterApiKey,
  runVisionPass,
  serializeRun,
} from './openrouter.js'
import type { LadderEntry, LadderFile } from './rank-endpoints.js'
import { parseNamedArguments } from './run.js'
import { normalizedText, textSimilarity } from './text.js'

export const acceptanceTruthSchema = z.strictObject({
  recipes: z.array(
    z.strictObject({
      title: z.string(),
      type: z.enum(['entree', 'plat', 'dessert', 'apero', 'petitDej', 'autre']),
      servings: z.number().nullable(),
      ingredients: z.array(z.strictObject({ raw: z.string() })),
      steps: z.array(z.string()),
    }),
  ),
})

export type AcceptanceTruth = z.infer<typeof acceptanceTruthSchema>

export type AcceptanceIssue = {
  category: string
  recipeIndex?: number
  detail: string
}

export type AcceptanceClassification = {
  hardGates: AcceptanceIssue[]
  editableGaps: AcceptanceIssue[]
  humanReview: AcceptanceIssue[]
  passesHardGates: boolean
}

export type AcceptancePassReport = {
  pass: number
  status: string
  // `classification` porte la lecture qui fait foi : celle de l'extraction corrigée, c'est-à-dire ce
  // que l'utilisateur obtiendra réellement. `rawClassification` garde la lecture brute pour que le
  // mérite du modèle d'extraction reste attribuable séparément de celui du correcteur.
  classification: AcceptanceClassification | null
  rawClassification: AcceptanceClassification | null
  corrections: Correction[]
}

export type ReadingDelta = {
  resorbed: number
  created: number
  hardGatesDiverge: boolean
}

function issueKeys(issues: AcceptanceIssue[]): Set<string> {
  return new Set(
    issues.map(
      ({ category, recipeIndex, detail }) =>
        `${category}|${recipeIndex}|${detail}`,
    ),
  )
}

// Comparer des cardinalités laisserait passer un hard gate remplacé par un autre : le total ne bouge
// pas alors que la repasse a franchi une frontière. Les écarts éditables sont déjà comparés par
// identité juste en dessous, les hard gates doivent l'être de la même façon.
function sameIssueSets(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key))
}

// Le seul garde-fou contre une repasse qui dégrade : comparer les deux lectures. Une correction qui
// éloigne le texte de la vérité terrain apparaît ici en `created`, et un hard gate qui n'existe que
// d'un côté signale que la repasse a franchi une frontière qu'elle ne devrait jamais franchir.
export function compareReadings({
  raw,
  corrected,
}: {
  raw: AcceptanceClassification
  corrected: AcceptanceClassification
}): ReadingDelta {
  const before = issueKeys(raw.editableGaps)
  const after = issueKeys(corrected.editableGaps)
  return {
    resorbed: [...before].filter((key) => !after.has(key)).length,
    created: [...after].filter(
      (key) => !before.has(key) && !key.startsWith('schema_repair|'),
    ).length,
    hardGatesDiverge: !sameIssueSets(
      issueKeys(raw.hardGates),
      issueKeys(corrected.hardGates),
    ),
  }
}

export type AcceptanceVerdict = {
  accepted: boolean
  exitCode: 0 | 1
  line: string
}

// The middle band stays blocking until a human has explicitly arbitrated it.
export const LOWER_SIMILARITY_BOUND = 0.6
export const UPPER_SIMILARITY_BOUND = 0.85

function sameMultiset(left: string[], right: string[]): boolean {
  return [...left]
    .sort()
    .every((value, index) => value === [...right].sort()[index])
}

export function classifyTextDifference(
  left: string,
  right: string,
): 'hard_gate' | 'a_trancher_humain' | 'editable' {
  const similarity = textSimilarity(left, right)
  if (similarity < LOWER_SIMILARITY_BOUND) return 'hard_gate'
  if (similarity > UPPER_SIMILARITY_BOUND) return 'editable'
  return 'a_trancher_humain'
}

export function classifyAcceptance({
  actual,
  truth,
}: {
  actual: unknown
  truth: AcceptanceTruth
}): AcceptanceClassification {
  const hardGates: AcceptanceIssue[] = []
  const editableGaps: AcceptanceIssue[] = []
  const humanReview: AcceptanceIssue[] = []
  // La réparation est une décision assumée, pas un blanc-seing : chaque champ réparé reste visible
  // au verdict comme écart éditable, sinon un modèle qui déroge au schéma passerait pour conforme.
  const { value: repaired, repairs } = repairExtraction(actual)
  repairs.forEach(({ path, from, to }) => {
    editableGaps.push({
      category: 'schema_repair',
      detail: `${path} : « ${from} » réparé en ${String(to)}.`,
    })
  })
  const validated = extractionSchema.safeParse(repaired)
  if (!validated.success) {
    hardGates.push({
      category: 'invalid_schema',
      detail: validated.error.message,
    })
    return { hardGates, editableGaps, humanReview, passesHardGates: false }
  }

  if (validated.data.recipes.length !== truth.recipes.length) {
    hardGates.push({
      category: 'wrong_recipe_count',
      detail: `${validated.data.recipes.length} recette(s) extraite(s), ${truth.recipes.length} attendue(s).`,
    })
    return { hardGates, editableGaps, humanReview, passesHardGates: false }
  }

  validated.data.recipes.forEach((recipe, recipeIndex) => {
    const expected = truth.recipes[recipeIndex]
    if (!expected) return

    if (recipe.title !== expected.title) {
      editableGaps.push({
        category:
          normalizedText(recipe.title) === normalizedText(expected.title)
            ? 'title_typography'
            : 'reformulated_title',
        recipeIndex,
        detail: `Titre « ${recipe.title} » au lieu de « ${expected.title} ».`,
      })
    }
    if (recipe.type !== expected.type) {
      editableGaps.push({
        category: 'wrong_type',
        recipeIndex,
        detail: `${recipe.type} au lieu de ${expected.type}.`,
      })
    }
    if (recipe.servings !== expected.servings) {
      editableGaps.push({
        category: 'wrong_servings',
        recipeIndex,
        detail: `${String(recipe.servings)} au lieu de ${String(expected.servings)}.`,
      })
    }

    if (recipe.ingredients.length < expected.ingredients.length) {
      hardGates.push({
        category: 'missing_or_merged_ingredient',
        recipeIndex,
        detail: `${recipe.ingredients.length} ligne(s), ${expected.ingredients.length} attendue(s).`,
      })
    } else if (recipe.ingredients.length > expected.ingredients.length) {
      hardGates.push({
        category: 'invented_ingredient',
        recipeIndex,
        detail: `${recipe.ingredients.length} ligne(s), ${expected.ingredients.length} attendue(s).`,
      })
    } else {
      recipe.ingredients.forEach(({ raw }, ingredientIndex) => {
        const expectedRaw = expected.ingredients[ingredientIndex]?.raw
        if (expectedRaw !== undefined && raw !== expectedRaw) {
          const issue = {
            recipeIndex,
            detail: `Ligne ${ingredientIndex + 1} : « ${raw} » au lieu de « ${expectedRaw} ».`,
          }
          const difference = classifyTextDifference(raw, expectedRaw)
          if (difference === 'hard_gate') {
            hardGates.push({
              category: 'invented_or_missing_ingredient',
              ...issue,
            })
          } else if (difference === 'editable') {
            editableGaps.push({ category: 'ingredient_text', ...issue })
          } else {
            const uncertainIssue = { category: 'a_trancher_humain', ...issue }
            hardGates.push(uncertainIssue)
            humanReview.push(uncertainIssue)
          }
        }
      })
    }

    if (recipe.steps.length !== expected.steps.length) {
      hardGates.push({
        category: 'missing_step',
        recipeIndex,
        detail: `${recipe.steps.length} étape(s), ${expected.steps.length} attendue(s).`,
      })
    } else if (
      sameMultiset(recipe.steps, expected.steps) &&
      recipe.steps.some((step, index) => step !== expected.steps[index])
    ) {
      hardGates.push({
        category: 'out_of_order_step',
        recipeIndex,
        detail: 'Les étapes sont présentes mais hors ordre.',
      })
    } else {
      recipe.steps.forEach((step, stepIndex) => {
        const expectedStep = expected.steps[stepIndex]
        if (expectedStep !== undefined && step !== expectedStep) {
          // Le texte produit fait partie de l'identité de l'écart : sans lui, deux étapes fautives
          // de façons différentes portent la même clé, et `compareReadings` ne peut plus voir qu'une
          // repasse a dégradé une étape déjà imparfaite.
          const issue = {
            recipeIndex,
            detail: `Étape ${stepIndex + 1} : « ${step} » au lieu de « ${expectedStep} ».`,
          }
          const difference = classifyTextDifference(step, expectedStep)
          if (difference === 'hard_gate') {
            hardGates.push({ category: 'missing_step', ...issue })
          } else if (difference === 'editable') {
            editableGaps.push({ category: 'step_text', ...issue })
          } else {
            const uncertainIssue = { category: 'a_trancher_humain', ...issue }
            hardGates.push(uncertainIssue)
            humanReview.push(uncertainIssue)
          }
        }
      })
    }
  })

  return {
    hardGates,
    editableGaps,
    humanReview,
    passesHardGates: hardGates.length === 0,
  }
}

export function acceptanceVerdict(
  reports: AcceptancePassReport[],
): AcceptanceVerdict {
  const rejected = reports
    .filter(
      ({ status, classification }) =>
        status !== 'success' || classification?.passesHardGates !== true,
    )
    .map(({ pass, status, classification }) => {
      if (status !== 'success') return `passe ${pass}: ${status}`
      const categories =
        classification?.hardGates.map(({ category }) => category).join(', ') ||
        'hard gate inconnu'
      return `passe ${pass}: ${categories}`
    })
  if (reports.length === 2 && rejected.length === 0) {
    return {
      accepted: true,
      exitCode: 0,
      line: 'ACCEPTÉ — les deux passes franchissent tous les hard gates.',
    }
  }
  const reason =
    reports.length !== 2
      ? `${reports.length} passe(s) disponible(s), 2 requises`
      : rejected.join(' ; ')
  return { accepted: false, exitCode: 1, line: `REJETÉ — ${reason}.` }
}

async function latestLadder(): Promise<LadderFile> {
  const filename = (await readdir('spike'))
    .filter((entry) => /^ladder\.\d{4}-\d{2}-\d{2}\.json$/.test(entry))
    .sort()
    .at(-1)
  if (!filename)
    throw new Error("Aucune échelle figée. Exécutez d'abord npm run rank.")
  return JSON.parse(
    await readFile(resolve('spike', filename), 'utf8'),
  ) as LadderFile
}

async function main(): Promise<void> {
  const {
    model,
    provider,
    page = 'd',
    truth = `spike/fixtures/truth/d-acceptation.json`,
  } = parseNamedArguments(process.argv.slice(2))
  if (!model || !provider) {
    throw new Error(
      'Usage : npm run accept -- --model <id> --provider <slug> [--page d] [--truth <fichier>].',
    )
  }
  const apiKey = requireOpenRouterApiKey()
  const ladder = await latestLadder()
  const endpoint = ladder.ladder.find(
    (entry) => entry.model === model && entry.providerSlug === provider,
  )
  if (!endpoint)
    throw new Error(`Couple ${model} / ${provider} absent de l'échelle figée.`)
  let acceptedTruth: AcceptanceTruth
  try {
    acceptedTruth = acceptanceTruthSchema.parse(
      JSON.parse(await readFile(resolve(truth), 'utf8')),
    )
  } catch (error) {
    throw new Error(
      `Vérité terrain humaine absente ou invalide (${truth}) : ${String(error)}`,
    )
  }
  const budgetPath = resolve('spike/fixtures/runs/budget.json')
  const budget = await BudgetCounter.load({ path: budgetPath })
  const outputDirectory = resolve(
    'spike/fixtures/runs',
    endpoint.model,
    endpoint.providerSlug,
    'acceptance',
  )
  await mkdir(outputDirectory, { recursive: true })
  const report: AcceptancePassReport[] = []

  for (const pass of [1, 2]) {
    const result = await runVisionPass({
      model: endpoint.model,
      providerSlug: endpoint.providerSlug,
      providerName: endpoint.providerName,
      imagePath: resolve(`spike/fixtures/pages/${page}.jpg`),
      apiKey,
      budget,
      maximumEstimatedCostUsd: endpoint.maximumCallCostUsd,
      dataCollection: endpoint.dataCollection,
      onCostRecorded: () => budget.save(budgetPath),
    })
    await budget.save(budgetPath)
    await writeFile(
      resolve(outputDirectory, `${page}-${pass}.json`),
      `${JSON.stringify(serializeRun({ result, model, providerSlug: provider, page, pass, dataCollection: endpoint.dataCollection }), null, 2)}\n`,
    )
    if (result.status !== 'success') {
      report.push({
        pass,
        status: result.status,
        classification: null,
        rawClassification: null,
        corrections: [],
      })
      continue
    }

    const rawClassification = classifyAcceptance({
      actual: result.parsed,
      truth: acceptedTruth,
    })
    const { value, corrections } = await runCorrectionPass({
      extraction: result.parsed,
      model: endpoint.model,
      providerSlug: endpoint.providerSlug,
      providerName: endpoint.providerName,
      supportsTemperature: endpoint.supportsTemperature,
      disableReasoning: endpoint.supportsReasoning,
      apiKey,
      budget,
      maximumEstimatedCostUsd: CORRECTION_COST_CEILING_USD,
      onCostRecorded: () => budget.save(budgetPath),
    })
    await budget.save(budgetPath)
    await writeFile(
      resolve(outputDirectory, `${page}-${pass}-corrige.json`),
      `${JSON.stringify({ corrections, parsed: value }, null, 2)}\n`,
    )

    report.push({
      pass,
      status: result.status,
      classification: classifyAcceptance({
        actual: value,
        truth: acceptedTruth,
      }),
      rawClassification,
      corrections,
    })
  }

  console.log(
    JSON.stringify({ model, provider, page, passes: report }, null, 2),
  )
  report.forEach(({ pass, classification, rawClassification, corrections }) => {
    if (!classification || !rawClassification) return
    const delta = compareReadings({
      raw: rawClassification,
      corrected: classification,
    })
    console.log(
      `Passe ${pass} — écarts éditables : ${rawClassification.editableGaps.length} avant repasse, ` +
        `${classification.editableGaps.length} après (${delta.resorbed} résorbé(s), ${delta.created} créé(s), ` +
        `${corrections.length} correction(s) retenue(s)).`,
    )
    if (delta.created > 0 || delta.hardGatesDiverge) {
      console.log(
        `Passe ${pass} — ATTENTION : la repasse a dégradé la lecture, comparez les deux classifications.`,
      )
    }
  })
  console.log(
    'Chronométrez maintenant les écarts éditables restants de la première passe et reportez T_saisie/T_correction dans RESULTS.md.',
  )
  const verdict = acceptanceVerdict(report)
  console.log(verdict.line)
  process.exitCode = verdict.exitCode
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
