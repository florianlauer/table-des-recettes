import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BudgetCounter } from "./budget.js";
import { buildLadder } from "./rank-endpoints.js";

const supportedParameters = ["structured_outputs", "response_format", "temperature", "max_tokens"];

// Formes relevées sur le catalogue réel le 2026-08-09 : `tag` porte le slug de routage, jamais
// `provider_name` ; `request` est absent des 125 modèles vision+strict et `image` de 100 d'entre eux.
const googleEndpoint = {
  provider_name: "Google",
  tag: "google-vertex/global",
  supported_parameters: supportedParameters,
  pricing: { prompt: "0.0000015", completion: "0.0000075", image: "0.0000015" },
  data_collection: "deny",
};

const noImageRateEndpoint = {
  provider_name: "Mistral",
  tag: "mistral",
  supported_parameters: supportedParameters,
  pricing: { prompt: "0.0000001", completion: "0.0000001" },
  data_collection: "deny",
};

const uncertainEndpoint = {
  provider_name: "Uncertain",
  tag: "uncertain",
  supported_parameters: supportedParameters,
  pricing: { prompt: null, completion: null },
  context_length: 100_000,
  data_collection: "allow",
};

describe("classement des endpoints", () => {
  let directory: string;
  let imagePath: string;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), "spike-t1-ranking-"));
    imagePath = resolve(directory, "a.jpg");
    await writeFile(imagePath, "jpeg simulé");
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function mockCatalogue(endpoints: unknown[]) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/models")) {
        return Response.json({ data: [{ id: "author/model", architecture: { input_modalities: ["image"] } }] });
      }
      if (url.endsWith("/models/author/model/endpoints")) {
        return Response.json({ data: { endpoints } });
      }
      return Response.json({
        provider: "Uncertain",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ recipes: [] }) } }],
        usage: { cost: 0.0001 },
      });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("route sur le slug de `tag` et retient le nom d'affichage pour la vérification", async () => {
    const { fetchImpl } = mockCatalogue([googleEndpoint]);
    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl,
    });
    expect(ladder.ladder).toEqual([
      expect.objectContaining({ providerSlug: "google-vertex", providerName: "Google", priceSource: "published" }),
    ]);
  });

  // Sans cette règle, `request` et `image` absents envoyaient 100 % du catalogue dans la file des
  // sondes, plafonnée à trois : l'échelle naissait avec 3 barreaux au lieu de 123.
  it("classe un endpoint dont `request` et `image` sont absents plutôt que de le juger incertain", async () => {
    const { fetchImpl } = mockCatalogue([noImageRateEndpoint]);
    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl,
    });
    expect(ladder.notEvaluated).toEqual([]);
    expect(ladder.ladder).toEqual([expect.objectContaining({ providerSlug: "mistral", priceSource: "published" })]);
    expect(ladder.ladder[0]?.rankingCostUsd).toBeGreaterThan(0);
  });

  it("résorbe la file de prix incertain avant de figer l'échelle", async () => {
    const { calls, fetchImpl } = mockCatalogue([googleEndpoint, uncertainEndpoint]);
    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl,
    });

    expect(calls.at(-1)).toContain("/chat/completions");
    expect(ladder.notEvaluated).toEqual([]);
    expect(ladder.ladder).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerSlug: "google-vertex", priceSource: "published" }),
        expect.objectContaining({ providerSlug: "uncertain", priceSource: "probe" }),
      ]),
    );
  });
});
