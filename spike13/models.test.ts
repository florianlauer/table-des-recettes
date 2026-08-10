import { describe, expect, it } from "vitest";

import { BEAUTIFY_MODEL, LADDER, modelSlug } from "./models.js";
import { PROMPT_V3, PROMPT_VERSION, RESTORATION_PROMPT } from "./prompt.js";

describe("LADDER", () => {
  it("covers the four cheapest image-output models, the scope arbitrated for this spike", () => {
    expect(LADDER).toHaveLength(4);
  });

  it("excludes the -preview duplicates and the auto routers", () => {
    const models = LADDER.map((rung) => rung.model);
    expect(models.some((model) => model.includes("preview"))).toBe(false);
    expect(models.some((model) => model.startsWith("openrouter/auto"))).toBe(false);
  });

  it("leaves out the three expensive rungs, which is what keeps the grid around one dollar", () => {
    const models = LADDER.map((rung) => rung.model);
    expect(models).not.toContain("google/gemini-3-pro-image");
    expect(models).not.toContain("google/gemini-3.1-flash-image");
    expect(models).not.toContain("openai/gpt-5-image");
  });

  it("is sorted cheapest first, so the results table reads as a ladder", () => {
    const costs = LADDER.map((rung) => rung.maxCostUsdPerCall);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it("caps every call above its catalogue rate, so the budget guard is never optimistic", () => {
    for (const rung of LADDER) {
      expect(rung.maxCostUsdPerCall).toBeGreaterThan(rung.imageOutputUsdPerToken * 1000);
    }
  });

  // Regression on a real overshoot: the first ceiling budgeted $0.016 for a gpt-5-image-mini call
  // that billed $0.0525, because that family emits reasoning tokens on top of the image.
  it("covers the highest per-image cost actually observed, not the one an image alone would cost", () => {
    const MEASURED_WORST_USD = 0.0525;
    const mini = LADDER.find((rung) => rung.model === "openai/gpt-5-image-mini");
    expect(mini?.maxCostUsdPerCall).toBeGreaterThan(MEASURED_WORST_USD);
  });

  it("keeps the whole grid affordable: 4 models x 4 dishes x 2 passes under the 10 USD cap", () => {
    const worstCase = LADDER.reduce((total, rung) => total + rung.maxCostUsdPerCall * 8, 0);
    expect(worstCase).toBeLessThan(10);
  });
});

describe("BEAUTIFY_MODEL", () => {
  it("names a model the spike actually measured, so T14 cannot be configured with an untested id", () => {
    expect(LADDER.some((rung) => rung.model === BEAUTIFY_MODEL)).toBe(true);
  });
});

describe("modelSlug", () => {
  it("turns a model id into a single path segment", () => {
    expect(modelSlug("google/gemini-2.5-flash-image")).toBe("google__gemini-2.5-flash-image");
  });
});

describe("RESTORATION_PROMPT", () => {
  it("is versioned, so a render can always be traced back to the wording that produced it", () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+$/);
  });

  // v1 never asked for the printed text to go, so a wide shot kept its neighbouring column. That
  // defect is what earned the single rewrite, so the demand has to be in the wording.
  it("demands that no printed character survives, the defect v1 left on the wide shots", () => {
    expect(RESTORATION_PROMPT).toMatch(/aucun\s+caractère\s+imprimé/i);
  });

  it("keeps recognisability as the floor, since barrier 2 no longer asks for pixel fidelity", () => {
    expect(RESTORATION_PROMPT).toMatch(/reconnaissable/i);
  });

  it("asks for a straight frame, the defect that later earned the v3 fallback", () => {
    expect(RESTORATION_PROMPT).toMatch(/cadrer droit|parfaitement droit/i);
  });
});

// v3 is measured but not active. It is kept so T14 has a priced alternative to switch to if tilted
// frames show up in real use; a test guards the wording that is its whole reason to exist.
describe("PROMPT_V3, the documented fallback", () => {
  it("states the upright requirement on its own rather than as a clause in a list", () => {
    expect(PROMPT_V3).toMatch(/parfaitement droit/i);
    expect(PROMPT_V3).toMatch(/aucune inclinaison/i);
  });

  it("is not the active prompt", () => {
    expect(RESTORATION_PROMPT).not.toBe(PROMPT_V3);
    expect(PROMPT_VERSION).toBe("v2");
  });
});
