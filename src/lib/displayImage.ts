// Générique sur l'identifiant : côté Convex il s'agit d'un `Id<"_storage">` (une chaîne
// marquée), et `ctx.storage.getUrl` refuse une `string` nue. Élargir ici casserait l'appel.
export type RecipeImages<T extends string = string> = {
  imageStorageId?: T | null;
  beautifiedStorageId?: T | null;
  beautifiedAccepted?: boolean;
};

export type DisplayImage<T extends string = string> =
  | { kind: "beautified"; storageId: T }
  | { kind: "original"; storageId: T }
  | null;

export function pickDisplayImage<T extends string>(recipe: RecipeImages<T>): DisplayImage<T> {
  if (recipe.beautifiedAccepted && recipe.beautifiedStorageId) {
    return { kind: "beautified", storageId: recipe.beautifiedStorageId };
  }
  if (recipe.imageStorageId) {
    return { kind: "original", storageId: recipe.imageStorageId };
  }
  return null;
}
