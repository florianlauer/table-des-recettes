#!/usr/bin/env node
import 'dotenv/config'

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractionSchema, repairExtraction } from '../src/lib/recipe-schema.js'
import type { Extraction } from '../src/lib/recipe-schema.js'
import { BudgetCounter } from './budget.js'
import { extractionJsonSchema, JSON_SCHEMA_NAME } from './json-schema.js'
import { askEndpoint, requireOpenRouterApiKey } from './openrouter.js'
import type { EndpointCall } from './openrouter.js'
import { endpointFromLadder, latestLadder, parseNamedArguments } from './run.js'
import { sameDigits, textSimilarity } from './text.js'

export const CORRECTION_PROMPT_VERSION = 'c1'

// La repasse ne voit pas la page : elle ne peut donc pas « re-extraire », seulement relire. C'est
// délibéré — un modèle qui reverrait l'image recommencerait l'extraction et réintroduirait les
// erreurs de segmentation que la première passe avait évitées.
export const CORRECTION_PROMPT = `Tu relis une extraction de recettes déjà réalisée à partir d'une page de magazine française. Tu ne vois pas la page d'origine et tu ne dois rien y suppléer.

Corrige uniquement les fautes manifestes de transcription du français :
- les coquilles, par exemple « Pivrez » pour « Poivrez » ou « Pouvez » pour « Poivrez » ;
- les mots coupés par une césure de fin de ligne, par exemple « Par-semez » pour « Parsemez » ;
- les espaces manquants ou surnuméraires, et les apostrophes mal formées.

Interdits absolus :
- ne change aucun chiffre, aucune quantité, aucune unité, aucune fraction ;
- n'ajoute, ne supprime, ne fusionne et ne divise aucune recette, aucun ingrédient, aucune étape ;
- ne reformule pas, ne résume pas, ne réordonne pas, ne complète pas avec tes connaissances culinaires ;
- ne corrige pas un nom de plat ou d'ingrédient qui te semble inhabituel : les recettes régionales et étrangères en contiennent beaucoup ;
- si un texte te paraît étrange sans être une faute d'orthographe manifeste, laisse-le strictement tel quel.

Retourne l'objet JSON complet, avec exactement la même structure et le même nombre d'éléments, ne portant que les corrections orthographiques.`

export const MINIMUM_CORRECTION_SIMILARITY = 0.85

// La repasse n'envoie pas d'image : son entrée est du texte, environ un quart d'un appel
// d'extraction. Le plafond reste volontairement large, il ne sert qu'à la pré-vérification.
export const CORRECTION_COST_CEILING_USD = 0.05

export type Correction = { path: string; from: string; to: string }

// Un texte n'est retenu que s'il reste le même texte : mêmes chiffres, et une distance d'édition
// qui reste dans la zone « éditable » d'accept.ts. En dessous, ce n'est plus une correction mais une
// réécriture, et l'original fait foi.
export function acceptText({
  original,
  corrected,
}: {
  original: string
  corrected: unknown
}): string {
  if (typeof corrected !== 'string' || corrected === original) return original
  if (!sameDigits(original, corrected)) return original
  return textSimilarity(original, corrected) >= MINIMUM_CORRECTION_SIMILARITY
    ? corrected
    : original
}

export function mergeCorrection({
  original,
  corrected,
}: {
  original: Extraction
  corrected: unknown
}): { value: Extraction; corrections: Correction[] } {
  const corrections: Correction[] = []
  const parsed = extractionSchema.safeParse(repairExtraction(corrected).value)
  // Une repasse qui ne rend pas la même forme n'est pas fiable : on garde l'extraction d'origine.
  if (
    !parsed.success ||
    parsed.data.recipes.length !== original.recipes.length
  ) {
    return { value: original, corrections }
  }

  const recipes = original.recipes.map((recipe, recipeIndex) => {
    const candidate = parsed.data.recipes[recipeIndex]
    if (
      !candidate ||
      candidate.ingredients.length !== recipe.ingredients.length ||
      candidate.steps.length !== recipe.steps.length
    ) {
      return recipe
    }

    function keep({
      path,
      from,
      to,
    }: {
      path: string
      from: string
      to: unknown
    }): string {
      const accepted = acceptText({ original: from, corrected: to })
      if (accepted !== from) corrections.push({ path, from, to: accepted })
      return accepted
    }

    return {
      ...recipe,
      title: keep({
        path: `recipes.${recipeIndex}.title`,
        from: recipe.title,
        to: candidate.title,
      }),
      ingredients: recipe.ingredients.map((ingredient, ingredientIndex) => ({
        ...ingredient,
        raw: keep({
          path: `recipes.${recipeIndex}.ingredients.${ingredientIndex}.raw`,
          from: ingredient.raw,
          to: candidate.ingredients[ingredientIndex]?.raw,
        }),
      })),
      steps: recipe.steps.map((step, stepIndex) =>
        keep({
          path: `recipes.${recipeIndex}.steps.${stepIndex}`,
          from: step,
          to: candidate.steps[stepIndex],
        }),
      ),
    }
  })

  return { value: { recipes }, corrections }
}

// La repasse emprunte le transport partagé : elle hérite ainsi du pré-contrôle budgétaire, des
// reprises, de la vérification du provider servi et de la taxonomie d'échec. Elle n'interprète que le
// contenu de la réponse, seul endroit où elle diffère de l'extraction.
export async function runCorrectionPass({
  extraction,
  ...call
}: EndpointCall & {
  extraction: Extraction
}): Promise<{ value: Extraction; corrections: Correction[]; costUsd: number }> {
  const transported = await askEndpoint({
    ...call,
    content: `${CORRECTION_PROMPT}\n\n${JSON.stringify(extraction)}`,
  })
  // Une repasse qui n'aboutit pas n'est pas une régression : l'extraction d'origine reste valable.
  if (transported.status !== 'answered') {
    return {
      value: extraction,
      corrections: [],
      costUsd: transported.actualCostUsd,
    }
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(transported.content)
  } catch {
    return {
      value: extraction,
      corrections: [],
      costUsd: transported.actualCostUsd,
    }
  }

  return {
    ...mergeCorrection({ original: extraction, corrected: candidate }),
    costUsd: transported.actualCostUsd,
  }
}

async function main(): Promise<void> {
  const { run, model, provider } = parseNamedArguments(process.argv.slice(2))
  if (!run || !model || !provider) {
    throw new Error(
      'Usage : npm run correct -- --run <fichier.json> --model <id> --provider <slug>.',
    )
  }
  const artefact = JSON.parse(await readFile(resolve(run), 'utf8')) as {
    status: string
    parsed?: unknown
  }
  if (artefact.status !== 'success') {
    throw new Error(
      `L'artefact ${run} n'est pas une passe réussie (${artefact.status}).`,
    )
  }
  const extraction = extractionSchema.parse(artefact.parsed)
  const budgetPath = resolve('spike/fixtures/runs/budget.json')
  const budget = await BudgetCounter.load({ path: budgetPath })
  // L'échelle figée porte le nom d'affichage du provider et ses capacités : sans elle, la repasse ne
  // peut ni vérifier qui l'a servie, ni savoir si l'endpoint refuse `temperature`.
  const endpoint = endpointFromLadder({
    ladder: await latestLadder(),
    model,
    providerSlug: provider,
  })
  const { value, corrections, costUsd } = await runCorrectionPass({
    extraction,
    model: endpoint.model,
    providerSlug: endpoint.providerSlug,
    providerName: endpoint.providerName,
    supportsTemperature: endpoint.supportsTemperature,
    disableReasoning: endpoint.supportsReasoning,
    apiKey: requireOpenRouterApiKey(),
    budget,
    maximumEstimatedCostUsd: CORRECTION_COST_CEILING_USD,
    onCostRecorded: () => budget.save(budgetPath),
  })
  await budget.save(budgetPath)

  const outputPath = resolve(run.replace(/\.json$/, '-corrige.json'))
  await writeFile(
    outputPath,
    `${JSON.stringify({ correctionPromptVersion: CORRECTION_PROMPT_VERSION, model, provider, costUsd, corrections, parsed: value }, null, 2)}\n`,
  )
  console.log(`${corrections.length} correction(s) retenue(s), ${costUsd} USD.`)
  corrections.forEach(({ path, from, to }) =>
    console.log(`  ${path}\n    « ${from} »\n    « ${to} »`),
  )
  console.log(`Écrit : ${outputPath}`)
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
