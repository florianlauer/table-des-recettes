export const RECIPE_TYPES = [
  'entree',
  'plat',
  'dessert',
  'apero',
  'petitDej',
  'autre',
] as const

export type RecipeType = (typeof RECIPE_TYPES)[number]

/** On a recipe page: the type of THIS recipe. Singular. */
export const TYPE_LABELS: Record<RecipeType, string> = {
  entree: 'Entrée',
  plat: 'Plat',
  dessert: 'Dessert',
  apero: 'Apéro',
  petitDej: 'Petit-déjeuner',
  autre: 'Autre',
}

/** In the filter row: a collection. Plural. */
export const TYPE_FILTER_LABELS: Record<RecipeType, string> = {
  entree: 'Entrées',
  plat: 'Plats',
  dessert: 'Desserts',
  apero: 'Apéro',
  petitDej: 'Petits-déjeuners',
  autre: 'Autres',
}
