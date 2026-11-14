import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { outcomeMessage } from '../lib/gestureMessages'
import { isolatedGesture } from '../lib/gestures'
import type { Gestures } from '../lib/useGestures'
import { GestureFeedback } from './-GestureFeedback'
import { IllustrationRow } from './-IllustrationRow'
import type { Row } from './-IllustrationRow'
import { recipeAnchor, toDraft } from './-RecipeForm'
import type { Draft, RecipeView } from './-RecipeForm'

/**
 * The scan's recipes before their full forms: every title, editable, and each recipe's photo gestures
 * right under it, so a scan is titled and illustrated without leaving the page. The title field types
 * into the very draft the form below edits, and saves the title alone as soon as it is left.
 */
export function ScanSummary({
  recipes,
  rows,
  edited,
  onChange,
  onRenamed,
  adminToken,
  gestures,
  now,
  estimateMs,
}: {
  recipes: readonly RecipeView[]
  /** `null` while the photo state loads: the titles do not wait for it. */
  rows: readonly Row[] | null
  edited: (recipe: RecipeView) => Draft | null
  onChange: (recipe: RecipeView, draft: Draft) => void
  /** The rename bumped the revision: whatever else the draft held has to follow it. */
  onRenamed: (recipe: RecipeView, title: string) => void
  adminToken: string
  gestures: Gestures
  now: number
  estimateMs: number | null
}) {
  const renameRecipe = useMutation(api.recipeAdmin.renameRecipe)
  const rowsById = new Map(rows?.map((row) => [row.id, row]))

  return (
    <section className="scan-page__summary">
      <h2>
        {recipes.length === 1
          ? '1 recette extraite'
          : `${recipes.length} recettes extraites`}
      </h2>
      {recipes.map((recipe) => {
        const draft = edited(recipe) ?? toDraft(recipe)
        // Isolated, not row-scoped: leaving the field is usually a tap on « Ajouter une photo » in the
        // same row, and a row lock taken on blur would swallow that tap. Nothing is lost by running
        // beside the row's other gestures: a save built on the old revision is refused server-side.
        const rename = isolatedGesture(recipe.id, 'rename')

        function saveTitle() {
          const title = draft.title.trim()
          if (title === recipe.title) return
          void gestures.run(
            rename,
            { pendingLabel: 'Enregistrement…' },
            async () => {
              const result = await renameRecipe({
                adminToken,
                recipeId: recipe.id,
                expectedRevision: recipe.revision,
                title,
              })
              if (result.ok) onRenamed(recipe, title)
              return outcomeMessage(result)
            },
          )
        }

        const heading = (titleId: string) => (
          <div className="scan-page__summary-title">
            <div className="scan-page__summary-field">
              <input
                id={titleId}
                aria-label="Titre"
                value={draft.title}
                placeholder="Sans titre"
                enterKeyHint="done"
                onChange={(event) => {
                  if (gestures.outcome(rename) !== null)
                    gestures.clearOutcomes(rename)
                  onChange(recipe, { ...draft, title: event.target.value })
                }}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              <GestureFeedback
                running={gestures.running(rename)}
                outcome={gestures.outcome(rename)}
                labelledBy={titleId}
              />
            </div>
            <a href={`#${recipeAnchor(recipe.id)}`}>Détails</a>
          </div>
        )

        const row = rowsById.get(recipe.id)
        return row ? (
          <IllustrationRow
            key={recipe.id}
            row={row}
            adminToken={adminToken}
            gestures={gestures}
            now={now}
            estimateMs={estimateMs}
            heading={heading}
          />
        ) : (
          <article key={recipe.id} className="illustrations__recipe">
            {heading(`summary-${recipe.id}`)}
          </article>
        )
      })}
    </section>
  )
}
