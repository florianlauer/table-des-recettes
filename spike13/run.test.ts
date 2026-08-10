import { describe, expect, it } from "vitest";

import {
  assertKnownFilters,
  buildGrid,
  isConclusive,
  parseCellFilters,
  renderPath,
  selectCells,
  sidecarPath,
} from "./run.js";

import { PROMPT_VERSION } from "./prompt.js";

describe("isConclusive", () => {
  it("closes a cell that produced an image", () => {
    expect(isConclusive("image")).toBe(true);
  });

  it("closes a cell the model answered with a refusal — that is a result, not an accident", () => {
    expect(isConclusive("failure")).toBe(true);
  });

  // Regression: a timed-out cell used to count as done, so the model was never retried while the
  // log said "déjà fait" — an untested model reading as covered.
  it("leaves a timed-out cell open so it gets retried", () => {
    expect(isConclusive("inconclusive")).toBe(false);
  });
});

describe("parseCellFilters", () => {
  it("returns empty axes when nothing is filtered", () => {
    expect(parseCellFilters([])).toEqual({ dishes: [], passes: [], models: [] });
  });

  it("collects repeated --dish flags", () => {
    expect(parseCellFilters(["--dish", "recadre1", "--dish", "brut2"])).toEqual({
      dishes: ["recadre1", "brut2"],
      passes: [],
      models: [],
    });
  });

  it("reads --pass as a number so it can match a cell", () => {
    expect(parseCellFilters(["--pass", "1"])).toEqual({ dishes: [], passes: [1], models: [] });
  });
});

describe("assertKnownFilters", () => {
  it("accepts a dish that exists", () => {
    expect(() => assertKnownFilters({ dishes: ["recadre1"], passes: [1], models: [] })).not.toThrow();
  });

  it("rejects a misspelled dish instead of silently selecting nothing", () => {
    expect(() => assertKnownFilters({ dishes: ["recadre3"], passes: [], models: [] })).toThrow(/Plat inconnu/);
  });

  it("rejects a pass that is neither 1 nor 2", () => {
    expect(() => assertKnownFilters({ dishes: [], passes: [3], models: [] })).toThrow(/Passe inconnue/);
  });

  it("rejects a model that is not on the ladder", () => {
    expect(() => assertKnownFilters({ dishes: [], passes: [], models: ["google/gemini-3-pro-image"] })).toThrow(
      /Modèle hors échelle/,
    );
  });
});

describe("selectCells", () => {
  it("keeps every cell when no axis is filtered", () => {
    const cells = buildGrid(["recadre1", "brut1"]);
    expect(selectCells({ cells, dishes: [], passes: [], models: [] })).toHaveLength(cells.length);
  });

  it("narrows to the named models, so an eliminated model is not paid for again", () => {
    const cells = buildGrid(["recadre1", "recadre2", "brut1", "brut2"]);
    const selected = selectCells({
      cells,
      dishes: [],
      passes: [],
      models: ["google/gemini-2.5-flash-image", "google/gemini-3.1-flash-lite-image"],
    });
    expect(selected).toHaveLength(16);
    expect(selected.every((cell) => cell.model.startsWith("google/"))).toBe(true);
  });

  it("screens the whole ladder on one dish and one pass — four cells, one per model", () => {
    const cells = buildGrid(["recadre1", "recadre2", "brut1", "brut2"]);
    const selected = selectCells({ cells, dishes: ["recadre1"], passes: [1], models: [] });
    expect(selected).toHaveLength(4);
    expect(new Set(selected.map((cell) => cell.model)).size).toBe(4);
    expect(selected.every((cell) => cell.dish === "recadre1" && cell.pass === 1)).toBe(true);
  });
});

describe("buildGrid", () => {
  it("pairs every model with every dish, twice", () => {
    expect(buildGrid(["recadre1", "recadre2", "brut1", "brut2"])).toHaveLength(32);
  });

  it("runs both passes of a cell before moving on, so a divergence shows up early", () => {
    const grid = buildGrid(["recadre1"]);
    expect(grid[0]).toMatchObject({ dish: "recadre1", pass: 1 });
    expect(grid[1]).toMatchObject({ dish: "recadre1", pass: 2 });
    expect(grid[0]?.model).toBe(grid[1]?.model);
  });

  it("starts from the cheapest model", () => {
    expect(buildGrid(["recadre1"])[0]?.model).toBe("openai/gpt-5-image-mini");
  });
});

describe("renderPath", () => {
  it("gives every render its own path, one directory per model", () => {
    expect(
      renderPath({
        model: "google/gemini-2.5-flash-image",
        dish: "recadre1",
        pass: 2,
        mediaType: "image/png",
        promptVersion: "v2",
      }),
    ).toBe("spike13/fixtures/renders/google__gemini-2.5-flash-image/recadre1-2-v2.png");
  });

  it("follows the media type the model actually returned", () => {
    expect(
      renderPath({
        model: "openai/gpt-5.4-image-2",
        dish: "brut1",
        pass: 1,
        mediaType: "image/jpeg",
        promptVersion: "v2",
      }),
    ).toBe("spike13/fixtures/renders/openai__gpt-5.4-image-2/brut1-1-v2.jpg");
  });

  // Regression: without the version in the path, replaying the grid under a rewritten prompt
  // overwrites the very renders it has to be compared against.
  it("keeps a v2 render apart from the v1 render of the same cell", () => {
    const cell = { model: "openai/gpt-5-image-mini", dish: "brut1", pass: 1, mediaType: "image/png" };
    expect(renderPath({ ...cell, promptVersion: "v1" })).not.toBe(renderPath({ ...cell, promptVersion: "v2" }));
  });

  it("defaults to the active prompt version, so a run never has to pass it", () => {
    expect(renderPath({ model: "openai/gpt-5-image-mini", dish: "brut1", pass: 1, mediaType: "image/png" })).toContain(
      `-${PROMPT_VERSION}.png`,
    );
  });
});

describe("sidecarPath", () => {
  it("sits next to the render and carries the outcome even when no image came back", () => {
    expect(sidecarPath({ model: "openai/gpt-5-image-mini", dish: "recadre1", pass: 1, promptVersion: "v1" })).toBe(
      "spike13/fixtures/renders/openai__gpt-5-image-mini/recadre1-1-v1.json",
    );
  });
});
