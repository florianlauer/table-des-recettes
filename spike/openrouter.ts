import { readFile } from "node:fs/promises";

import { extractionSchema, type Extraction, RECIPE_SCHEMA_VERSION } from "../src/lib/recipe-schema.js";
import { type BudgetCounter } from "./budget.js";
import { extractionJsonSchema, JSON_SCHEMA_NAME } from "./json-schema.js";
import { EXTRACTION_PROMPT, PROMPT_VERSION } from "./prompt.js";

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
export const MAX_OUTPUT_TOKENS = 8000;
export const REQUEST_TIMEOUT_MS = 120_000;
export const MAX_ATTEMPTS = 3;

type Fetch = typeof fetch;

type OpenRouterResponse = {
  provider?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
  [key: string]: unknown;
};

export type PassSuccess = {
  status: "success";
  parsed: Extraction;
  raw: OpenRouterResponse;
  attempts: number;
  latencyMs: number;
  actualCostUsd: number;
  servedProvider: string;
};

export type PassFailure = {
  status: "failure";
  reason: "refusal" | "truncation" | "invalid_schema" | "unsupported_request";
  detail: string;
  raw?: OpenRouterResponse;
  attempts: number;
  latencyMs: number;
  actualCostUsd: number;
};

export type PassInconclusive = {
  status: "inconclusive";
  reason: "transient_error";
  detail: string;
  attempts: number;
  latencyMs: number;
  actualCostUsd: number;
};

export type PassResult = PassSuccess | PassFailure | PassInconclusive;

export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessError";
  }
}

export function requireOpenRouterApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY manque. Créez .env avec une clé OpenRouter valide avant tout appel payant.");
  }
  return key;
}

function isTransientMessage(message: string): boolean {
  return /no provider available|rate.?limit|temporar|timeout|timed out|overloaded/i.test(message);
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isUnsupportedRequest({ status, message }: { status: number; message: string }): boolean {
  if (![400, 404, 422].includes(status)) return false;
  const namesCapability = /structured[\s_-]*outputs?|response[\s_-]*format|json[\s_-]*schema|parameter|image|vision|modality/i.test(
    message,
  );
  const rejectsCapability =
    /not support(?:ed|ing)?|isn['’]?t supported|does not support|doesn['’]?t support|unsupported|cannot support|can['’]?t support|unknown parameter|invalid parameter/i.test(
      message,
    );
  return namesCapability && rejectsCapability;
}

function actualCost(raw: OpenRouterResponse): number | null {
  return typeof raw.usage?.cost === "number" && Number.isFinite(raw.usage.cost) ? raw.usage.cost : null;
}

export function normalizeProviderIdentifier(provider: string): string {
  return provider.toLocaleLowerCase("en").replace(/[\s_-]/g, "");
}

export async function runVisionPass({
  model,
  providerSlug,
  providerName,
  imagePath,
  apiKey,
  budget,
  maximumEstimatedCostUsd,
  dataCollection,
  maxTokens = MAX_OUTPUT_TOKENS,
  fetchImpl = fetch,
  sleep = (milliseconds: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  timeoutMs = REQUEST_TIMEOUT_MS,
  onCostRecorded = async () => undefined,
}: {
  model: string;
  providerSlug: string;
  // La réponse renvoie le nom d'affichage ("Google"), jamais le slug de routage ("google-vertex").
  providerName: string;
  imagePath: string;
  apiKey: string;
  budget: BudgetCounter;
  maximumEstimatedCostUsd: number;
  dataCollection: string | null;
  maxTokens?: number;
  fetchImpl?: Fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  onCostRecorded?: () => Promise<void>;
}): Promise<PassResult> {
  const image = await readFile(imagePath);
  const contentType = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const startedAt = performance.now();
  let totalCost = 0;
  let lastTransient = "Erreur transitoire inconnue";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    budget.assertCanSpend(maximumEstimatedCostUsd);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${OPENROUTER_API_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: EXTRACTION_PROMPT },
                { type: "image_url", image_url: { url: `data:${contentType};base64,${image.toString("base64")}` } },
              ],
            },
          ],
          temperature: 0,
          max_tokens: maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: { name: JSON_SCHEMA_NAME, strict: true, schema: extractionJsonSchema },
          },
          provider: { only: [providerSlug], allow_fallbacks: false, require_parameters: true },
          usage: { include: true },
        }),
      });
      const responseText = await response.text();
      let raw: OpenRouterResponse;
      try {
        raw = JSON.parse(responseText) as OpenRouterResponse;
      } catch {
        raw = { error: { message: responseText || `HTTP ${response.status}` } };
      }
      const errorMessage = raw.error?.message ?? responseText;
      if (!response.ok) {
        const reportedCost = actualCost(raw);
        if (reportedCost !== null) {
          budget.record(reportedCost);
          totalCost += reportedCost;
          await onCostRecorded();
        }
        if (isTransientStatus(response.status) || isTransientMessage(errorMessage)) {
          lastTransient = `HTTP ${response.status}: ${errorMessage}`;
          if (attempt < MAX_ATTEMPTS) {
            await sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          break;
        }
        if (isUnsupportedRequest({ status: response.status, message: errorMessage })) {
          return {
            status: "failure",
            reason: "unsupported_request",
            detail: `HTTP ${response.status}: ${errorMessage}`,
            raw,
            attempts: attempt,
            latencyMs: performance.now() - startedAt,
            actualCostUsd: totalCost,
          };
        }
        throw new HarnessError(`Erreur OpenRouter non évaluable — HTTP ${response.status}: ${errorMessage}`);
      }

      const reportedCost = actualCost(raw);
      const cost = reportedCost ?? maximumEstimatedCostUsd;
      budget.record(cost);
      totalCost += cost;
      await onCostRecorded();
      if (reportedCost === null) {
        throw new HarnessError(`usage.cost absent ; ${maximumEstimatedCostUsd} USD imputé par prudence. Arrêt du harnais.`);
      }

      const choice = raw.choices?.[0];
      if (choice?.message?.refusal) {
        return {
          status: "failure",
          reason: "refusal",
          detail: choice.message.refusal,
          raw,
          attempts: attempt,
          latencyMs: performance.now() - startedAt,
          actualCostUsd: totalCost,
        };
      }
      if (choice?.finish_reason !== "stop") {
        return {
          status: "failure",
          reason: "truncation",
          detail: `finish_reason=${String(choice?.finish_reason)}`,
          raw,
          attempts: attempt,
          latencyMs: performance.now() - startedAt,
          actualCostUsd: totalCost,
        };
      }
      if (
        typeof raw.provider !== "string" ||
        normalizeProviderIdentifier(raw.provider) !== normalizeProviderIdentifier(providerName)
      ) {
        throw new HarnessError(
          `Provider demandé ${providerSlug} (${providerName}), servi ${String(raw.provider)}. Arrêt du harnais.`,
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(choice.message?.content ?? "");
      } catch (error) {
        return {
          status: "failure",
          reason: "invalid_schema",
          detail: `JSON invalide : ${String(error)}`,
          raw,
          attempts: attempt,
          latencyMs: performance.now() - startedAt,
          actualCostUsd: totalCost,
        };
      }
      const validated = extractionSchema.safeParse(parsedJson);
      if (!validated.success) {
        return {
          status: "failure",
          reason: "invalid_schema",
          detail: validated.error.message,
          raw,
          attempts: attempt,
          latencyMs: performance.now() - startedAt,
          actualCostUsd: totalCost,
        };
      }
      return {
        status: "success",
        parsed: validated.data,
        raw,
        attempts: attempt,
        latencyMs: performance.now() - startedAt,
        actualCostUsd: totalCost,
        servedProvider: raw.provider,
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
        lastTransient = message;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        break;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    status: "inconclusive",
    reason: "transient_error",
    detail: lastTransient,
    attempts: MAX_ATTEMPTS,
    latencyMs: performance.now() - startedAt,
    actualCostUsd: totalCost,
  };
}

export function serializeRun({ result, model, providerSlug, page, pass, dataCollection }: {
  result: PassResult;
  model: string;
  providerSlug: string;
  page: string;
  pass: number;
  dataCollection: string | null;
}): Record<string, unknown> {
  return {
    model,
    requestedProvider: providerSlug,
    page,
    pass,
    promptVersion: PROMPT_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    dataCollection,
    ...result,
  };
}
