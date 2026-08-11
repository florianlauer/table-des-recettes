import type { BackupRecipe } from './backup-schema'

export const completeBackupRecipe: BackupRecipe = {
  id: 'jd7abc123',
  creationTime: 1_723_000_000_000,
  title: 'Crème brûlée',
  type: 'dessert',
  servings: 4,
  ingredients: [
    { raw: '4 jaunes d’œufs', quantity: 4, unit: null, label: 'jaunes' },
  ],
  ingredientsInferred: false,
  steps: ['Mélanger.'],
  status: 'published',
  slug: 'creme-brulee',
  publishedAt: 1_723_000_100_000,
  imageStorageId: 'kg2image',
  beautifiedStorageId: 'kg2beautified',
}
