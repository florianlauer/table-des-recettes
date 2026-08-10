import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { withSearchText } from './lib/recipeWrites'
import { resolveSlugCollision, slugify } from '../src/lib/slug'

const RECIPES = [
  {
    title: 'Clafoutis aux cerises',
    type: 'dessert' as const,
    servings: 6,
    ingredients: [
      { raw: '500 g de cerises', quantity: 500, unit: 'g', label: 'cerises' },
      { raw: '100 g de farine', quantity: 100, unit: 'g', label: 'farine' },
      { raw: '3 œufs', quantity: 3, label: 'œufs' },
      { raw: 'une pincée de sel' },
    ],
    steps: [
      'Préchauffer le four à 180 °C.',
      'Dénoyauter les cerises et les répartir dans un plat beurré.',
      "Mélanger la farine, les œufs et le sel jusqu'à obtenir une pâte lisse.",
      'Verser sur les cerises et enfourner 40 minutes.',
    ],
  },
  {
    title: 'Crème de potiron',
    type: 'entree' as const,
    servings: 4,
    ingredients: [
      { raw: '800 g de potiron', quantity: 800, unit: 'g', label: 'potiron' },
      { raw: '1 oignon', quantity: 1, label: 'oignon' },
      { raw: '20 cl de crème', quantity: 20, unit: 'cl', label: 'crème' },
    ],
    steps: [
      'Éplucher et couper le potiron en cubes.',
      "Faire revenir l'oignon émincé, ajouter le potiron et couvrir d'eau.",
      'Cuire 25 minutes, mixer, ajouter la crème.',
    ],
  },
  {
    title: 'Crêpes de sarrasin',
    type: 'plat' as const,
    servings: 4,
    ingredients: [
      {
        raw: '250 g de farine de sarrasin',
        quantity: 250,
        unit: 'g',
        label: 'farine de sarrasin',
      },
      { raw: "1,5 L d'eau", quantity: 1.5, unit: 'L', label: 'eau' },
      { raw: '2 à 3 pincées de gros sel' },
    ],
    steps: [
      'Mélanger la farine et le sel.',
      "Verser l'eau progressivement en fouettant.",
      'Laisser reposer deux heures avant de cuire sur une galetière très chaude.',
    ],
  },
  {
    title: 'Gratin dauphinois',
    type: 'plat' as const,
    servings: 6,
    ingredients: [
      {
        raw: '1,2 kg de pommes de terre',
        quantity: 1.2,
        unit: 'kg',
        label: 'pommes de terre',
      },
      {
        raw: '50 cl de crème liquide',
        quantity: 50,
        unit: 'cl',
        label: 'crème liquide',
      },
      { raw: "1 gousse d'ail", quantity: 1, label: "gousse d'ail" },
      { raw: 'noix de muscade' },
    ],
    steps: [
      "Frotter le plat à l'ail.",
      'Émincer les pommes de terre finement, les disposer en couches.',
      'Couvrir de crème, râper la muscade, cuire 1 h 15 à 160 °C.',
    ],
  },
  {
    // Task 9's verification table searches for "courgette" against the real deployment:
    // without this recipe the check cannot pass.
    title: 'Tian de courgettes',
    type: 'plat' as const,
    servings: 4,
    ingredients: [
      { raw: '4 courgettes', quantity: 4, label: 'courgettes' },
      { raw: '3 tomates', quantity: 3, label: 'tomates' },
      { raw: "2 gousses d'ail", quantity: 2, label: "gousses d'ail" },
      { raw: "huile d'olive" },
      { raw: 'thym' },
    ],
    steps: [
      'Émincer les courgettes et les tomates en rondelles fines.',
      "Les ranger debout en alternance dans un plat frotté à l'ail.",
      "Arroser d'huile d'olive, parsemer de thym, cuire 45 minutes à 180 °C.",
    ],
  },
  {
    title: 'Gaufres de Liège',
    type: 'dessert' as const,
    servings: 8,
    ingredients: [
      { raw: '300 g de farine', quantity: 300, unit: 'g', label: 'farine' },
      {
        raw: '150 g de sucre perlé',
        quantity: 150,
        unit: 'g',
        label: 'sucre perlé',
      },
      { raw: '2 œufs', quantity: 2, label: 'œufs' },
    ],
    steps: [
      'Pétrir la pâte.',
      'Incorporer le sucre perlé.',
      'Cuire au gaufrier 4 minutes.',
    ],
  },
  {
    title: 'Œufs mimosa',
    type: 'apero' as const,
    servings: 4,
    ingredients: [
      { raw: '6 œufs', quantity: 6, label: 'œufs' },
      {
        raw: '3 cuillères à soupe de mayonnaise',
        quantity: 3,
        unit: 'cuillère à soupe',
        label: 'mayonnaise',
      },
      { raw: 'ciboulette' },
    ],
    steps: [
      'Cuire les œufs 10 minutes.',
      'Écraser les jaunes avec la mayonnaise.',
      'Garnir et parsemer de ciboulette.',
    ],
  },
  {
    title: 'Poulet basquaise',
    type: 'plat' as const,
    servings: 4,
    ingredients: [
      { raw: '4 cuisses de poulet', quantity: 4, label: 'cuisses de poulet' },
      { raw: '3 poivrons', quantity: 3, label: 'poivrons' },
      {
        raw: '400 g de tomates concassées',
        quantity: 400,
        unit: 'g',
        label: 'tomates concassées',
      },
      { raw: "piment d'Espelette" },
    ],
    steps: [
      'Colorer les cuisses de poulet dans une cocotte.',
      'Ajouter les poivrons émincés et les tomates.',
      'Mijoter 45 minutes à couvert, relever au piment.',
    ],
  },
  {
    title: 'Riz au lait vanillé',
    type: 'dessert' as const,
    servings: 4,
    ingredients: [
      { raw: '200 g de riz rond', quantity: 200, unit: 'g', label: 'riz rond' },
      {
        raw: '1 L de lait entier',
        quantity: 1,
        unit: 'L',
        label: 'lait entier',
      },
      { raw: '1 gousse de vanille', quantity: 1, label: 'gousse de vanille' },
    ],
    steps: [
      'Fendre la gousse et infuser dans le lait.',
      'Verser le riz et cuire 35 minutes à feu doux en remuant.',
    ],
  },
  {
    title: 'Salade de lentilles au comté',
    type: 'entree' as const,
    servings: 4,
    ingredients: [
      {
        raw: '250 g de lentilles vertes',
        quantity: 250,
        unit: 'g',
        label: 'lentilles vertes',
      },
      { raw: '150 g de comté', quantity: 150, unit: 'g', label: 'comté' },
      { raw: '1 échalote', quantity: 1, label: 'échalote' },
    ],
    steps: [
      'Cuire les lentilles 20 minutes.',
      "Détailler le comté en dés, ciseler l'échalote.",
      'Assaisonner tiède.',
    ],
  },
  {
    title: 'Tarte fine aux poireaux et à la crème de moutarde ancienne',
    type: 'plat' as const,
    servings: 6,
    ingredients: [
      { raw: '1 pâte feuilletée', quantity: 1, label: 'pâte feuilletée' },
      { raw: '6 poireaux', quantity: 6, label: 'poireaux' },
      {
        raw: "2 cuillères à soupe de moutarde à l'ancienne",
        quantity: 2,
        unit: 'cuillère à soupe',
        label: "moutarde à l'ancienne",
      },
    ],
    steps: [
      'Émincer et fondre les poireaux 20 minutes.',
      'Étaler la pâte, tartiner de moutarde, garnir.',
      'Cuire 25 minutes à 200 °C.',
    ],
  },
  {
    title: 'Tartiflette',
    type: 'plat' as const,
    ingredients: [
      { raw: '1 reblochon' },
      {
        raw: '1 kg de pommes de terre',
        quantity: 1,
        unit: 'kg',
        label: 'pommes de terre',
      },
      { raw: '200 g de lardons', quantity: 200, unit: 'g', label: 'lardons' },
    ],
    steps: [
      "Cuire les pommes de terre à l'eau.",
      'Faire revenir les lardons et les oignons.',
      'Couvrir du reblochon fendu, gratiner 25 minutes.',
    ],
  },
  {
    title: '4 saisons express',
    type: 'autre' as const,
    servings: 2,
    ingredients: [{ raw: 'ce qui reste dans le réfrigérateur' }],
    steps: ['Assembler.', 'Assaisonner.'],
  },
]

export const run = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // The guard is a deployment environment variable, not an argument: an argument travels in
    // a copy-pasted command and proves nothing about the backend actually targeted. Set once,
    // on the development deployment:
    //   npx convex env set ALLOW_DESTRUCTIVE_SEED true
    if (process.env.ALLOW_DESTRUCTIVE_SEED !== 'true') {
      throw new Error(
        'Seed refusé : ALLOW_DESTRUCTIVE_SEED n\'est pas à "true" sur ce déploiement.',
      )
    }

    const existing = await ctx.db.query('recipes').collect()
    for (const row of existing) {
      // Delete the files before the documents, otherwise they stay orphaned in storage with
      // no reference left to find them again.
      if (row.imageStorageId) await ctx.storage.delete(row.imageStorageId)
      if (row.beautifiedStorageId)
        await ctx.storage.delete(row.beautifiedStorageId)
      await ctx.db.delete(row._id)
    }

    const slugs: string[] = []
    for (const recipe of RECIPES) {
      const slug = resolveSlugCollision(slugify(recipe.title), slugs)
      slugs.push(slug)
      await ctx.db.insert('recipes', {
        ...withSearchText(recipe),
        slug,
        status: 'published',
        publishedAt: Date.now(),
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      })
    }
    return null
  },
})
