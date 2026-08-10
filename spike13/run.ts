#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import { BudgetCounter } from "./budget.js";
import { LADDER, modelSlug } from "./models.js";
import { renderImage, requireOpenRouterApiKey, type RenderResult } from "./openrouter.js";
import { PROMPT_VERSION } from "./prompt.js";

// Two framings, kept apart on purpose: `recadre*` is cropped on the dish before ingestion, `brut*`
// keeps the wide shot with the neighbouring text column. A model that passes on one and fails on the
// other tells us whether T14 needs a crop step at upload; a single mixed batch would not.
export const DISHES = ["recadre1", "recadre2", "brut1", "brut2"] as const;
export const RENDERS_DIRECTORY = "spike13/fixtures/renders";
export const BUDGET_PATH = "spike13/fixtures/budget.json";

export type Cell = { model: string; dish: string; pass: 1 | 2 };

export function buildGrid(dishes: readonly string[]): Cell[] {
  return LADDER.flatMap((rung) =>
    dishes.flatMap((dish) => [
      { model: rung.model, dish, pass: 1 as const },
      { model: rung.model, dish, pass: 2 as const },
    ]),
  );
}

export type CellFilters = { dishes: string[]; passes: number[]; models: string[] };

// `buildGrid` orders model -> dish -> pass, so "the first four cells" is one model on two dishes,
// never four models on one dish. Screening the ladder on a single dish therefore needs an explicit
// filter, not a slice. Empty array means "no filter on that axis".
export function parseCellFilters(argv: readonly string[]): CellFilters {
  const dishes: string[] = [];
  const passes: number[] = [];
  const models: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--dish" && value !== undefined) {
      dishes.push(value);
      index += 1;
    } else if (flag === "--pass" && value !== undefined) {
      passes.push(Number(value));
      index += 1;
    } else if (flag === "--model" && value !== undefined) {
      models.push(value);
      index += 1;
    }
  }
  return { dishes, passes, models };
}

// A typo would otherwise select nothing and read as "everything already done" — a silent no-op on a
// command whose whole point is to spend money deliberately.
export function assertKnownFilters({ dishes, passes, models }: CellFilters): void {
  for (const dish of dishes) {
    if (!(DISHES as readonly string[]).includes(dish)) {
      throw new Error(`Plat inconnu : ${dish}. Attendus : ${DISHES.join(", ")}.`);
    }
  }
  for (const pass of passes) {
    if (pass !== 1 && pass !== 2) {
      throw new Error(`Passe inconnue : ${pass}. Attendues : 1 ou 2.`);
    }
  }
  for (const model of models) {
    if (!LADDER.some((rung) => rung.model === model)) {
      throw new Error(`Modèle hors échelle : ${model}. Attendus : ${LADDER.map((rung) => rung.model).join(", ")}.`);
    }
  }
}

export function selectCells({ cells, dishes, passes, models }: { cells: Cell[] } & CellFilters): Cell[] {
  return cells.filter(
    (cell) =>
      (dishes.length === 0 || dishes.includes(cell.dish)) &&
      (passes.length === 0 || passes.includes(cell.pass)) &&
      (models.length === 0 || models.includes(cell.model)),
  );
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// The prompt version is part of the path, not just of the sidecar: a v2 run must sit next to its v1
// render so the two can be compared, and `alreadyDone` must not read a v1 render as closing a v2
// cell. Without it a rewrite silently overwrites the evidence it is meant to be judged against.
export function renderStem({
  model,
  dish,
  pass,
  promptVersion,
}: {
  model: string;
  dish: string;
  pass: number;
  promptVersion: string;
}): string {
  return `${RENDERS_DIRECTORY}/${modelSlug(model)}/${dish}-${pass}-${promptVersion}`;
}

export function renderPath({
  model,
  dish,
  pass,
  mediaType,
  promptVersion = PROMPT_VERSION,
}: {
  model: string;
  dish: string;
  pass: number;
  mediaType: string;
  promptVersion?: string;
}): string {
  return `${renderStem({ model, dish, pass, promptVersion })}.${EXTENSIONS[mediaType] ?? "bin"}`;
}

export function sidecarPath({
  model,
  dish,
  pass,
  promptVersion = PROMPT_VERSION,
}: {
  model: string;
  dish: string;
  pass: number;
  promptVersion?: string;
}): string {
  return `${renderStem({ model, dish, pass, promptVersion })}.json`;
}

// Only a conclusive outcome closes a cell. `image` and `failure` are answers about the model, so
// rerunning must not re-spend on them — a "refusal" is a result, not an accident. `inconclusive` is
// the opposite: a timeout or a 429 says nothing about the model. Counting it as done would drop the
// cell from the grid for good while the log printed "déjà fait", and an untested model would read as
// covered. Observed on 2026-08-10: gpt-5.4-image-2 aborted at the 180s timeout.
export function isConclusive(status: string): boolean {
  return status === "image" || status === "failure";
}

async function alreadyDone(cell: Cell): Promise<boolean> {
  try {
    const sidecar = JSON.parse(await readFile(sidecarPath(cell), "utf8")) as { status?: unknown };
    return typeof sidecar.status === "string" && isConclusive(sidecar.status);
  } catch {
    return false;
  }
}

async function writeOutcome({ cell, result }: { cell: Cell; result: RenderResult }): Promise<void> {
  const directory = `${RENDERS_DIRECTORY}/${modelSlug(cell.model)}`;
  await mkdir(directory, { recursive: true });

  if (result.status === "image") {
    await writeFile(renderPath({ ...cell, mediaType: result.mediaType }), Buffer.from(result.base64, "base64"));
  }

  const sidecar = {
    model: cell.model,
    dish: cell.dish,
    pass: cell.pass,
    promptVersion: PROMPT_VERSION,
    status: result.status,
    reason: "reason" in result ? result.reason : null,
    detail: "detail" in result ? result.detail : null,
    mediaType: result.status === "image" ? result.mediaType : null,
    latencyMs: Math.round(result.latencyMs),
    actualCostUsd: result.actualCostUsd,
  };
  await writeFile(sidecarPath(cell), `${JSON.stringify(sidecar, null, 2)}\n`);
}

async function main(): Promise<void> {
  const apiKey = requireOpenRouterApiKey();
  const budget = await BudgetCounter.load({ path: BUDGET_PATH });
  const filters = parseCellFilters(process.argv.slice(2));
  assertKnownFilters(filters);
  const grid = selectCells({ cells: buildGrid(DISHES), ...filters });
  const costByModel = new Map(LADDER.map((rung) => [rung.model, rung.maxCostUsdPerCall]));

  const hasFilter = filters.dishes.length > 0 || filters.passes.length > 0 || filters.models.length > 0;
  const scope = hasFilter
    ? `filtre ${filters.dishes.join("+") || "tous plats"} / passe ${filters.passes.join("+") || "1+2"} / ` +
      `${filters.models.join("+") || "tous modèles"}`
    : "grille entière";
  console.log(
    `${scope} · prompt ${PROMPT_VERSION} : ${grid.length} cellules · ` +
      `déjà dépensé ${budget.spent.toFixed(4)} USD / ${budget.cap} USD.`,
  );

  for (const cell of grid) {
    if (await alreadyDone(cell)) {
      console.log(`− ${cell.model} ${cell.dish} passe ${cell.pass} : déjà fait, non rappelé.`);
      continue;
    }

    const maxCostUsd = costByModel.get(cell.model);
    if (maxCostUsd === undefined) throw new Error(`Modèle hors échelle : ${cell.model}.`);

    const result = await renderImage({
      model: cell.model,
      imagePath: resolve("spike13/fixtures/dishes", `${cell.dish}.jpg`),
      apiKey,
      budget,
      maxCostUsd,
    });

    // Saved after every call, not at the end: a crash mid-grid must not lose the spending record.
    await budget.save(BUDGET_PATH);
    await writeOutcome({ cell, result });

    const suffix = result.status === "image" ? "" : ` (${"reason" in result ? result.reason : "?"})`;
    console.log(
      `→ ${cell.model} ${cell.dish} passe ${cell.pass} : ${result.status}${suffix} · ` +
        `${result.actualCostUsd.toFixed(5)} USD · ${Math.round(result.latencyMs)} ms`,
    );
  }

  console.log(`Terminé. Dépense totale : ${budget.spent.toFixed(4)} USD. Lance « npm run review13 ».`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
