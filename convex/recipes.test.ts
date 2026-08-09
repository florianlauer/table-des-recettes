import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const base = {
  status: "published" as const,
  publishedAt: 1,
  beautifiedAccepted: false,
  beautifyStatus: "idle" as const,
  steps: ["Étape unique."],
};

async function withRecipes() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("recipes", {
      ...base,
      title: "Gratin de courgettes",
      slug: "gratin-de-courgettes",
      type: "plat",
      ingredients: [{ raw: "3 courgettes" }],
      searchText: "gratin de courgette 3 courgette",
    });
    await ctx.db.insert("recipes", {
      ...base,
      title: "Riz au lait",
      slug: "riz-au-lait",
      type: "dessert",
      ingredients: [{ raw: "200 g de riz rond" }],
      searchText: "riz au lait 200 g de riz rond",
    });
    await ctx.db.insert("recipes", {
      ...base,
      status: "review",
      title: "Brouillon non publié",
      type: "plat",
      ingredients: [{ raw: "1 courgette" }],
      searchText: "brouillon non publie 1 courgette",
    });
  });
  return t;
}

test("listPublished exclut les brouillons", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.listPublished, {});
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.title)).not.toContain("Brouillon non publié");
});

test("listPublished filtre par type", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.listPublished, { type: "dessert" });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe("Riz au lait");
});

test("countsByType ne compte que le publié", async () => {
  const t = await withRecipes();
  const counts = await t.query(api.recipes.countsByType, {});
  expect(counts.total).toBe(2);
  expect(counts.byType.plat).toBe(1);
  expect(counts.byType.dessert).toBe(1);
});

test("getBySlug rend la recette publiée", async () => {
  const t = await withRecipes();
  const recipe = await t.query(api.recipes.getBySlug, { slug: "riz-au-lait" });
  expect(recipe?.title).toBe("Riz au lait");
});

test("getBySlug rend null sur un slug inconnu", async () => {
  const t = await withRecipes();
  expect(await t.query(api.recipes.getBySlug, { slug: "inexistant" })).toBeNull();
});

test("le pluriel de la requête trouve le singulier indexé, et le titre suffit à expliquer", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.search, { query: "courgettes" });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe("Gratin de courgettes");
  expect(rows[0]?.matchedIngredient).toBeNull();
});

test("la recherche par ingrédient absent du titre expose la ligne", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("recipes", {
      ...base,
      title: "Gratin du jardin",
      slug: "gratin-du-jardin",
      type: "plat",
      ingredients: [{ raw: "3 courgettes" }],
      searchText: "gratin du jardin 3 courgette",
    });
  });
  const rows = await t.query(api.recipes.search, { query: "courgette" });
  expect(rows[0]?.matchedIngredient).toBe("3 courgettes");
});

test("une recherche vide ne rend rien", async () => {
  const t = await withRecipes();
  expect(await t.query(api.recipes.search, { query: "   " })).toEqual([]);
});

test("une recette publiée sans slug lève au lieu de dégrader", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("recipes", {
      ...base,
      title: "Invariant rompu",
      type: "plat",
      ingredients: [],
      searchText: "invariant rompu",
    });
  });
  await expect(t.query(api.recipes.listPublished, {})).rejects.toThrow(/sans slug/);
});
