import { describe, expect, test } from 'vite-plus/test'
import type { Id } from '../../convex/_generated/dataModel'
import { carryOverRename, publicationReport } from './admin_.scan.$id'
import { toDraft } from './-RecipeForm'
import type { RecipeView } from './-RecipeForm'

describe('publication report', () => {
  test('names every draft publication refused, and why', () => {
    // The refusals used to be phrased inside the action and then overwritten by the generic
    // success message, so the operator was told "Fait." and never learnt what stayed behind.
    expect(
      publicationReport({
        published: 2,
        refused: [
          { title: 'Tarte aux pommes', error: 'pas de titre publiable' },
          { title: '', error: 'les images du scan ont changé' },
        ],
      }),
    ).toBe(
      '2 publiées. Refusées : Tarte aux pommes (pas de titre publiable) · sans titre (les images du scan ont changé)',
    )
  })

  test('stays silent about refusals when there are none', () => {
    expect(publicationReport({ published: 3, refused: [] })).toBe('3 publiées.')
  })
})

describe('renaming from the summary', () => {
  const recipe: RecipeView = {
    id: 'r1' as Id<'recipes'>,
    title: 'Crêpes',
    type: 'dessert',
    servings: 4,
    ingredients: [],
    ingredientsInferred: false,
    steps: ['Cuire.'],
    status: 'review',
    slug: null,
    revision: 3,
    duplicateOf: null,
  }

  test('moves the form’s other corrections onto the revision the rename produces', () => {
    const draft = {
      ...toDraft(recipe),
      title: 'Galettes',
      steps: 'Cuire.\nServir.',
    }
    const edits = carryOverRename(
      { r1: { revision: 3, draft } },
      recipe,
      'Galettes',
    )
    expect(edits.r1).toEqual({ revision: 4, draft })
  })

  test('lets a draft that only held the title lapse', () => {
    const edits = {
      r1: { revision: 3, draft: { ...toDraft(recipe), title: 'Galettes ' } },
    }
    expect(carryOverRename(edits, recipe, 'Galettes')).toBe(edits)
  })
})
