export const RECIPE_TYPES = [
  "entree",
  "plat",
  "dessert",
  "apero",
  "petitDej",
  "autre",
] as const;

export type RecipeType = (typeof RECIPE_TYPES)[number];

/** Sur une fiche : le type de CETTE recette. Singulier. */
export const TYPE_LABELS: Record<RecipeType, string> = {
  entree: "Entrée",
  plat: "Plat",
  dessert: "Dessert",
  apero: "Apéro",
  petitDej: "Petit-déjeuner",
  autre: "Autre",
};

/** Dans la ligne de filtres : une collection. Pluriel. */
export const TYPE_FILTER_LABELS: Record<RecipeType, string> = {
  entree: "Entrées",
  plat: "Plats",
  dessert: "Desserts",
  apero: "Apéro",
  petitDej: "Petits-déjeuners",
  autre: "Autres",
};
