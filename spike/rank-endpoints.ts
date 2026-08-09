#!/usr/bin/env node
import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BudgetCounter, PROBE_RESERVE_USD } from "./budget.js";
import { OPENROUTER_API_URL, requireOpenRouterApiKey, runVisionPass } from "./openrouter.js";
import { EXTRACTION_PROMPT } from "./prompt.js";

const REQUIRED_PARAMETERS = ["structured_outputs", "response_format", "temperature", "max_tokens"] as const;
const REPRESENTATIVE_COMPLETION_TOKENS = 2500;
const MAX_COMPLETION_TOKENS = 8000;
const MAX_UNCERTAIN_PROBES = 3;

type Pricing = { prompt: number; completion: number; image: number; request: number };

type ApiModel = {
  id?: string;
  architecture?: { input_modalities?: string[] };
  input_modalities?: string[];
};

type ApiEndpoint = {
  name?: string;
  provider_name?: string;
  provider?: string;
  tag?: string;
  supported_parameters?: string[];
  input_modalities?: string[];
  architecture?: { input_modalities?: string[] };
  pricing?: Record<string, string | number | null>;
  context_length?: number;
  data_collection?: string;
};

export type LadderEntry = {
  model: string;
  providerSlug: string;
  dataCollection: string | null;
  rankingCostUsd: number;
  maximumCallCostUsd: number;
  priceSource: "published" | "probe";
};

type UncertainEndpoint = {
  model: string;
  providerSlug: string;
  dataCollection: string | null;
  capacity: number;
};

export type LadderFile = {
  generatedAt: string;
  currency: "USD";
  ladder: LadderEntry[];
  excluded: Array<{ model: string; providerSlug: string; reason: string }>;
  notEvaluated: Array<{ model: string; providerSlug: string; reason: string }>;
};

function modalities(value: ApiModel | ApiEndpoint): string[] {
  return value.input_modalities ?? value.architecture?.input_modalities ?? [];
}

function providerSlug(endpoint: ApiEndpoint): string | null {
  return endpoint.provider_name ?? endpoint.provider ?? endpoint.tag ?? endpoint.name ?? null;
}

function parsePrice(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parsePricing(pricing: ApiEndpoint["pricing"]): Pricing | null {
  const prompt = parsePrice(pricing?.prompt);
  const completion = parsePrice(pricing?.completion);
  const image = parsePrice(pricing?.image);
  const request = parsePrice(pricing?.request);
  if (prompt === null || completion === null || image === null || request === null) {
    return null;
  }
  return { prompt, completion, image, request };
}

function cost({ pricing, completionTokens }: { pricing: Pricing; completionTokens: number }): number {
  const promptTokens = Math.ceil(EXTRACTION_PROMPT.length / 4);
  return pricing.prompt * promptTokens + pricing.image + pricing.request + pricing.completion * completionTokens;
}

async function getJson<T>({ url, apiKey, fetchImpl }: { url: string; apiKey: string; fetchImpl: typeof fetch }): Promise<T> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status} sur ${url} : ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function discoverEndpoints({
  apiKey,
  fetchImpl = fetch,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ known: LadderEntry[]; uncertain: UncertainEndpoint[]; excluded: LadderFile["excluded"] }> {
  const modelsResponse = await getJson<{ data?: ApiModel[] }>({
    url: `${OPENROUTER_API_URL}/models`,
    apiKey,
    fetchImpl,
  });
  const models = (modelsResponse.data ?? []).filter(
    (model): model is ApiModel & { id: string } => typeof model.id === "string" && modalities(model).includes("image"),
  );
  const known: LadderEntry[] = [];
  const uncertain: UncertainEndpoint[] = [];
  const excluded: LadderFile["excluded"] = [];

  for (const model of models) {
    const endpointPath = model.id.split("/").map(encodeURIComponent).join("/");
    const endpointsResponse = await getJson<{ data?: { endpoints?: ApiEndpoint[] } | ApiEndpoint[] }>({
      url: `${OPENROUTER_API_URL}/models/${endpointPath}/endpoints`,
      apiKey,
      fetchImpl,
    });
    const data = endpointsResponse.data;
    const endpoints = Array.isArray(data) ? data : data?.endpoints ?? [];
    for (const endpoint of endpoints) {
      const slug = providerSlug(endpoint);
      if (!slug) {
        excluded.push({ model: model.id, providerSlug: "inconnu", reason: "providerSlug absent" });
        continue;
      }
      const supportsImage = modalities(endpoint).includes("image") || modalities(model).includes("image");
      const parameters = new Set(endpoint.supported_parameters ?? []);
      const supportsRequest = REQUIRED_PARAMETERS.every((parameter) => parameters.has(parameter));
      if (!supportsImage || !supportsRequest) {
        excluded.push({ model: model.id, providerSlug: slug, reason: "modalité image ou paramètres stricts absents" });
        continue;
      }
      const dataCollection = endpoint.data_collection ?? null;
      const pricing = parsePricing(endpoint.pricing);
      if (!pricing) {
        uncertain.push({
          model: model.id,
          providerSlug: slug,
          dataCollection,
          capacity: endpoint.context_length ?? 0,
        });
        continue;
      }
      known.push({
        model: model.id,
        providerSlug: slug,
        dataCollection,
        rankingCostUsd: cost({ pricing, completionTokens: REPRESENTATIVE_COMPLETION_TOKENS }),
        maximumCallCostUsd: cost({ pricing, completionTokens: MAX_COMPLETION_TOKENS }),
        priceSource: "published",
      });
    }
  }
  return { known, uncertain, excluded };
}

export async function buildLadder({
  apiKey,
  probeImagePath,
  budget,
  fetchImpl = fetch,
  onCostRecorded = async () => undefined,
}: {
  apiKey: string;
  probeImagePath: string;
  budget: BudgetCounter;
  fetchImpl?: typeof fetch;
  onCostRecorded?: () => Promise<void>;
}): Promise<LadderFile> {
  const { known, uncertain, excluded } = await discoverEndpoints({ apiKey, fetchImpl });
  const notEvaluated: LadderFile["notEvaluated"] = [];
  const queue = [...uncertain].sort((left, right) => right.capacity - left.capacity);
  const worstCaseBeforePaidCalls = known.reduce(
    (sum, endpoint) => sum + endpoint.maximumCallCostUsd * 24,
    Math.min(MAX_UNCERTAIN_PROBES, queue.length) * PROBE_RESERVE_USD,
  );
  console.log(`Budget pire cas avant le premier appel payant : ${worstCaseBeforePaidCalls.toFixed(6)} USD.`);

  for (const [index, endpoint] of queue.entries()) {
    if (index >= MAX_UNCERTAIN_PROBES) {
      notEvaluated.push({ ...endpoint, reason: "file de trois sondes déjà pleine" });
      continue;
    }
    try {
      budget.assertCanProbe();
    } catch (error) {
      notEvaluated.push({ ...endpoint, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const result = await runVisionPass({
      model: endpoint.model,
      providerSlug: endpoint.providerSlug,
      imagePath: probeImagePath,
      apiKey,
      budget,
      maximumEstimatedCostUsd: PROBE_RESERVE_USD,
      dataCollection: endpoint.dataCollection,
      maxTokens: 512,
      fetchImpl,
      onCostRecorded,
    });
    if (result.status !== "success") {
      notEvaluated.push({ ...endpoint, reason: `sonde impossible : ${result.detail}` });
      continue;
    }
    if (result.actualCostUsd > PROBE_RESERVE_USD) {
      excluded.push({ ...endpoint, reason: `sonde ${result.actualCostUsd} USD > réserve ${PROBE_RESERVE_USD} USD` });
      continue;
    }
    // Le total observé borne le poste illisible sans le convertir artificiellement en zéro.
    known.push({
      model: endpoint.model,
      providerSlug: endpoint.providerSlug,
      dataCollection: endpoint.dataCollection,
      rankingCostUsd: result.actualCostUsd,
      maximumCallCostUsd: result.actualCostUsd * (MAX_COMPLETION_TOKENS / 512),
      priceSource: "probe",
    });
  }

  known.sort((left, right) => left.rankingCostUsd - right.rankingCostUsd);
  return { generatedAt: new Date().toISOString(), currency: "USD", ladder: known, excluded, notEvaluated };
}

async function main(): Promise<void> {
  const apiKey = requireOpenRouterApiKey();
  const budgetPath = resolve("spike/fixtures/runs/budget.json");
  const budget = await BudgetCounter.load({ path: budgetPath });
  const probeImagePath = resolve("spike/fixtures/pages/a.jpg");
  await mkdir(resolve("spike/fixtures/runs"), { recursive: true });
  const result = await buildLadder({
    apiKey,
    probeImagePath,
    budget,
    onCostRecorded: () => budget.save(budgetPath),
  });
  await budget.save(budgetPath);
  const date = result.generatedAt.slice(0, 10);
  const outputPath = resolve(`spike/ladder.${date}.json`);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  const worstCase = result.ladder.reduce((sum, endpoint) => sum + endpoint.maximumCallCostUsd * 24, 0) +
    Math.min(MAX_UNCERTAIN_PROBES, result.notEvaluated.length) * PROBE_RESERVE_USD;
  console.log(`Budget pire cas avant escalade : ${worstCase.toFixed(6)} USD ; dépensé : ${budget.spent.toFixed(6)} USD.`);
  console.table(result.ladder.slice(0, 10));
  console.log(`Échelle figée : ${outputPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
