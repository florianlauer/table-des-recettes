import { readFile } from "node:fs/promises";

import { type BudgetCounter } from "./budget.js";
import { RESTORATION_PROMPT } from "./prompt.js";

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
// Image generation is slow and uneven: gpt-5-image-mini took 78s on 2026-08-10 while
// gemini-3.1-flash-lite-image took 4s, and gpt-5.4-image-2 aborted at a 180s ceiling. A timeout
// yields no data at all, so the ceiling is generous — it bounds a hang, it does not pace the grid.
export const REQUEST_TIMEOUT_MS = 300_000;

type Fetch = typeof fetch;

export type OpenRouterImageResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      images?: Array<{ type?: string; image_url?: { url?: string } }>;
    };
  }>;
  usage?: { cost?: number };
  error?: { message?: string };
  [key: string]: unknown;
};

export type DecodedImage = { status: "image"; mediaType: string; base64: string };
export type DecodeFailure = { status: "failure"; reason: "refusal" | "truncation" | "no_image"; detail: string };

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

export function decodeImageResponse(raw: OpenRouterImageResponse): DecodedImage | DecodeFailure {
  const choice = raw.choices?.[0];
  const refusal = choice?.message?.refusal;
  if (typeof refusal === "string" && refusal.length > 0) {
    return { status: "failure", reason: "refusal", detail: refusal };
  }

  const url = choice?.message?.images?.[0]?.image_url?.url;
  if (typeof url === "string") {
    const match = DATA_URI.exec(url);
    if (match?.[1] && match[2]) {
      return { status: "image", mediaType: match[1], base64: match[2] };
    }
    return { status: "failure", reason: "no_image", detail: `URL d'image non décodable : ${url.slice(0, 120)}` };
  }

  // Truncation is only checked once no image was returned: a model that emitted its image and then
  // ran out of tokens on trailing text has still done the job.
  if (choice?.finish_reason === "length") {
    return { status: "failure", reason: "truncation", detail: "finish_reason=length sans image." };
  }

  const text = choice?.message?.content;
  return {
    status: "failure",
    reason: "no_image",
    detail:
      typeof text === "string" && text.length > 0
        ? `Réponse en texte, sans image : ${text.slice(0, 300)}`
        : `Aucune image dans la réponse : ${JSON.stringify(raw).slice(0, 300)}`,
  };
}

export type RenderSuccess = DecodedImage & { latencyMs: number; actualCostUsd: number; raw: OpenRouterImageResponse };
export type RenderFailure = DecodeFailure & { latencyMs: number; actualCostUsd: number; raw: OpenRouterImageResponse };
export type RenderInconclusive = {
  status: "inconclusive";
  reason: "transient_error";
  detail: string;
  latencyMs: number;
  actualCostUsd: number;
};
export type RenderResult = RenderSuccess | RenderFailure | RenderInconclusive;

export function requireOpenRouterApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY manque. Renseigne .env avec une clé OpenRouter avant tout appel payant.");
  }
  return key;
}

function isTransient({ status, message }: { status: number; message: string }): boolean {
  return status === 429 || status >= 500 || /rate.?limit|temporar|timeout|timed out|overloaded/i.test(message);
}

export async function renderImage({
  model,
  imagePath,
  apiKey,
  budget,
  maxCostUsd,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  model: string;
  imagePath: string;
  apiKey: string;
  budget: BudgetCounter;
  maxCostUsd: number;
  fetchImpl?: Fetch;
  timeoutMs?: number;
}): Promise<RenderResult> {
  // Throws before any network call when the worst case would cross the cap: the guard is the point.
  budget.assertCanSpend(maxCostUsd);

  const image = await readFile(imagePath);
  const startedAt = performance.now();
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
              { type: "text", text: RESTORATION_PROMPT },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
            ],
          },
        ],
        // Without this, an image-capable model answers in text.
        modalities: ["image", "text"],
        usage: { include: true },
      }),
    });

    const responseText = await response.text();
    let raw: OpenRouterImageResponse;
    try {
      raw = JSON.parse(responseText) as OpenRouterImageResponse;
    } catch {
      raw = { error: { message: responseText || `HTTP ${response.status}` } };
    }

    const latencyMs = performance.now() - startedAt;
    const cost = typeof raw.usage?.cost === "number" && Number.isFinite(raw.usage.cost) ? raw.usage.cost : 0;
    if (cost > 0) budget.record(cost);

    if (!response.ok) {
      const message = raw.error?.message ?? responseText;
      if (isTransient({ status: response.status, message })) {
        return {
          status: "inconclusive",
          reason: "transient_error",
          detail: `HTTP ${response.status}: ${message}`,
          latencyMs,
          actualCostUsd: cost,
        };
      }
      return {
        status: "failure",
        reason: "no_image",
        detail: `HTTP ${response.status}: ${message}`,
        latencyMs,
        actualCostUsd: cost,
        raw,
      };
    }

    const decoded = decodeImageResponse(raw);
    return { ...decoded, latencyMs, actualCostUsd: cost, raw };
  } catch (error) {
    return {
      status: "inconclusive",
      reason: "transient_error",
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: performance.now() - startedAt,
      actualCostUsd: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
