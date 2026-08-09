import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * `attach` remplace puis supprime une image. Être interne ne protège de rien ici : la CLI
 * s'authentifie en administrateur, et une variable d'environnement mal pointée suffirait à
 * détruire les photos d'un déploiement réel. Le déploiement doit donc se déclarer lui-même.
 */
function assertDevDeployment() {
  if (process.env.ALLOW_DEV_IMAGES !== "true") {
    throw new Error(
      'ALLOW_DEV_IMAGES n\'est pas "true" sur ce déploiement : refus d\'écrire des images de développement.',
    );
  }
}

export const generateUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    assertDevDeployment();
    return ctx.storage.generateUploadUrl();
  },
});

export const attach = internalMutation({
  args: { slug: v.string(), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { slug, storageId }) => {
    assertDevDeployment();
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!doc) {
      // Le fichier est déjà dans le stockage : sans ce nettoyage il resterait orphelin,
      // sans plus aucune référence pour le retrouver.
      await ctx.storage.delete(storageId);
      throw new Error(`Recette introuvable : ${slug}`);
    }
    // Une réexécution du script remplacerait le pointeur en laissant l'ancien fichier derrière.
    if (doc.imageStorageId) await ctx.storage.delete(doc.imageStorageId);
    await ctx.db.patch(doc._id, { imageStorageId: storageId });
    return null;
  },
});

/**
 * Filet du script : si `attach` échoue après l'upload — panne CLI, slug mal orthographié,
 * interruption — le blob est déjà stocké et plus personne ne connaît son identifiant.
 */
export const discardOrphan = internalMutation({
  args: { slug: v.string(), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { slug, storageId }) => {
    assertDevDeployment();
    // `attach` peut avoir été validée par Convex alors que la CLI a perdu la réponse et
    // rendu un échec : le `trap` du script appellerait alors ce nettoyage sur un fichier
    // désormais référencé, et casserait la recette qu'on voulait servir. La vérification
    // et la suppression tiennent dans la même mutation, donc rien ne s'intercale entre
    // les deux. Le slug suffit à trancher — pas besoin d'un index sur `imageStorageId`
    // dans le schéma de production pour un besoin de développement.
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (doc?.imageStorageId === storageId) return null;
    await ctx.storage.delete(storageId);
    return null;
  },
});
