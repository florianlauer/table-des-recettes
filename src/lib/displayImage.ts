// Generic over the id: on the Convex side it is an `Id<"_storage">` (a branded string),
// and `ctx.storage.getUrl` rejects a bare `string`. Widening here would break the call.
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
