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
    // `searchText` goes through `withSearchText`, never written by hand: a pre-stemmed fixture
    // would keep these tests green if the write boundary stopped normalising ingredients —
    // which is exactly what they are supposed to certify.
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

test("browse excludes drafts", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.browse, {});
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.title)).not.toContain("Brouillon non publié");
});

test("browse filters by type", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.browse, { type: "dessert" });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe("Riz au lait");
});

test("browse without a query still returns the reason field, as null", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.browse, {});
  expect(rows.every((r) => r.matchedIngredient === null)).toBe(true);
});

test("countsByType counts only published recipes and covers every type", async () => {
  const t = await withRecipes();
  const counts = await t.query(api.recipes.countsByType, {});
  expect(counts.total).toBe(2);
  expect(counts.byType.plat).toBe(1);
  expect(counts.byType.dessert).toBe(1);
  expect(counts.byType.apero).toBe(0);
  expect(counts.byType.petitDej).toBe(0);
});

test("getBySlug returns the published recipe", async () => {
  const t = await withRecipes();
  const recipe = await t.query(api.recipes.getBySlug, { slug: "riz-au-lait" });
  expect(recipe?.title).toBe("Riz au lait");
});

test("getBySlug returns null for an unknown slug", async () => {
  const t = await withRecipes();
  expect(await t.query(api.recipes.getBySlug, { slug: "inexistant" })).toBeNull();
});

test("a plural query finds the indexed singular, and the title is explanation enough", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.browse, { query: "courgettes" });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe("Gratin de courgettes");
  expect(rows[0]?.matchedIngredient).toBeNull();
});

test("searching an ingredient absent from the title surfaces that line", async () => {
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
  // Singular query against a plural ingredient: only the canonical write makes this match
  // possible, on both sides of the boundary.
  const rows = await t.query(api.recipes.browse, { query: "courgette" });
  expect(rows[0]?.matchedIngredient).toBe("3 courgettes");
});

test("an empty query lists everything instead of returning nothing", async () => {
  const t = await withRecipes();
  expect(await t.query(api.recipes.browse, { query: "   " })).toHaveLength(2);
});

test("a published recipe without a slug throws instead of degrading", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // The only fixture inserted outside the boundary: it deliberately builds the broken invariant.
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
