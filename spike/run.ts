#!/usr/bin/env node
import "dotenv/config";

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BudgetCounter } from "./budget.js";
import { type LadderEntry, type LadderFile } from "./rank-endpoints.js";
import { requireOpenRouterApiKey, runVisionPass, serializeRun } from "./openrouter.js";

export function parseNamedArguments(argumentsList: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Arguments attendus : --model <id> --provider <slug>.");
    }
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

async function latestLadder(): Promise<LadderFile> {
  const entries = (await readdir("spike"))
    .filter((entry) => /^ladder\.\d{4}-\d{2}-\d{2}\.json$/.test(entry))
    .sort();
  const latest = entries.at(-1);
  if (!latest) {
    throw new Error("Aucune échelle figée. Exécutez d'abord npm run rank.");
  }
  return JSON.parse(await readFile(resolve("spike", latest), "utf8")) as LadderFile;
}

function endpointFromLadder({ ladder, model, providerSlug }: { ladder: LadderFile; model: string; providerSlug: string }): LadderEntry {
  const endpoint = ladder.ladder.find((entry) => entry.model === model && entry.providerSlug === providerSlug);
  if (!endpoint) {
    throw new Error(`Couple ${model} / ${providerSlug} absent de l'échelle figée.`);
  }
  return endpoint;
}

function safePathPart(value: string): string {
  if (value === "." || value === ".." || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error(`Segment de chemin interdit : ${value}.`);
  }
  return value;
}

export async function runEscalationEndpoint({
  endpoint,
  apiKey,
  budget,
  budgetPath,
  pages = ["a", "b", "c"],
}: {
  endpoint: LadderEntry;
  apiKey: string;
  budget: BudgetCounter;
  budgetPath: string;
  pages?: string[];
}): Promise<void> {
  const modelPath = safePathPart(endpoint.model);
  const providerPath = safePathPart(endpoint.providerSlug);
  const outputDirectory = resolve("spike/fixtures/runs", modelPath, providerPath);
  await mkdir(outputDirectory, { recursive: true });
  console.log(`Budget pire cas de l'échelon : ${(endpoint.maximumCallCostUsd * 18).toFixed(6)} USD.`);

  for (const page of pages) {
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
      });
      await budget.save(budgetPath);
      const outputPath = resolve(outputDirectory, `${page}-${pass}.json`);
      await writeFile(
        outputPath,
        `${JSON.stringify(serializeRun({
          result,
          model: endpoint.model,
          providerSlug: endpoint.providerSlug,
          page,
          pass,
          dataCollection: endpoint.dataCollection,
        }), null, 2)}\n`,
      );
      console.log(`${page.toUpperCase()} passe ${pass} : ${result.status} (${result.attempts} tentative(s)).`);
    }
  }
}

async function main(): Promise<void> {
  const { model, provider } = parseNamedArguments(process.argv.slice(2));
  if (!model || !provider) {
    throw new Error("Usage : npm run run:spike -- --model <id> --provider <slug>.");
  }
  const apiKey = requireOpenRouterApiKey();
  const ladder = await latestLadder();
  const endpoint = endpointFromLadder({ ladder, model, providerSlug: provider });
  const budgetPath = resolve("spike/fixtures/runs/budget.json");
  const budget = await BudgetCounter.load({ path: budgetPath });
  await mkdir(resolve(budgetPath, ".."), { recursive: true });
  await runEscalationEndpoint({ endpoint, apiKey, budget, budgetPath });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
