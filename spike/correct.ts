#!/usr/bin/env node
import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractionSchema, repairExtraction  } from "../src/lib/recipe-schema.js";
import type {Extraction} from "../src/lib/recipe-schema.js";
import { BudgetCounter } from "./budget.js";
import { extractionJsonSchema, JSON_SCHEMA_NAME } from "./json-schema.js";
import { HarnessError, OPENROUTER_API_URL, requireOpenRouterApiKey } from "./openrouter.js";
import { parseNamedArguments } from "./run.js";
import { sameDigits, textSimilarity } from "./text.js";

export const CORRECTION_PROMPT_VERSION = "c1";

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

Retourne l'objet JSON complet, avec exactement la même structure et le même nombre d'éléments, ne portant que les corrections orthographiques.`;

export const MINIMUM_CORRECTION_SIMILARITY = 0.85;

// La repasse n'envoie pas d'image : son entrée est du texte, environ un quart d'un appel
// d'extraction. Le plafond reste volontairement large, il ne sert qu'à la pré-vérification.
export const CORRECTION_COST_CEILING_USD = 0.05;

export type Correction = { path: string; from: string; to: string };

// Un texte n'est retenu que s'il reste le même texte : mêmes chiffres, et une distance d'édition
// qui reste dans la zone « éditable » d'accept.ts. En dessous, ce n'est plus une correction mais une
// réécriture, et l'original fait foi.
export function acceptText({ original, corrected }: { original: string; corrected: unknown }): string {
  if (typeof corrected !== "string" || corrected === original) return original;
  if (!sameDigits(original, corrected)) return original;
  return textSimilarity(original, corrected) >= MINIMUM_CORRECTION_SIMILARITY ? corrected : original;
}

export function mergeCorrection({
  original,
  corrected,
}: {
  original: Extraction;
  corrected: unknown;
}): { value: Extraction; corrections: Correction[] } {
  const corrections: Correction[] = [];
  const parsed = extractionSchema.safeParse(repairExtraction(corrected).value);
  // Une repasse qui ne rend pas la même forme n'est pas fiable : on garde l'extraction d'origine.
  if (!parsed.success || parsed.data.recipes.length !== original.recipes.length) {
    return { value: original, corrections };
  }

  const recipes = original.recipes.map((recipe, recipeIndex) => {
    const candidate = parsed.data.recipes[recipeIndex];
    if (
      !candidate ||
      candidate.ingredients.length !== recipe.ingredients.length ||
      candidate.steps.length !== recipe.steps.length
    ) {
      return recipe;
    }

    function keep({ path, from, to }: { path: string; from: string; to: unknown }): string {
      const accepted = acceptText({ original: from, corrected: to });
      if (accepted !== from) corrections.push({ path, from, to: accepted });
      return accepted;
    }

    return {
      ...recipe,
      title: keep({ path: `recipes.${recipeIndex}.title`, from: recipe.title, to: candidate.title }),
      ingredients: recipe.ingredients.map((ingredient, ingredientIndex) => ({
        ...ingredient,
        raw: keep({
          path: `recipes.${recipeIndex}.ingredients.${ingredientIndex}.raw`,
          from: ingredient.raw,
          to: candidate.ingredients[ingredientIndex]?.raw,
        }),
      })),
      steps: recipe.steps.map((step, stepIndex) =>
        keep({ path: `recipes.${recipeIndex}.steps.${stepIndex}`, from: step, to: candidate.steps[stepIndex] }),
      ),
    };
  });

  return { value: { recipes }, corrections };
}

export async function runCorrectionPass({
  extraction,
  model,
  providerSlug,
  apiKey,
  budget,
  maximumEstimatedCostUsd,
  fetchImpl = fetch,
}: {
  extraction: Extraction;
  model: string;
  providerSlug: string;
  apiKey: string;
  budget: BudgetCounter;
  maximumEstimatedCostUsd: number;
  fetchImpl?: typeof fetch;
}): Promise<{ value: Extraction; corrections: Correction[]; costUsd: number }> {
  budget.assertCanSpend(maximumEstimatedCostUsd);
  const response = await fetchImpl(`${OPENROUTER_API_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content: `${CORRECTION_PROMPT}\n\n${JSON.stringify(extraction)}` },
      ],
      temperature: 0,
      max_tokens: 8000,
      response_format: {
        type: "json_schema",
        json_schema: { name: JSON_SCHEMA_NAME, strict: true, schema: extractionJsonSchema },
      },
      provider: { only: [providerSlug], allow_fallbacks: false, require_parameters: true },
      usage: { include: true },
    }),
  });

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { cost?: number };
  };
  // Même discipline que l'extraction : le coût est imputé avant tout jugement, et un coût illisible
  // arrête le harnais plutôt que de laisser filer une dépense non comptée.
  const reportedCost = typeof body.usage?.cost === "number" ? body.usage.cost : null;
  budget.record(reportedCost ?? maximumEstimatedCostUsd);
  if (!response.ok) {
    throw new Error(`Repasse impossible — HTTP ${response.status}.`);
  }
  if (reportedCost === null) {
    throw new HarnessError(`Repasse sans usage.cost ; ${maximumEstimatedCostUsd} USD imputé. Arrêt du harnais.`);
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch {
    // Une repasse illisible n'est pas une régression : l'extraction d'origine reste valable.
    return { value: extraction, corrections: [], costUsd: reportedCost };
  }

  return { ...mergeCorrection({ original: extraction, corrected: candidate }), costUsd: reportedCost };
}

async function main(): Promise<void> {
  const { run, model, provider } = parseNamedArguments(process.argv.slice(2));
  if (!run || !model || !provider) {
    throw new Error("Usage : npm run correct -- --run <fichier.json> --model <id> --provider <slug>.");
  }
  const artefact = JSON.parse(await readFile(resolve(run), "utf8")) as { status: string; parsed?: unknown };
  if (artefact.status !== "success") {
    throw new Error(`L'artefact ${run} n'est pas une passe réussie (${artefact.status}).`);
  }
  const extraction = extractionSchema.parse(artefact.parsed);
  const budgetPath = resolve("spike/fixtures/runs/budget.json");
  const budget = await BudgetCounter.load({ path: budgetPath });
  const { value, corrections, costUsd } = await runCorrectionPass({
    extraction,
    model,
    providerSlug: provider,
    apiKey: requireOpenRouterApiKey(),
    budget,
    maximumEstimatedCostUsd: CORRECTION_COST_CEILING_USD,
  });
  await budget.save(budgetPath);

  const outputPath = resolve(run.replace(/\.json$/, "-corrige.json"));
  await writeFile(
    outputPath,
    `${JSON.stringify({ correctionPromptVersion: CORRECTION_PROMPT_VERSION, model, provider, costUsd, corrections, parsed: value }, null, 2)}\n`,
  );
  console.log(`${corrections.length} correction(s) retenue(s), ${costUsd} USD.`);
  corrections.forEach(({ path, from, to }) => console.log(`  ${path}\n    « ${from} »\n    « ${to} »`));
  console.log(`Écrit : ${outputPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
