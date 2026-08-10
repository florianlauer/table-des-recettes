import { describe, expect, it } from "vitest";

import { BudgetCounter } from "./budget.js";
import { decodeImageResponse, renderImage, requireOpenRouterApiKey } from "./openrouter.js";

const PIXEL = "iVBORw0KGgoAAAANSUhEUg==";

function responseWithImage() {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: { content: "", images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL}` } }] },
      },
    ],
    usage: { cost: 0.03 },
  };
}

describe("decodeImageResponse", () => {
  it("pulls the image and its media type out of the data URI", () => {
    const decoded = decodeImageResponse(responseWithImage());
    expect(decoded).toEqual({ status: "image", mediaType: "image/png", base64: PIXEL });
  });

  it("reports a refusal as its own outcome, not as a missing image", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "stop", message: { refusal: "I can't help with that." } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "refusal" });
  });

  it("reports a truncated generation as its own outcome", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "length", message: { content: "" } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "truncation" });
  });

  it("reports a text-only answer and keeps the text as the detail", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "stop", message: { content: "Voici une description du plat." } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "no_image" });
    expect(decoded).toHaveProperty("detail", expect.stringContaining("description du plat"));
  });

  it("fails loudly on an unrecognised payload rather than writing an empty file", () => {
    const decoded = decodeImageResponse({ something: "else" });
    expect(decoded).toMatchObject({ status: "failure", reason: "no_image" });
  });

  it("rejects a data URI it cannot parse", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "stop", message: { images: [{ image_url: { url: "https://example.test/x.png" } }] } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "no_image" });
  });
});

describe("renderImage", () => {
  it("records the real cost reported by the API, not the estimate", async () => {
    const budget = new BudgetCounter({ cap: 10 });
    const result = await renderImage({
      model: "openai/gpt-5-image-mini",
      imagePath: new URL("./openrouter.test.ts", import.meta.url).pathname,
      apiKey: "test-key",
      budget,
      maxCostUsd: 0.5,
      fetchImpl: async () => new Response(JSON.stringify(responseWithImage()), { status: 200 }),
    });

    expect(result.status).toBe("image");
    expect(budget.spent).toBeCloseTo(0.03, 10);
  });

  it("refuses to call at all when the worst case would cross the cap", async () => {
    const budget = new BudgetCounter({ spent: 9.9, cap: 10 });
    let called = false;
    await expect(
      renderImage({
        model: "openai/gpt-5-image-mini",
        imagePath: new URL("./openrouter.test.ts", import.meta.url).pathname,
        apiKey: "test-key",
        budget,
        maxCostUsd: 0.5,
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("treats a 429 as inconclusive, not as a model failure", async () => {
    const budget = new BudgetCounter({ cap: 10 });
    const result = await renderImage({
      model: "openai/gpt-5-image-mini",
      imagePath: new URL("./openrouter.test.ts", import.meta.url).pathname,
      apiKey: "test-key",
      budget,
      maxCostUsd: 0.5,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 }),
    });

    expect(result).toMatchObject({ status: "inconclusive" });
  });
});

describe("requireOpenRouterApiKey", () => {
  it("names the missing variable instead of failing later with an opaque 401", () => {
    expect(() => requireOpenRouterApiKey({})).toThrow(/OPENROUTER_API_KEY/);
  });
});
