import { readFileSync, existsSync } from "node:fs";

const ROOT = "/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/spike-t1-extraction";
const PAGES = ["a", "b", "c", "e", "f", "g", "h"];

// The reference is what we judged by eye and accepted; every cheap model is measured against it.
const MODELS = [
  ["google/gemini-3-flash-preview", "google-ai-studio", "référence"],
  ["google/gemini-2.5-flash-lite", "google-ai-studio", ""],
  ["openai/gpt-5.6-luna", "openai", ""],
  ["mistralai/ministral-8b-2512", "mistral", ""],
  ["qwen/qwen3.5-9b", "siliconflow", "17 t/s"],
  ["qwen/qwen3.5-35b-a3b", "deepinfra", "106 t/s"],
  ["qwen/qwen3-vl-32b-instruct", "alibaba", "53 t/s, vision"],
  ["qwen/qwen3.6-flash", "alibaba", "53 t/s"],
];

const load = (model, provider, page, pass) => {
  const path = `${ROOT}/spike/fixtures/runs/${model}/${provider}/${page}-${pass}.json`;
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};

const shape = (extraction) =>
  extraction.recipes.map((r) => `${r.ingredients.length}i/${r.steps.length}e`).join(" ");

for (const [model, provider, note] of MODELS) {
  const rows = [];
  let cost = 0;
  let latency = 0;
  let calls = 0;
  let failures = 0;
  let repairs = 0;
  let unstable = 0;
  for (const page of PAGES) {
    const one = load(model, provider, page, 1);
    const two = load(model, provider, page, 2);
    if (!one) continue;
    calls += 2;
    cost += (one.actualCostUsd ?? 0) + (two?.actualCostUsd ?? 0);
    latency += (one.latencyMs ?? 0) + (two?.latencyMs ?? 0);
    if (one.status !== "success") {
      failures += 1;
      rows.push(`  ${page.toUpperCase()}  ÉCHEC ${one.reason ?? ""} ${(one.detail ?? "").slice(0, 70)}`);
      continue;
    }
    repairs += (one.repairs?.length ?? 0) + (two?.repairs?.length ?? 0);
    const same = two?.status === "success" && JSON.stringify(one.parsed) === JSON.stringify(two.parsed);
    if (!same) unstable += 1;
    rows.push(
      `  ${page.toUpperCase()}  ${(one.latencyMs / 1000).toFixed(1)}s  ${one.parsed.recipes.length} rec  ${shape(one.parsed)}${same ? "" : "   PASSES DIVERGENTES"}`,
    );
  }
  console.log(`\n=== ${model} @ ${provider} ${note}`);
  if (!rows.length) {
    console.log("  aucun artefact");
    continue;
  }
  console.log(rows.join("\n"));
  console.log(
    `  total ${cost.toFixed(6)} $ · ${(latency / calls / 1000).toFixed(1)} s/appel · ${failures} échec(s) · ${repairs} réparation(s) · ${unstable} page(s) instable(s)`,
  );
}
