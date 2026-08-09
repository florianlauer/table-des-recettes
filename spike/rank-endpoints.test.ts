import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BudgetCounter } from "./budget.js";
import { buildLadder } from "./rank-endpoints.js";

const supportedParameters = ["structured_outputs", "response_format", "temperature", "max_tokens"];

// Shapes observed on the real catalogue on 2026-08-09: `tag` carries the routing slug, never
// `provider_name`; `request` is absent from all 125 vision+strict models and `image` from 100 of them.
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

describe("endpoint ranking", () => {
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

  function mockCatalogue(endpoints: unknown[], modelIds: string[] = ["author/model"]) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/models")) {
        return Response.json({
          data: modelIds.map((id) => ({ id, architecture: { input_modalities: ["image"] } })),
        });
      }
      if (url.endsWith("/endpoints")) {
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

  it("routes on the slug from `tag` and keeps the display name for verification", async () => {
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

  // Without this rule, a missing `request` and `image` sent 100% of the catalogue into the probe
  // queue, capped at three: the ladder was born with 3 rungs instead of 123.
  it("ranks an endpoint whose `request` and `image` are absent instead of judging it uncertain", async () => {
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

  // Requiring `temperature` silently excluded every reasoning model — the whole gpt-5.6 family, 96
  // rungs — although they declare image input and structured outputs. The flag travels to the caller
  // instead, because sending the parameter to those endpoints is a 400, not a no-op.
  it("keeps an endpoint that rejects temperature and flags it", async () => {
    const { fetchImpl } = mockCatalogue([
      { ...googleEndpoint, supported_parameters: ["structured_outputs", "response_format", "max_tokens"] },
    ]);
    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl,
    });
    expect(ladder.excluded).toEqual([]);
    expect(ladder.ladder).toEqual([expect.objectContaining({ supportsTemperature: false })]);
  });

  // A reasoning endpoint spends `max_tokens` thinking before it answers — 7201 of 7992 on the
  // simplest page. The flag lets the caller cap that share instead of paying for a higher ceiling.
  it("flags an endpoint that accepts a reasoning budget", async () => {
    const { fetchImpl } = mockCatalogue([
      { ...googleEndpoint, supported_parameters: [...supportedParameters, "reasoning"] },
    ]);
    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl,
    });
    expect(ladder.ladder).toEqual([expect.objectContaining({ supportsReasoning: true })]);
  });

  it("excludes an endpoint missing a parameter the request cannot do without", async () => {
    const { fetchImpl } = mockCatalogue([
      { ...googleEndpoint, supported_parameters: ["temperature", "max_tokens"] },
    ]);
    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl,
    });
    expect(ladder.ladder).toEqual([]);
    expect(ladder.excluded).toHaveLength(1);
  });

  // A batch variant answers outside the synchronous window: left in the ladder it would only produce
  // timeouts. The real catalogue carried 22 of them, three within the first twenty rungs.
  it("discards batch variants without querying their endpoints", async () => {
    const { calls, fetchImpl } = mockCatalogue([googleEndpoint], ["author/model", "author/model:batch"]);
    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl,
    });

    expect(ladder.ladder).toHaveLength(1);
    expect(ladder.ladder[0]?.model).toBe("author/model");
    expect(ladder.excluded).toContainEqual({
      model: "author/model:batch",
      providerSlug: "tous",
      reason: "variante batch asynchrone",
    });
    expect(calls.some((url) => url.includes("model:batch"))).toBe(false);
  });

  it("drains the uncertain-price queue before freezing the ladder", async () => {
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
