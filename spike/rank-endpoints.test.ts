import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BudgetCounter } from "./budget.js";
import { buildLadder } from "./rank-endpoints.js";

const supportedParameters = ["structured_outputs", "response_format", "temperature", "max_tokens"];

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

  it("résorbe la file de prix incertain avant de figer l'échelle", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/models")) {
        return Response.json({ data: [{ id: "author/model", architecture: { input_modalities: ["image"] } }] });
      }
      if (url.endsWith("/models/author/model/endpoints")) {
        return Response.json({
          data: {
            endpoints: [
              {
                provider_name: "known",
                supported_parameters: supportedParameters,
                pricing: { prompt: "0.000001", completion: "0.000001", image: "0.001", request: "0" },
                data_collection: "deny",
              },
              {
                provider_name: "uncertain",
                supported_parameters: supportedParameters,
                pricing: { prompt: null, completion: null, image: null, request: null },
                context_length: 100_000,
                data_collection: "allow",
              },
            ],
          },
        });
      }
      return Response.json({
        provider: "uncertain",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ recipes: [] }) } }],
        usage: { cost: 0.0001 },
      });
    }) as unknown as typeof fetch;

    const ladder = await buildLadder({
      apiKey: "test-key",
      probeImagePath: imagePath,
      budget: new BudgetCounter(),
      fetchImpl: fetchMock,
    });

    expect(calls.at(-1)).toContain("/chat/completions");
    expect(ladder.notEvaluated).toEqual([]);
    expect(ladder.ladder).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerSlug: "known", priceSource: "published" }),
        expect.objectContaining({ providerSlug: "uncertain", priceSource: "probe" }),
      ]),
    );
  });
});
