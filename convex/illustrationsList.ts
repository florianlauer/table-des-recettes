import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { renditionOf, sourceOf, usableDerivative } from './lib/renditions'
import type { RenditionSlot } from './lib/renditions'
import { literalUnion } from './lib/validators'
import { beautifyStatus, recipeType } from './schema'
import {
  illustrationStageStatus,
  readIllustrationStageStatus,
} from './migrations'
import {
  BEAUTIFY_ATTEMPTS_SAMPLED,
  beautifySummary,
  summarizeBeautifyAttempts,
} from '../src/lib/beautifyStats'
import {
  configuredBeautifyIdentity,
  isCurrentBeautifyGroup,
} from '../src/lib/currentIdentity'
import {
  ILLUSTRATION_WORK_LISTED,
  boundedLimit,
} from '../src/lib/illustrationLimits'
import type { IllustrationStage } from '../src/lib/illustrationStage'

/**
 * What the photo screen reads. Split from `illustrations.ts`, which is what it writes: the two
 * halves shared the table and nothing else — no helper, no type, no invariant — and keeping them
 * apart is what lets the write side carry a lint rule forbidding a direct `ctx.db.patch` without
 * that rule having to make an exception for every read.
 */

/**
 * What derivation has to say about one slot. Three states rather than a boolean, and one report per
 * slot rather than one per row: a row shows the original **and** the candidate, so a single state
 * could not say which of the two failed — nor carry the cause this screen promises to show.
 */
const renditionReport = v.union(
  v.object({
    state: literalUnion(['ready', 'absent'] as const),
    error: v.null(),
  }),
  v.object({ state: v.literal('failed'), error: v.string() }),
)

const illustrationRow = v.object({
  id: v.id('recipes'),
  title: v.string(),
  type: recipeType,
  status: literalUnion(['review', 'published'] as const),
  hasOriginal: v.boolean(),
  hasCandidate: v.boolean(),
  // The url can be null for a blob that exists — a signing hiccup, a race with a purge. The
  // booleans above are what the buttons read, so a missing url costs a picture, never a gesture.
  originalUrl: v.union(v.string(), v.null()),
  candidateUrl: v.union(v.string(), v.null()),
  // Null when the slot holds no blob at all, so there is nothing to say about it.
  originalRendition: v.union(renditionReport, v.null()),
  candidateRendition: v.union(renditionReport, v.null()),
  // Whether the urls above point at derivatives, which is what tells the client how large a box to
  // give them. The arbitration bucket says false, the inventory buckets say true.
  thumbnails: v.boolean(),
  beautifyStatus,
  beautifiedAccepted: v.boolean(),
  noPhotoAvailable: v.boolean(),
  beautifyError: v.union(v.string(), v.null()),
  beautifyStartedAt: v.union(v.number(), v.null()),
  // When this recipe's photo work last moved, which is what the day separators group on. Falls back
  // to `_creationTime` for a recipe the stage backfill has not reached: those are still served by
  // `active`, which reads `by_beautify_status` and knows nothing about the migration.
  updatedAt: v.number(),
})

/** Every section has the same shape, so the screen renders one component five times. */
const workSection = v.object({
  // Empty when the section is collapsed: its documents are still read to produce the counter, but no
  // url is minted and nothing is sent over the wire.
  rows: v.array(illustrationRow),
  count: v.number(),
  truncated: v.boolean(),
})

function reportOf(recipe: Doc<'recipes'>, slot: RenditionSlot) {
  if (!sourceOf(recipe, slot)) return null
  const rendition = renditionOf(recipe, slot)
  if (rendition?.status === 'failed') {
    return { state: 'failed' as const, error: rendition.error }
  }
  return {
    state: usableDerivative(recipe, slot)
      ? ('ready' as const)
      : ('absent' as const),
    error: null,
  }
}

/**
 * The url for one slot. `thumbnail` is what separates the two kinds of screen this list carries:
 * arbitration needs the full plate — degrading the very image one is judging would take the function
 * away — while an inventory only needs to say *which* photo is there. The inventory therefore reuses
 * the storefront derivative and produces nothing extra.
 */
async function slotUrl(
  ctx: QueryCtx,
  recipe: Doc<'recipes'>,
  slot: RenditionSlot,
  thumbnail: boolean,
): Promise<string | null> {
  const source = sourceOf(recipe, slot)
  if (!source) return null
  const derivative = thumbnail ? usableDerivative(recipe, slot) : null
  return ctx.storage.getUrl(derivative ? derivative.storageId : source)
}

async function toRow(
  ctx: QueryCtx,
  recipe: Doc<'recipes'>,
  thumbnail: boolean,
) {
  return {
    id: recipe._id,
    title: recipe.title,
    type: recipe.type,
    status: recipe.status,
    hasOriginal: recipe.imageStorageId !== undefined,
    hasCandidate: recipe.beautifiedStorageId !== undefined,
    originalUrl: await slotUrl(ctx, recipe, 'original', thumbnail),
    candidateUrl: await slotUrl(ctx, recipe, 'beautified', thumbnail),
    originalRendition: reportOf(recipe, 'original'),
    candidateRendition: reportOf(recipe, 'beautified'),
    thumbnails: thumbnail,
    beautifyStatus: recipe.beautifyStatus,
    beautifiedAccepted: recipe.beautifiedAccepted,
    noPhotoAvailable: recipe.noPhotoAvailable ?? false,
    beautifyError: recipe.beautifyError ?? null,
    beautifyStartedAt: recipe.beautifyStartedAt ?? null,
    // The fallback is not decorative: an unmigrated recipe that is mid-generation is served by
    // `active`, and without it `updatedAt` would be `undefined` — a return-validator failure that
    // takes the whole screen down, arbitration included, for the length of the backfill.
    updatedAt: recipe.illustrationUpdatedAt ?? recipe._creationTime,
  }
}

/** The index range reads one over the cap, so a truncation is reported rather than hidden. */
function bounded(rows: Doc<'recipes'>[], limit: number) {
  return { page: rows.slice(0, limit), truncated: rows.length > limit }
}

/**
 * How much of one section to read, and whether to render it — the two questions a collapsed section
 * answers differently, resolved once.
 *
 * They used to be a single `number | null` where `null` meant "collapsed", which is why the same
 * `?? ILLUSTRATION_WORK_LISTED` fallback had to be repeated at the index range, at the page cut and at
 * the render, three places deciding the same thing.
 */
type Cap = { take: number; render: boolean }

/**
 * `null` on the wire is a folded section. It still reads its documents — the counter on a collapsed
 * `<summary>` has no other source — so it takes the default page and renders nothing.
 */
function capOf(requested: number | null): Cap {
  return requested === null
    ? { take: ILLUSTRATION_WORK_LISTED, render: false }
    : { take: boundedLimit(requested), render: true }
}

/**
 * One section, read whatever its state. `toRow` is what mints urls and drags images over the wire, so
 * a collapsed section costs its document reads and nothing else.
 */
async function sectionOf(
  ctx: QueryCtx,
  rows: Doc<'recipes'>[],
  cap: Cap,
  thumbnail: boolean,
) {
  const { page, truncated } = bounded(rows, cap.take)
  return {
    rows: cap.render
      ? await Promise.all(page.map((row) => toRow(ctx, row, thumbnail)))
      : [],
    count: page.length,
    truncated,
  }
}

/**
 * The work screen, partitioned so every recipe appears in exactly one section: `beautifyStatus !==
 * 'idle'` puts it in `active`, otherwise its `illustrationStage` decides. The exclusion lives in the
 * index range and not in a `.filter()`, because a filter runs after the scan and would make the
 * truncation this screen reports a lie.
 */
export const listIllustrationWork = query({
  args: {
    adminToken: v.string(),
    // Per-section ceiling. `null` means collapsed. Normalised server-side: `v.number()` is a float64,
    // so `NaN`, `Infinity`, negatives and decimals all cross the wire.
    limits: v.object({
      toBeautify: v.number(),
      missing: v.union(v.number(), v.null()),
      sourceHasNone: v.union(v.number(), v.null()),
      done: v.union(v.number(), v.null()),
    }),
  },
  returns: v.object({
    active: workSection,
    toBeautify: workSection,
    missing: workSection,
    sourceHasNone: workSection,
    done: workSection,
    // False until the backfill has finished. The four stage sections are then not read at all: a
    // partial work queue asks the operator to remember a banner while reading rows, and they will
    // conclude a batch is done. `active` stays whole throughout, so arbitration is never blocked.
    stagesReady: v.boolean(),
    // A single document read, from the migrations component. Counting the whole table to derive "how
    // many are off the index" would be exactly the unbounded scan the batched backfill exists to
    // avoid.
    migration: illustrationStageStatus,
  }),
  handler: async (ctx, { adminToken, limits }) => {
    requireAdmin(adminToken)
    const byStatus = (status: 'review' | 'generating' | 'failed') =>
      ctx.db
        .query('recipes')
        .withIndex('by_beautify_status', (q) => q.eq('beautifyStatus', status))
        .order('desc')
        .take(ILLUSTRATION_WORK_LISTED + 1)

    const migration = await readIllustrationStageStatus(ctx)
    const stagesReady = migration.ready

    // `toBeautify` has no folded state: it is the main flow, so its cap is always a rendering one.
    const caps = {
      toBeautify: capOf(limits.toBeautify),
      missing: capOf(limits.missing),
      sourceHasNone: capOf(limits.sourceHasNone),
      done: capOf(limits.done),
    }

    const byStage = (stage: IllustrationStage, cap: Cap) =>
      stagesReady
        ? ctx.db
            .query('recipes')
            .withIndex(
              'by_illustration_stage_and_beautify_status_and_updated_at',
              (q) =>
                q
                  .eq('illustrationStage', stage)
                  .eq('beautifyStatus', 'idle' as const),
            )
            // Descending over the third key, `illustrationUpdatedAt`: most recently touched first.
            .order('desc')
            // One over the cap, so a truncation is reported rather than silently shortening the list.
            .take(cap.take + 1)
        : Promise.resolve([])

    const [review, generating, failed, toBeautify, missing, none, done] =
      await Promise.all([
        byStatus('review'),
        byStatus('generating'),
        byStatus('failed'),
        byStage('to-beautify', caps.toBeautify),
        byStage('missing', caps.missing),
        byStage('source-has-none', caps.sourceHasNone),
        byStage('done', caps.done),
      ])

    // Waiting for arbitration first — it is work already paid for — then what is still running,
    // then what failed and can be relaunched.
    //
    // Full plates for the section one arbitrates in, thumbnails everywhere else — "À embellir"
    // included, though it is always open: measured, 50 rows × 2 full-format images ≈ 160 MB in a
    // single screen, worse than the storefront. A ~292 px thumbnail is enough to check a page is
    // legible before spending a generation.
    return {
      // Never folded, and never capped by the client: arbitration is work already paid for.
      active: await sectionOf(
        ctx,
        [...review, ...generating, ...failed],
        { take: ILLUSTRATION_WORK_LISTED, render: true },
        false,
      ),
      toBeautify: await sectionOf(ctx, toBeautify, caps.toBeautify, true),
      missing: await sectionOf(ctx, missing, caps.missing, true),
      sourceHasNone: await sectionOf(ctx, none, caps.sourceHasNone, true),
      done: await sectionOf(ctx, done, caps.done, true),
      stagesReady,
      migration,
    }
  },
})

export const beautifyStats = query({
  args: { adminToken: v.string() },
  returns: v.array(beautifySummary),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const attempts = await ctx.db
      .query('beautifyAttempts')
      .withIndex('by_created_at')
      .order('desc')
      .take(BEAUTIFY_ATTEMPTS_SAMPLED)
    // Beautification pins no provider, so several served providers of the current model may be
    // marked; the screen averages them by call count.
    const identity = configuredBeautifyIdentity()
    return summarizeBeautifyAttempts(attempts).map((group) => ({
      ...group,
      isCurrent: isCurrentBeautifyGroup(group, identity),
    }))
  },
})
