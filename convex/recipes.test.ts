import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { withSearchText } from "./lib/recipeWrites";

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
    // `searchText` passe par `withSearchText`, jamais écrit à la main : une fixture
    // pré-stemmée laisserait les tests verts si la frontière d'écriture cessait de
    // normaliser les ingrédients — c'est précisément ce qu'ils doivent certifier.
    await ctx.db.insert(
      "recipes",
      withSearchText({
        ...base,
        title: "Gratin de courgettes",
        slug: "gratin-de-courgettes",
        type: "plat",
        ingredients: [{ raw: "3 courgettes" }],
      }),
    );
    await ctx.db.insert(
      "recipes",
      withSearchText({
        ...base,
        title: "Riz au lait",
        slug: "riz-au-lait",
        type: "dessert",
        ingredients: [{ raw: "200 g de riz rond" }],
      }),
    );
    await ctx.db.insert(
      "recipes",
      withSearchText({
        ...base,
        status: "review",
        title: "Brouillon non publié",
        type: "plat",
        ingredients: [{ raw: "1 courgette" }],
      }),
    );
  });
  return t;
}

test("browse exclut les brouillons", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.browse, {});
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.title)).not.toContain("Brouillon non publié");
});

test("browse filtre par type", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.browse, { type: "dessert" });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe("Riz au lait");
});

test("browse sans recherche rend quand même le champ de raison, à null", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.browse, {});
  expect(rows.every((r) => r.matchedIngredient === null)).toBe(true);
});

test("countsByType ne compte que le publié et couvre tous les types", async () => {
  const t = await withRecipes();
  const counts = await t.query(api.recipes.countsByType, {});
  expect(counts.total).toBe(2);
  expect(counts.byType.plat).toBe(1);
  expect(counts.byType.dessert).toBe(1);
  expect(counts.byType.apero).toBe(0);
  expect(counts.byType.petitDej).toBe(0);
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
  const rows = await t.query(api.recipes.browse, { query: "courgettes" });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe("Gratin de courgettes");
  expect(rows[0]?.matchedIngredient).toBeNull();
});

test("la recherche par ingrédient absent du titre expose la ligne", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert(
      "recipes",
      withSearchText({
        ...base,
        title: "Gratin du jardin",
        slug: "gratin-du-jardin",
        type: "plat",
        ingredients: [{ raw: "3 courgettes" }],
      }),
    );
  });
  // Requête au singulier contre un ingrédient au pluriel : seule l'écriture canonique
  // rend cette correspondance possible, des deux côtés de la frontière.
  const rows = await t.query(api.recipes.browse, { query: "courgette" });
  expect(rows[0]?.matchedIngredient).toBe("3 courgettes");
});

test("une recherche vide liste tout au lieu de ne rien rendre", async () => {
  const t = await withRecipes();
  expect(await t.query(api.recipes.browse, { query: "   " })).toHaveLength(2);
});

test("une recette publiée sans slug lève au lieu de dégrader", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // Seule fixture insérée hors frontière : elle fabrique volontairement l'invariant rompu.
    await ctx.db.insert("recipes", {
      ...base,
      title: "Invariant rompu",
      type: "plat",
      ingredients: [],
      searchText: "invariant rompu",
    });
  });
  await expect(t.query(api.recipes.browse, {})).rejects.toThrow(/sans slug/);
});
