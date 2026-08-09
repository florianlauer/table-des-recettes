#!/usr/bin/env node
import "dotenv/config";

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { extractionSchema, type Extraction } from "../src/lib/recipe-schema.js";
import { BudgetCounter } from "./budget.js";
import { requireOpenRouterApiKey, runVisionPass, serializeRun } from "./openrouter.js";
import { type LadderEntry, type LadderFile } from "./rank-endpoints.js";
import { parseNamedArguments } from "./run.js";

export const acceptanceTruthSchema = z.strictObject({
  recipes: z.array(
    z.strictObject({
      title: z.string(),
      type: z.enum(["entree", "plat", "dessert", "apero", "petitDej", "autre"]),
      servings: z.number().nullable(),
      ingredients: z.array(z.strictObject({ raw: z.string() })),
      steps: z.array(z.string()),
    }),
  ),
});

export type AcceptanceTruth = z.infer<typeof acceptanceTruthSchema>;

export type AcceptanceIssue = {
  category: string;
  recipeIndex?: number;
  detail: string;
};

export type AcceptanceClassification = {
  hardGates: AcceptanceIssue[];
  editableGaps: AcceptanceIssue[];
  humanReview: AcceptanceIssue[];
  passesHardGates: boolean;
};

export type AcceptancePassReport = {
  pass: number;
  classification: AcceptanceClassification | null;
  status: string;
};

export type AcceptanceVerdict = { accepted: boolean; exitCode: 0 | 1; line: string };

// La zone intermédiaire reste bloquante tant qu'un humain ne l'a pas explicitement arbitrée.
export const LOWER_SIMILARITY_BOUND = 0.6;
export const UPPER_SIMILARITY_BOUND = 0.85;

function normalizedText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();
}

function sameMultiset(left: string[], right: string[]): boolean {
  return [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  const distances = Array.from({ length: normalizedRight.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= normalizedLeft.length; leftIndex += 1) {
    let diagonal = distances[0] ?? 0;
    distances[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= normalizedRight.length; rightIndex += 1) {
      const above = distances[rightIndex] ?? 0;
      const insertion = (distances[rightIndex - 1] ?? 0) + 1;
      const deletion = above + 1;
      const substitution = diagonal + (normalizedLeft[leftIndex - 1] === normalizedRight[rightIndex - 1] ? 0 : 1);
      distances[rightIndex] = Math.min(insertion, deletion, substitution);
      diagonal = above;
    }
  }
  const longest = Math.max(normalizedLeft.length, normalizedRight.length, 1);
  return 1 - (distances[normalizedRight.length] ?? longest) / longest;
}

export function classifyTextDifference(left: string, right: string): "hard_gate" | "a_trancher_humain" | "editable" {
  const similarity = textSimilarity(left, right);
  if (similarity < LOWER_SIMILARITY_BOUND) return "hard_gate";
  if (similarity > UPPER_SIMILARITY_BOUND) return "editable";
  return "a_trancher_humain";
}

export function classifyAcceptance({ actual, truth }: { actual: unknown; truth: AcceptanceTruth }): AcceptanceClassification {
  const hardGates: AcceptanceIssue[] = [];
  const editableGaps: AcceptanceIssue[] = [];
  const humanReview: AcceptanceIssue[] = [];
  const validated = extractionSchema.safeParse(actual);
  if (!validated.success) {
    hardGates.push({ category: "invalid_schema", detail: validated.error.message });
    return { hardGates, editableGaps, humanReview, passesHardGates: false };
  }

  if (validated.data.recipes.length !== truth.recipes.length) {
    hardGates.push({
      category: "wrong_recipe_count",
      detail: `${validated.data.recipes.length} recette(s) extraite(s), ${truth.recipes.length} attendue(s).`,
    });
    return { hardGates, editableGaps, humanReview, passesHardGates: false };
  }

  validated.data.recipes.forEach((recipe, recipeIndex) => {
    const expected = truth.recipes[recipeIndex];
    if (!expected) return;

    if (recipe.title !== expected.title) {
      editableGaps.push({
        category: normalizedText(recipe.title) === normalizedText(expected.title) ? "title_typography" : "reformulated_title",
        recipeIndex,
        detail: `Titre « ${recipe.title} » au lieu de « ${expected.title} ».`,
      });
    }
    if (recipe.type !== expected.type) {
      editableGaps.push({ category: "wrong_type", recipeIndex, detail: `${recipe.type} au lieu de ${expected.type}.` });
    }
    if (recipe.servings !== expected.servings) {
      editableGaps.push({
        category: "wrong_servings",
        recipeIndex,
        detail: `${String(recipe.servings)} au lieu de ${String(expected.servings)}.`,
      });
    }

    if (recipe.ingredients.length < expected.ingredients.length) {
      hardGates.push({
        category: "missing_or_merged_ingredient",
        recipeIndex,
        detail: `${recipe.ingredients.length} ligne(s), ${expected.ingredients.length} attendue(s).`,
      });
    } else if (recipe.ingredients.length > expected.ingredients.length) {
      hardGates.push({
        category: "invented_ingredient",
        recipeIndex,
        detail: `${recipe.ingredients.length} ligne(s), ${expected.ingredients.length} attendue(s).`,
      });
    } else {
      recipe.ingredients.forEach(({ raw }, ingredientIndex) => {
        const expectedRaw = expected.ingredients[ingredientIndex]?.raw;
        if (expectedRaw !== undefined && raw !== expectedRaw) {
          const issue = {
            recipeIndex,
            detail: `Ligne ${ingredientIndex + 1} : « ${raw} » au lieu de « ${expectedRaw} ».`,
          };
          const difference = classifyTextDifference(raw, expectedRaw);
          if (difference === "hard_gate") {
            hardGates.push({ category: "invented_or_missing_ingredient", ...issue });
          } else if (difference === "editable") {
            editableGaps.push({ category: "ingredient_text", ...issue });
          } else {
            const uncertainIssue = { category: "a_trancher_humain", ...issue };
            hardGates.push(uncertainIssue);
            humanReview.push(uncertainIssue);
          }
        }
      });
    }

    if (recipe.steps.length !== expected.steps.length) {
      hardGates.push({
        category: "missing_step",
        recipeIndex,
        detail: `${recipe.steps.length} étape(s), ${expected.steps.length} attendue(s).`,
      });
    } else if (sameMultiset(recipe.steps, expected.steps) && recipe.steps.some((step, index) => step !== expected.steps[index])) {
      hardGates.push({ category: "out_of_order_step", recipeIndex, detail: "Les étapes sont présentes mais hors ordre." });
    } else {
      recipe.steps.forEach((step, stepIndex) => {
        const expectedStep = expected.steps[stepIndex];
        if (expectedStep !== undefined && step !== expectedStep) {
          const issue = { recipeIndex, detail: `Étape ${stepIndex + 1} : texte à corriger.` };
          const difference = classifyTextDifference(step, expectedStep);
          if (difference === "hard_gate") {
            hardGates.push({ category: "missing_step", ...issue });
          } else if (difference === "editable") {
            editableGaps.push({ category: "step_text", ...issue });
          } else {
            const uncertainIssue = { category: "a_trancher_humain", ...issue };
            hardGates.push(uncertainIssue);
            humanReview.push(uncertainIssue);
          }
        }
      });
    }
  });

  return { hardGates, editableGaps, humanReview, passesHardGates: hardGates.length === 0 };
}

export function acceptanceVerdict(reports: AcceptancePassReport[]): AcceptanceVerdict {
  const rejected = reports
    .filter(({ status, classification }) => status !== "success" || classification?.passesHardGates !== true)
    .map(({ pass, status, classification }) => {
      if (status !== "success") return `passe ${pass}: ${status}`;
      const categories = classification?.hardGates.map(({ category }) => category).join(", ") || "hard gate inconnu";
      return `passe ${pass}: ${categories}`;
    });
  if (reports.length === 2 && rejected.length === 0) {
    return { accepted: true, exitCode: 0, line: "ACCEPTÉ — les deux passes franchissent tous les hard gates." };
  }
  const reason = reports.length !== 2 ? `${reports.length} passe(s) disponible(s), 2 requises` : rejected.join(" ; ");
  return { accepted: false, exitCode: 1, line: `REJETÉ — ${reason}.` };
}

async function latestLadder(): Promise<LadderFile> {
  const filename = (await readdir("spike"))
    .filter((entry) => /^ladder\.\d{4}-\d{2}-\d{2}\.json$/.test(entry))
    .sort()
    .at(-1);
  if (!filename) throw new Error("Aucune échelle figée. Exécutez d'abord npm run rank.");
  return JSON.parse(await readFile(resolve("spike", filename), "utf8")) as LadderFile;
}

async function main(): Promise<void> {
  const { model, provider, page = "d", truth = `spike/fixtures/truth/d-acceptation.json` } = parseNamedArguments(
    process.argv.slice(2),
  );
  if (!model || !provider) {
    throw new Error("Usage : npm run accept -- --model <id> --provider <slug> [--page d] [--truth <fichier>].");
  }
  const apiKey = requireOpenRouterApiKey();
  const ladder = await latestLadder();
  const endpoint = ladder.ladder.find((entry) => entry.model === model && entry.providerSlug === provider) as LadderEntry | undefined;
  if (!endpoint) throw new Error(`Couple ${model} / ${provider} absent de l'échelle figée.`);
  let acceptedTruth: AcceptanceTruth;
  try {
    acceptedTruth = acceptanceTruthSchema.parse(JSON.parse(await readFile(resolve(truth), "utf8")));
  } catch (error) {
    throw new Error(`Vérité terrain humaine absente ou invalide (${truth}) : ${String(error)}`);
  }
  const budgetPath = resolve("spike/fixtures/runs/budget.json");
  const budget = await BudgetCounter.load({ path: budgetPath });
  const outputDirectory = resolve("spike/fixtures/runs", endpoint.model, endpoint.providerSlug, "acceptance");
  await mkdir(outputDirectory, { recursive: true });
  const report: AcceptancePassReport[] = [];

  for (const pass of [1, 2]) {
    const result = await runVisionPass({
      model: endpoint.model,
      providerSlug: endpoint.providerSlug,
      imagePath: resolve(`spike/fixtures/pages/${page}.jpg`),
      apiKey,
      budget,
      maximumEstimatedCostUsd: endpoint.maximumCallCostUsd,
      dataCollection: endpoint.dataCollection,
      onCostRecorded: () => budget.save(budgetPath),
    });
    await budget.save(budgetPath);
    await writeFile(
      resolve(outputDirectory, `${page}-${pass}.json`),
      `${JSON.stringify(serializeRun({ result, model, providerSlug: provider, page, pass, dataCollection: endpoint.dataCollection }), null, 2)}\n`,
    );
    const classification = result.status === "success" ? classifyAcceptance({ actual: result.parsed, truth: acceptedTruth }) : null;
    report.push({ pass, classification, status: result.status });
  }

  console.log(JSON.stringify({ model, provider, page, passes: report }, null, 2));
  console.log("Chronométrez maintenant les écarts éditables de la première passe et reportez T_saisie/T_correction dans RESULTS.md.");
  const verdict = acceptanceVerdict(report);
  console.log(verdict.line);
  process.exitCode = verdict.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
