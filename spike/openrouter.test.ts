import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BudgetCounter } from "./budget.js";
import { HarnessError, runVisionPass } from "./openrouter.js";

const validExtraction = {
  recipes: [
    {
      title: "Soupe",
      type: "entree",
      servings: null,
      ingredients: [{ raw: "Une carotte", quantity: null, unit: null, label: null }],
      steps: ["Cuire."],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function successBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "provider-a",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validExtraction) } }],
    usage: { cost: 0.001 },
    ...overrides,
  };
}

describe("classification des appels OpenRouter", () => {
  let imagePath: string;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), "spike-t1-openrouter-"));
    imagePath = resolve(directory, "page.jpg");
    await writeFile(imagePath, "jpeg simulé");
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function execute({
    fetchImpl,
    providerSlug = "provider-a",
    budget = new BudgetCounter(),
  }: {
    fetchImpl: typeof fetch;
    providerSlug?: string;
    budget?: BudgetCounter;
  }) {
    return runVisionPass({
      model: "author/model",
      providerSlug,
      imagePath,
      apiKey: "test-key",
      budget,
      maximumEstimatedCostUsd: 0.01,
      dataCollection: null,
      fetchImpl,
      sleep: async () => undefined,
      timeoutMs: 10,
    });
  }

  it.each([
    ["429", () => jsonResponse({ error: { message: "rate limited" } }, 429)],
    ["5xx", () => jsonResponse({ error: { message: "overloaded" } }, 500)],
    ["no provider available", () => jsonResponse({ error: { message: "No provider available" } }, 400)],
    ["timeout", () => Promise.reject(new DOMException("timed out", "AbortError"))],
  ])("rejoue %s trois fois puis classe la passe inconclusive", async (_label, responseFactory) => {
    const fetchMock = vi.fn(responseFactory) as unknown as typeof fetch;
    const result = await execute({ fetchImpl: fetchMock });
    expect(result.status).toBe("inconclusive");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["refus", successBody({ choices: [{ finish_reason: "stop", message: { refusal: "non" } }] }), "refusal"],
    ["troncature", successBody({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }), "truncation"],
    ["Zod invalide", successBody({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }), "invalid_schema"],
  ])("classe %s en échec sans retry", async (_label, body, reason) => {
    const fetchMock = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
    const result = await execute({ fetchImpl: fetchMock });
    expect(result).toMatchObject({ status: "failure", reason });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "structured outputs is not supported by this provider"],
    [404, "model not supporting the requested modality: image"],
    [422, "unsupported parameter: response_format"],
  ])("classe un refus de capacité HTTP %s en échec d'échelon sans retry", async (status, message) => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message } }, status)) as unknown as typeof fetch;
    await expect(execute({ fetchImpl: fetchMock })).resolves.toMatchObject({
      status: "failure",
      reason: "unsupported_request",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("arrête le harnais sans coût mais conserve l'imputation", async () => {
    const body = successBody();
    delete (body.usage as Record<string, unknown>).cost;
    const fetchMock = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
    const budget = new BudgetCounter();
    await expect(execute({ fetchImpl: fetchMock, budget })).rejects.toThrow(HarnessError);
    expect(budget.spent).toBe(0.01);
  });

  it("accepte le display name correspondant au slug normalisé", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(successBody({ provider: "DeepInfra" }))) as unknown as typeof fetch;
    await expect(execute({ fetchImpl: fetchMock, providerSlug: "deepinfra" })).resolves.toMatchObject({ status: "success" });
  });

  it("arrête le harnais pour un provider réellement différent après avoir compté le coût", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(successBody({ provider: "Together AI" }))) as unknown as typeof fetch;
    const budget = new BudgetCounter();
    await expect(execute({ fetchImpl: fetchMock, providerSlug: "deepinfra", budget })).rejects.toThrow(HarnessError);
    expect(budget.spent).toBe(0.001);
  });

  it.each([
    [401, "unauthorized"],
    [400, "invalid request payload"],
  ])("arrête le harnais sur une erreur HTTP %s imputable au setup ou ambiguë", async (status, message) => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message } }, status)) as unknown as typeof fetch;
    await expect(execute({ fetchImpl: fetchMock })).rejects.toThrow(HarnessError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
