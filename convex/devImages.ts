import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { restaged } from './lib/recipeWrites'

/**
 * `attach` replaces and then deletes an image. Being internal protects nothing here: the CLI
 * authenticates as an admin, and a mistargeted environment variable would be enough to destroy
 * a real deployment's photos. So the deployment has to declare itself.
 */
function assertDevDeployment() {
  if (process.env.ALLOW_DEV_IMAGES !== 'true') {
    throw new Error(
      'ALLOW_DEV_IMAGES n\'est pas "true" sur ce déploiement : refus d\'écrire des images de développement.',
    )
  }
}

export const generateUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    assertDevDeployment()
    return ctx.storage.generateUploadUrl()
  },
})

export const attach = internalMutation({
  args: { slug: v.string(), storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, { slug, storageId }) => {
    assertDevDeployment()
    const doc = await ctx.db
      .query('recipes')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!doc) {
      // The file is already in storage: without this cleanup it would be orphaned, with no
      // reference left to find it again.
      await ctx.storage.delete(storageId)
      throw new Error(`Recette introuvable : ${slug}`)
    }
    // Re-running the script would swap the pointer and leave the old file behind.
    if (doc.imageStorageId) await ctx.storage.delete(doc.imageStorageId)
    await ctx.db.patch(
      doc._id,
      restaged(
        doc,
        { imageStorageId: storageId, noPhotoAvailable: false },
        Date.now(),
      ),
    )
    return null
  },
})

/**
 * Safety net for the script: if `attach` fails after the upload — CLI outage, misspelled slug,
 * interruption — the blob is already stored and nobody knows its id any more.
 */
export const discardOrphan = internalMutation({
  args: { slug: v.string(), storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, { slug, storageId }) => {
    assertDevDeployment()
    // `attach` may have been committed by Convex while the CLI lost the response and reported
    // a failure: the script's `trap` would then call this cleanup on a now-referenced file and
    // break the very recipe we wanted to serve. The check and the delete sit in the same
    // mutation, so nothing interleaves between them. The slug is enough to decide — no need for
    // an `imageStorageId` index in the production schema to serve a development need.
    const doc = await ctx.db
      .query('recipes')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (doc?.imageStorageId === storageId) return null
    await ctx.storage.delete(storageId)
    return null
  },
})
