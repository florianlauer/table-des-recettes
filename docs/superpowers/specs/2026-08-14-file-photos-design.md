# Plan: refonte de la file de travail des photos (`/admin/illustrations`)

_Round 4 — revised by Claude after Codex round 4_

## Goal

L'écran `/admin/illustrations` range les recettes par « a-t-elle un blob original ? » alors que
l'opérateur y vient pour répondre à « qu'est-ce qu'il me reste à faire ? ». Les deux ne coïncident
pas : une recette dont la photo du livre vient d'être uploadée mais pas encore embellie a un
original, donc elle tombe dans **« Déjà illustrées »**, cachée derrière la case
`includeIllustrated` — c'est-à-dire que le flow principal (photographier une page, puis l'embellir)
est rangé dans le tiroir « c'est fini ». En parallèle, la liste « Sans photo » va grossir sans
plafond utile parce que rien ne permet de dire « cette recette n'a pas de photo dans la source, ne
me la propose plus », et rien ne permet de lire la récence d'un lot dans 50 lignes.

Ce lot rebâtit le bucketing autour de l'étape de travail réelle, ajoute un drapeau opérateur
« pas de photo dans la source », replie les sections d'inventaire, et rend la récence lisible par
des séparateurs de lot par jour.

## The partition invariant

C'est l'invariant central du lot, et tout le reste en découle. **Chaque recette apparaît dans
exactement une section :**

- `beautifyStatus !== 'idle'` → section **« À arbitrer »** (`review` | `generating` | `failed`)
- `beautifyStatus === 'idle'` → la section de son `illustrationStage`

`beautifyStatus` est total sur quatre valeurs : la première branche en couvre trois, la seconde
couvre les quatre `illustrationStage`. Disjoint et exhaustif.

**Ce que fait un document non migré**, précisément — la version courte « il n'est dans aucune
section » était fausse et masquait une panne d'écran :

- `illustrationStage === undefined` **et** `beautifyStatus !== 'idle'` → il **est** dans « À
  arbitrer ». `active` est lu par `by_beautify_status`, qui ne touche pas au stage : la migration ne
  le soustrait pas. C'est correct — une génération en cours reste du travail à arbitrer — mais sa
  ligne n'a pas de `illustrationUpdatedAt`, donc le mapper doit lire
  `illustrationUpdatedAt ?? _creationTime` sous peine de faire échouer le validateur de retour
  (`updatedAt: v.number()`) et de casser **tout** l'écran pendant la fenêtre de migration.
- `illustrationStage === undefined` **et** `beautifyStatus === 'idle'` → il n'est dans aucune
  section. C'est ce que le bandeau annonce, et c'est aussi pourquoi les quatre sections d'étape sont
  désactivées tant que la migration n'est pas `done` (§4).

Sans cet invariant, le rebucketing introduit un doublon visible : une recette `review` avec un
original a le stage `to-beautify`, donc elle s'afficherait à la fois dans « À arbitrer » et dans
« À embellir » — deux `<article data-row-id>` identiques, et deux `AdminButton` montés sur la même
clé de geste dans le registre. Aujourd'hui le même chevauchement existe (`active` ∩ `illustrated`)
mais reste invisible parce que « Déjà illustrées » est repliée derrière une case.

## Approach

### 1. Modèle de données

`convex/schema.ts`, table `recipes` — un champ déclaré par l'opérateur, deux dérivés :

```ts
export const illustrationStage = literalUnion([
  'missing', // no photo yet, still to shoot
  'source-has-none', // no photo, and the source has none to shoot
  'to-beautify', // original attached, no beautification accepted
  'done', // beautification accepted and published
] as const)
```

```ts
// Set by the operator when the source has no photo for this recipe. Admin-only: the storefront row
// of a recipe without a photo is already normal and complete, and stays untouched.
noPhotoAvailable: v.optional(v.boolean()),
// Denormalised bucket for the work screen. Derived, never authored — `withIllustration` is the only
// writer, exactly as it already governs `hasIllustration`.
illustrationStage: v.optional(illustrationStage),
// When this recipe's photo situation last changed. NOT `_creationTime`: a photo attached today to a
// recipe scanned in March must sort with today's batch, or the row it produces is unfindable in the
// one section that is always open.
illustrationUpdatedAt: v.optional(v.number()),
```

**Index — l'existant n'est pas touché.** `by_illustration: ['hasIllustration']` reste tel quel, donc
`derivations.ts:180` continue de fonctionner sans une ligne de changement et aucun index existant
n'a besoin d'être rebâti au déploiement. Un index neuf est ajouté :

```ts
.index('by_illustration_stage_and_beautify_status_and_updated_at', [
  'illustrationStage',
  'beautifyStatus',
  'illustrationUpdatedAt',
])
```

Le nom liste ses trois champs, comme l'exige `convex/_generated/ai/guidelines.md:186`. Le troisième
champ est explicite parce que Convex n'ajoute que `_creationTime` en clé finale : sans lui,
`.order('desc')` trierait par date de création de la recette, ce qui est précisément la mauvaise
date pour « À embellir ».

`hasIllustration` est conservé bien qu'`illustrationStage` le contienne : sans lui,
`derivations.pendingRenditionSlots` devrait parcourir deux plages au lieu d'un seul walk paginé.

Le nouvel index n'est **pas** déclaré `staged: true`. `guidelines.md:191` réserve ce mode aux
grandes tables — le corpus fait quelques centaines de recettes, le backfill d'index est instantané,
et `staged` imposerait deux déploiements (un index staged n'est pas interrogeable avant qu'un
déploiement ultérieur retire le drapeau). Si la table a beaucoup grossi au moment du déploiement, la
sortie de secours est connue : poser `staged: true`, laisser le backfill tourner, redéployer sans.

### 2. Le seul écrivain

`convex/lib/recipeWrites.ts` :

```ts
export type IllustrationInput = {
  imageStorageId: Id<'_storage'> | undefined
  beautifiedAccepted: boolean
  noPhotoAvailable: boolean
}

export function stageOf({
  imageStorageId,
  beautifiedAccepted,
  noPhotoAvailable,
}: IllustrationInput): IllustrationStage {
  if (imageStorageId === undefined)
    return noPhotoAvailable ? 'source-has-none' : 'missing'
  return beautifiedAccepted ? 'done' : 'to-beautify'
}

/**
 * `at` is positional and not a field of `fields`, so it cannot be spread into the patch: a stray
 * `at` key would be rejected by the schema.
 */
export function withIllustration<T extends IllustrationInput>(
  fields: T,
  at: number,
): T & {
  hasIllustration: boolean
  illustrationStage: IllustrationStage
  illustrationUpdatedAt: number
} {
  return {
    ...fields,
    hasIllustration: fields.imageStorageId !== undefined,
    illustrationStage: stageOf(fields),
    illustrationUpdatedAt: at,
  }
}
```

Les trois clés d'entrée sont **requises**, comme l'est déjà `imageStorageId` : un appelant qui en
oublie une classerait la recette dans le mauvais bucket sans rien dire, et tout l'intérêt du champ
est que l'index soit digne de confiance. Un oubli est une erreur de compilation.

`noPhotoAvailable` est `v.optional` au schéma (un booléen requis rejetterait tous les documents
existants) mais requis à l'entrée du helper : chaque site de patch écrit donc explicitement
`recipe.noPhotoAvailable ?? false`. La normalisation est au point d'appel, pas cachée dans le
helper, pour que le compilateur refuse un `boolean | undefined` passé par mégarde.

**La règle du bump, énoncée exactement.** `illustrationUpdatedAt` répond à « quand le travail photo
de cette recette a-t-il bougé pour la dernière fois ». Elle est donc bumpée par **toute** écriture de
l'un des cinq champs qui décident où la recette atterrit : `imageStorageId`, `beautifiedStorageId`,
`beautifiedAccepted`, `noPhotoAvailable`, `beautifyStatus`.

Le stage ne suffit pas à couvrir cette règle : `rejectPendingCandidate` fait passer une recette de
« À arbitrer » à « À embellir » **sans changer son stage** (elle a toujours un original et pas
d'embellissement accepté) — seul `beautifyStatus` bouge. Une recette arbitrée aujourd'hui
réapparaîtrait donc au fond de « À embellir », à sa date d'attachement, c'est-à-dire hors plafond.
Même classe de défaut que la date de scan du round précédent, et mon inventaire l'avait ratée.

D'où un second fragment, à côté du premier :

```ts
/** For the writes that move a recipe between sections without changing its stage. */
export function touchedIllustration(at: number): {
  illustrationUpdatedAt: number
} {
  return { illustrationUpdatedAt: at }
}
```

Sites d'appel — l'inventaire complet, `beautify.ts` compris :

| Site                                                  | Nature                                       | Après                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `extract.ts:528`                                      | insert                                       | ajoute `noPhotoAvailable: false`, `at: now` — l'objet fournit déjà `imageStorageId: undefined` et `beautifiedAccepted: false` |
| `seed.ts:282`                                         | insert                                       | idem                                                                                                                          |
| `recipeAdmin.ts:146`                                  | insert                                       | idem (vérifié : insert simple, rien de particulier)                                                                           |
| `devImages.ts:44`                                     | patch                                        | lit `beautifiedAccepted` et `noPhotoAvailable ?? false` sur le doc                                                            |
| `illustrations.ts:203` (attach)                       | patch                                        | `noPhotoAvailable: false` — attacher une photo **efface** le drapeau                                                          |
| `illustrations.ts:238` (detach)                       | patch                                        | lit le drapeau sur le doc (donc `missing`, pas `source-has-none`)                                                             |
| `illustrations.ts:298` (`acceptBeautified`)           | patche `beautifiedAccepted: true` à la main  | passe par le helper → `done`                                                                                                  |
| `illustrations.ts:351` (`unpublishAcceptedCandidate`) | patche `beautifiedAccepted: false` à la main | passe par le helper → `to-beautify`                                                                                           |
| `illustrations.ts:306` (`rejectPendingCandidate`)     | `review` → `idle`, candidat supprimé         | `touchedIllustration(now)` — **entre dans « À embellir »**, doit y entrer en tête                                             |
| `illustrations.ts:357` (`deleteUnpublishedCandidate`) | supprime le candidat conservé                | `touchedIllustration(now)`                                                                                                    |
| `illustrations.ts:251` (`requestBeautify`)            | `idle` → `generating`                        | `touchedIllustration(now)` — sort de « À embellir »                                                                           |
| `illustrations.ts:379` (`abandonBeautify`)            | `generating` → `failed`                      | `touchedIllustration(now)`                                                                                                    |
| `beautify.ts:386` (finalisation, succès)              | `generating` → `review`, pose le candidat    | `touchedIllustration(now)`                                                                                                    |
| `beautify.ts:441` (finalisation, échec)               | `generating` → `failed`                      | `touchedIllustration(now)`                                                                                                    |

Aucun de ces sites n'est un faux positif : chacun écrit au moins un des cinq champs. C'est
l'inverse — un site oublié — qui est le risque, et le test d'inventaire de §7 est là pour ça.

### 3. Deux mutations de drapeau

`convex/illustrations.ts`, via le `recipeMutation` existant (jeton + recette prouvés une fois) :

- `markNoPhotoAvailable` — refuse si `imageStorageId` est présent (« Cette recette a déjà une
  photo »). Patche le helper avec `noPhotoAvailable: true`.
- `clearNoPhotoAvailable` — refuse si le drapeau n'est pas posé. Symétrique.

### 4. La requête

`listIllustrationWork` — les arguments passent de `includeIllustrated: boolean` à un plafond par
section, `null` valant « repliée » :

```ts
args: {
  adminToken: v.string(),
  // Per-section ceiling. `null` means collapsed: the documents are still read to produce the
  // counter, but no url is minted and no row is returned.
  limits: v.object({
    toBeautify: v.number(),
    missing: v.union(v.number(), v.null()),
    sourceHasNone: v.union(v.number(), v.null()),
    done: v.union(v.number(), v.null()),
  }),
}
```

Chaque plafond est **normalisé côté serveur** avant d'atteindre `take` — `v.number()` est un float64
et accepte donc `NaN`, `Infinity`, les négatifs et les décimaux, qu'aucun clamp naïf ne rattrape :

```ts
const ILLUSTRATION_WORK_MAX = 500

/** `v.number()` is a float64: NaN, Infinity, negatives and decimals all cross the wire. */
function boundedLimit(requested: number): number {
  if (!Number.isFinite(requested)) return ILLUSTRATION_WORK_LISTED
  return Math.min(Math.max(Math.floor(requested), 0), ILLUSTRATION_WORK_MAX)
}
```

Un client qui demanderait 10 000 lignes ne doit pas pouvoir transformer la requête en scan de table,
et `take(NaN)` ne doit jamais atteindre Convex. Le plafond d'une section repliée est le sondage de
comptage, `ILLUSTRATION_WORK_LISTED = 50`.

**Les quatre sections d'étape ne sont pas lues tant que la migration n'est pas `done`** : leurs
`rows` sont vides, leur `count` est nul, et un drapeau `stagesReady: v.boolean()` le dit à l'écran.
Une vue partielle laisse l'opérateur conclure qu'un lot est terminé alors que le backfill n'a pas
encore atteint ses recettes — le bandeau seul ne suffit pas à empêcher cette lecture. `active` reste
vivante pendant toute la fenêtre (avec le fallback de date ci-dessus), donc l'arbitrage n'est jamais
bloqué. Effet de bord bienvenu : pendant la migration l'écran ne fait que trois lectures.

Retour : cinq sections de forme identique.

```ts
const workSection = v.object({
  rows: v.array(illustrationRow), // empty when the section is collapsed
  count: v.number(),
  truncated: v.boolean(), // more rows exist beyond `count`
})
// active | toBeautify | missing | sourceHasNone | done
```

Lectures d'index — sept au total, une par section d'étape plus trois pour `active` :

```ts
const byStage = (stage: IllustrationStage, take: number) =>
  ctx.db
    .query('recipes')
    .withIndex(
      'by_illustration_stage_and_beautify_status_and_updated_at',
      (q) => q.eq('illustrationStage', stage).eq('beautifyStatus', 'idle'),
    )
    .order('desc') // by illustrationUpdatedAt, the third index key
    .take(take + 1)
```

Le `eq('beautifyStatus', 'idle')` **est** l'invariant de partition, exprimé dans la plage d'index et
non par un `.filter()` — un filtre après scan casserait la justesse de la troncature
(`guidelines.md:329`). `active` reste l'union des trois statuts non-`idle` lue par
`by_beautify_status`, inchangée, et garde son ordre actuel (arbitrage d'abord, puis en cours, puis
échecs).

Séparation du coût : **les documents des cinq sections sont toujours lus** (le compteur du
`<summary>` en a besoin), mais `toRow` — qui appelle `ctx.storage.getUrl` par slot et fait charger
les images au navigateur — n'est appliqué qu'aux sections ouvertes. Une section repliée renvoie
`rows: []` avec son `count`. Aujourd'hui `withoutIllustration` est chargé avec ses urls en
permanence : le lot améliore donc le coût par défaut.

`count` est le nombre lu écrêté au plafond, `truncated` dit s'il y a plus. Une section repliée
affiche « 43 » ou « 50+ » ; une section ouverte et tronquée offre **« Afficher 50 de plus »**, qui
relève son plafond de 50. Sans ça la 51ᵉ recette à embellir est inatteignable, ce qui contredit
l'objectif du lot.

**Le plafond dur ne ment pas.** À `ILLUSTRATION_WORK_MAX` avec `truncated` encore vrai, le bouton
disparaît au profit de la phrase que le projet emploie déjà dans ce cas (« Liste plafonnée : traite
celles-ci, les suivantes viendront ») — offrir un bouton qui ne bouge plus rien serait pire que de
nommer le mur. Un compteur exact au-delà du plafond demanderait le composant `aggregate` de Convex.

Chaque ligne gagne `updatedAt: recipe.illustrationUpdatedAt ?? recipe._creationTime`. Le fallback
n'est pas décoratif : il est ce qui empêche une recette non migrée et non-`idle` de faire échouer le
validateur de retour dans « À arbitrer » (voir l'invariant de partition).

### 5. La migration

`convex/migrations.ts`.

**Le remplissage des clés dérivées est une migration du composant officiel
[`@convex-dev/migrations`](https://github.com/get-convex/migrations)**, et son déclencheur est le
déploiement, pas un bouton.

Un premier jet reprenait la mécanique déjà présente dans le dépôt : table `migrations` maison,
curseur, worker qui se replanifie, jeton `runId` contre deux chaînes sur un même curseur, et un
bouton « Relancer la migration » dans l'écran d'administration. Tout cela est remplacé. La mécanique
était une copie moins bonne d'un composant que la plateforme maintient — et surtout son déclencheur
était humain : un flux principal qui dépend de quelqu'un qui se souvient d'appuyer casse le jour où
il oublie, et la décision 12 (§4) avait précisément transformé « oublier donne une liste partielle »
en « oublier tue le flux photo ».

- `migrations = new Migrations(components.migrations, { internalMutation })` — `internalMutation` est
  passé pour que `migrateOne` soit typé contre les tables du projet.
- `backfillIllustrationStage = migrations.define({ table: 'recipes', migrateOne })`, condition de
  saut `illustrationStage !== undefined`. Écrit les **trois** clés dérivées via le helper, avec
  `at = recipe._creationTime` : un document jamais photographié obtient donc
  `illustrationUpdatedAt === _creationTime`, ce qui est exactement la date que l'opérateur cherche
  dans « Sans photo » (la date de scan). Répare au passage un document que l'ancienne migration
  `hasIllustration` n'a jamais touché, puisqu'elle écrit ce champ aussi.
- `runAll = migrations.runner([...])` — un point d'entrée unique, une série, pour que la prochaine
  migration soit une ligne ici et rien d'autre.

**La table `migrations` maison, `backfillIllustrations`, `HAS_ILLUSTRATION_MIGRATION`,
`startIllustrationBackfill`, `startIllustrationStageBackfill` et le verrou `runId` sont supprimés.**
La crainte qui les gardait — une continuation en vol référençant
`internal.migrations.backfillIllustrations` — coûte au pire un job planifié qui échoue une fois dans
les journaux : la nouvelle migration écrit `hasIllustration` sur tout document sans étape, donc le
corpus est réparé quelle que soit l'issue de l'ancienne chaîne. Le verrou, lui, n'a plus d'objet : le
composant refuse de démarrer un doublon et reprend au curseur d'un batch échoué.

**Déclenchement.**

- Production : `vercel.json` enchaîne `npx convex run convex/migrations.ts:runAll --prod` après
  `convex deploy`. `convex deploy` n'a pas de `--run` pour la production — `--preview-run` est
  documenté « ignored if deploying to a production deployment » — donc c'est bien un second appel. Il
  est gardé par `[ "$VERCEL_ENV" = production ]` : `ignoreCommand` fait déjà que Vercel ne construit
  que la production, et le garde rend ce couplage explicite plutôt que tacite.
- Aperçu : une étape du job `data` de `.github/workflows/preview.yml`, **après** l'import. C'est le
  seul endroit du workflow où des données arrivent, et un instantané pris avant que la migration
  n'ait tourné en production atterrit non migré. Un push, qui saute ce job, garde le backend qu'il
  avait déjà.
- À la main : `npm run migrate` (dev) et `npm run migrate:prod`.

Rejouer la série est sans effet quand elle est terminée, no-op quand elle est en vol, et reprend au
curseur quand elle a été interrompue — donc chaque déploiement peut l'appeler sans condition.

**Pas de `lastError`, et plus besoin de « dernière avance ».** Un premier jet prévoyait les deux. Le
premier ne pourrait pas fonctionner : si le batch jette, sa transaction est annulée — l'écriture de
`lastError` avec elle ; et `src/lib/adminError.ts:1-7` interdit explicitement le message technique
côté admin (`DESIGN.md` § Résistance). Le second était un contournement de ce refus : mesurer un
délai depuis la dernière écriture pour distinguer une chaîne bloquée d'une chaîne lente. Le composant
donne directement ce que ce délai approximait — `state: inProgress | success | failed | canceled`,
plus `unknown` quand la migration n'a jamais tourné — donc l'heuristique disparaît avec lui.

`readIllustrationStageStatus(ctx)` lit ce statut depuis une query, ce qui met la query en dépendance
de l'avancement du composant : les quatre sections apparaissent d'elles-mêmes à la validation du
dernier batch, sans rechargement.

Contrat pendant la migration : les quatre sections d'étape sont **désactivées** (§4), pas affichées
partielles. Le `MigrationBanner` perd son bouton et devient un pur constat — il annonce que la file
par étape est indisponible, et que l'arbitrage reste entier.

### 6. L'écran

`src/routes/admin_.illustrations.tsx` — cinq sections, dont trois repliables :

```
Photos des plats

▸ À arbitrer (2)                  [ouvert, non repliable]
▸ À embellir (7)                  [ouvert, non repliable]  ← le flow principal
▸ Sans photo (43)                 [replié]
▸ Sans photo dans la source (12)  [replié]
▸ Terminées (50+)                 [replié]
```

- Repliage par `<details>`/`<summary>` natif, pas d'accordéon JS. L'état ouvert vit dans le state
  React et pilote `limits`, donc ouvrir une section déclenche un aller-retour qui ramène ses urls.
  Aucune ligne rendue tant que la section est fermée.
- Tant que `stagesReady` est faux, les quatre sections d'étape ne sont pas rendues du tout — une
  phrase à leur place, et le bandeau au-dessus. « À arbitrer » reste entière.
- `<summary>` porte le titre et le compteur. Style au filet, conforme à `DESIGN.md` : pas de carte,
  pas de coin arrondi, pas d'ombre, rien de centré. Marqueur natif remplacé par un chevron
  typographique.
- La case `includeIllustrated` disparaît : « Terminées » est une section repliée comme les autres.
- Séparateurs de lot dans les quatre sections d'étape : nouveau `src/lib/groupByDay.ts` calqué sur
  `groupByLetter` (même forme `{ label, items }[]`) mais **sans tri** — l'ordre `desc` de l'index
  est déjà l'ordre d'affichage. Un `<h4>` fileté par jour, date en clair (« 14 août »), année
  seulement si elle diffère de l'année courante.
- **Fuseau explicite.** `illustrationUpdatedAt` est en ms UTC ; le regroupement et le libellé
  utilisent `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' })` en dur. Sans ça le rendu
  serveur (Vercel, UTC) et le rendu client (Paris) tomberaient sur des jours différents pour tout ce
  qui est créé entre minuit et 2 h — un mismatch d'hydratation.

Vignettes : `active` garde les planches pleine taille (c'est là qu'on arbitre un rendu). Les quatre
sections d'étape utilisent les vignettes, `toBeautify` incluse : elle est toujours ouverte et peut
tenir 50 lignes, où des planches pleine résolution reproduiraient le problème de poids que le
commentaire de `listIllustrationWork` documente déjà (~160 Mo par écran). Pour presser « Embellir »,
une vignette de ~292 px suffit à vérifier que la page est lisible.

`src/lib/illustrationWork.ts` — `IllustrationState` gagne `noPhotoAvailable: boolean`,
`IllustrationActions` gagne deux gestes :

```ts
markNoPhoto: !hasOriginal && !noPhotoAvailable,
unmarkNoPhoto: noPhotoAvailable,
```

`src/routes/-IllustrationRow.tsx` — deux entrées de plus dans la table `gestureRows` : « Pas de
photo dans la source » et « La source a une photo ». Sans confirmation : réversibles d'un clic, et
elles ne détruisent aucun blob. Les deux rejoignent `rowActions` (donc le suivi d'orphelin), puisque
poser le drapeau retire la ligne de sa section.

### 7. Tests

- `convex/illustrations.test.ts`
  - **partition** : pour chaque couple (stage, `beautifyStatus`), la recette est dans exactement une
    section ; en particulier une recette `review` **avec** original est dans `active` et pas dans
    `toBeautify`, et une recette `failed` **sans** original est dans `active` et pas dans `missing`.
  - `accept` déplace vers `done` ; `unpublish` ramène vers `to-beautify` ; un candidat conservé
    reste `to-beautify` ; `attach` efface le drapeau ; `detach` d'une recette anciennement drapeau
    donne `missing`.
  - `mark`/`clear` et leurs deux refus.
  - une section repliée renvoie `rows: []` avec son `count` ; une section ouverte renvoie ses urls.
  - **ordre par activité**, sur les trois chemins d'entrée dans `toBeautify` et pas seulement le
    premier : une recette ancienne **photographiée** aujourd'hui, une dont le candidat est **rejeté**
    aujourd'hui, et une dont le candidat conservé est **supprimé** aujourd'hui passent chacune devant
    une recette récente touchée hier. Les deux derniers cas sont précisément ceux que mon inventaire
    avait ratés.
  - **inventaire des écrivains.** Énumérer `api.illustrations` ne marche pas : `_generated/api.js:11`
    exporte `anyApi`, un proxy dynamique dont les fonctions ne sont pas visibles par `Object.keys`.
    Le test énumère donc les **exports des modules sources** — `import * as illustrations from
'./illustrations'` et `import * as beautify from './beautify'`, dont les exports sont des objets
    réels — et les confronte à une liste déclarée dans le test, chaque nom classé « bumpe » ou « ne
    touche pas au travail photo ». Les deux modules, pas seulement `illustrations` : la finalisation
    vit dans `beautify.ts` et écrit deux des cinq champs protégés, donc un inventaire qui l'exclut
    laisse passer précisément les sites les plus faciles à oublier. Une fonction ajoutée sans être
    classée fait échouer la suite, ce qui force la décision au lieu de la laisser filer. Pour chaque
    nom classé « bumpe », le test exécute le geste et vérifie que `illustrationUpdatedAt` a
    strictement augmenté — y compris sur les **deux chemins internes de finalisation**, succès
    (`beautify.ts:386`) et échec (`beautify.ts:441`), atteints via `t.run` / l'action mockée comme le
    fait déjà `beautify.test.ts`.
  - **accès au-delà du plafond** : avec 51 lignes à embellir, plafond relevé à 100, la 51ᵉ est
    servie ; au plafond dur avec `truncated`, la réponse le dit encore.
  - **normalisation des plafonds** : `NaN`, `Infinity`, `-1`, `1.5` et `10_000` donnent tous une
    lecture bornée et jamais une erreur.
  - **fenêtre de migration** : migration non `done` → `stagesReady` faux, les quatre sections
    d'étape vides, et une recette non migrée en `generating` est servie dans `active` avec
    `updatedAt === _creationTime` (sans le fallback, ce test échoue sur le validateur de retour).
  - un document historique sans `noPhotoAvailable` traverse chaque mutation sans erreur.
- Le backfill : il classe un corpus **plus grand qu'un batch** (donc il passe vraiment par la
  replanification du composant), écrit les trois clés, `illustrationUpdatedAt` vaut `_creationTime`,
  répare un document que l'ancienne migration `hasIllustration` n'avait pas touché, et laisse une
  recette déjà classée intacte quel que soit le nombre de relances. Le lotissement, le curseur et la
  reprise appartiennent au composant et sont couverts par ses propres tests ; ils ne sont pas
  réécrits ici. Les tests qui lisent les sections d'étape appellent la vraie migration plutôt que
  d'écrire une ligne « terminée » à la main.
- `src/lib/…` (fonction pure de bornage) : `boundedLimit` sur `NaN`, `Infinity`, `-Infinity`, `-1`,
  `1.5`, `0`, `500`, `10_000`.
- `src/lib/illustrationWork.test.ts` : les deux nouveaux gestes, dans les quatre états.
- `src/lib/groupByDay.test.ts` : regroupement, conservation de l'ordre, frontière de minuit à Paris
  (un timestamp à 23 h UTC tombe le lendemain), affichage de l'année.
- `src/lib/recipeWrites.test.ts` : `stageOf` sur les huit combinaisons d'entrée.

## Key decisions & tradeoffs

1. **L'invariant de partition passe par `beautifyStatus` dans la plage d'index**, pas par un filtre
   en mémoire ni par un `illustrationStage` qui absorberait l'activité. Absorber l'activité dans le
   stage obligerait chaque transition de `beautify.ts` (finalisation incluse, qui tourne depuis une
   action) à réécrire le stage ; l'exprimer comme deuxième clé d'index ne coûte **aucune écriture
   supplémentaire** puisque les deux champs existent déjà.
2. **L'index existant n'est pas modifié, un index neuf est ajouté.** Changer les champs de
   `by_illustration` en place imposerait un rebuild au déploiement et un nom qui ne décrit plus ses
   champs (contraire à `guidelines.md:186`). Coût : un index de plus sur la table.
3. **`illustrationUpdatedAt` plutôt que `_creationTime`.** `_creationTime` est la date de scan ; pour
   « À embellir » la date utile est celle de la pose de la photo. Sans ce champ, une recette de mars
   photographiée aujourd'hui atterrit en bas d'une section plafonnée, c'est-à-dire nulle part. Le
   backfill l'initialise à `_creationTime`, donc « Sans photo » garde bien la date de scan.
4. **Trois clés requises dans le helper, `at` positionnel.** Verbeux sur les sites de patch, mais un
   oubli devient une erreur de compilation au lieu d'un mauvais bucket silencieux. `at` est
   positionnel précisément pour ne pas être répandu dans le patch.
   4bis. **Le bump est réglé par les cinq champs, pas par le stage — et gardé par un test
   d'inventaire.** Le compilateur peut garantir qu'un site qui _passe_ par le helper le fait
   complètement ; il ne peut pas garantir qu'un site qui devrait y passer y passe. Deux sites m'ont
   échappé sur deux rounds successifs (`rejectPendingCandidate`, `deleteUnpublishedCandidate`), donc
   la garantie est déplacée là où elle peut exister : une énumération des **exports des modules
   sources** `illustrations.ts` et `beautify.ts`, confrontée à une liste déclarée, qui casse quand une
   fonction apparaît sans être classée. Pas `api.illustrations` — c'est un proxy `anyApi`, il ne
   s'énumère pas. Pas une règle ESLint AST non plus : interdire l'écriture des cinq champs hors
   helpers serait une garantie plus forte, mais c'est un plugin à écrire et à maintenir pour un
   périmètre de deux modules.
5. **Attacher une photo efface le drapeau.** L'alternative — le garder en sommeil et le faire
   ressurgir au détachement — préserve une information posée à la main mais rend le détachement
   surprenant. On préfère un état qui ne mente jamais.
6. **Documents toujours lus, urls seulement si ouvert.** Les compteurs des `<summary>` imposent la
   lecture des documents ; ce sont les `storage.getUrl` et le poids réseau qui sont conditionnés.
7. **Plafond relevable plutôt que curseur.** « Afficher 50 de plus » relève un entier, normalisé et
   écrêté serveur à 500 — au-delà du corpus actuel entier. Un vrai curseur serait plus propre à
   grande échelle mais impose de fusionner cinq curseurs dans une requête qui doit rester une seule
   lecture cohérente. Le mur est donc théorique aujourd'hui, et il est **nommé** quand on l'atteint
   au lieu d'être caché derrière un bouton inerte. Seuil de réexamen explicite : le jour où une
   section rapporte `truncated` à 500, la pagination à curseur devient le lot suivant.
8. **La migration passe au composant officiel, et son déclencheur au déploiement.** La mécanique
   maison — table, curseur, worker, jeton `runId` — est supprimée avec l'ancienne migration
   `hasIllustration` qu'un lot précédent gardait par prudence : la nouvelle écrit `hasIllustration`
   sur tout document sans étape, donc le corpus est réparé quelle que soit l'issue d'une chaîne
   restée en vol, et le pire coût est un job planifié qui échoue une fois dans les journaux.
9. **Pas de bouton « Lancer la migration ».** C'est la décision qui annule le premier jet. La
   décision 12 avait rendu les quatre sections indisponibles pendant la fenêtre de migration, ce qui
   transformait un bouton oublié en flux photo mort. `vercel.json` et le job `data` du workflow
   d'aperçu appellent la série ; rejouer une série terminée est sans effet, donc l'appel est
   inconditionnel. `lastError` reste retiré (la transaction qui jette annule son écriture, et
   `adminError.ts:1-7` interdit le message technique côté admin) et l'heuristique « dernière avance »
   disparaît avec lui : le `state` du composant dit directement ce qu'elle approximait.
10. **Les sections d'étape sont indisponibles, pas partielles, pendant la migration.** Une liste
    partielle demande à l'opérateur de se rappeler d'un bandeau en lisant des lignes ; il conclura
    qu'un lot est fait. `active` reste entière, donc rien n'est bloqué, et l'écran ne fait plus que
    trois lectures pendant la fenêtre.
11. **La vitrine n'est pas touchée** — décision explicite du propriétaire, pas un oubli :
    `pickDisplayImage` continue de servir l'original brut en fallback quand aucun embellissement
    n'est accepté. Conséquence assumée : une photo de page imprimée, texte compris, peut apparaître
    sur le site public tant que l'embellissement n'est pas fait. C'est précisément ce que la section
    « À embellir » rend visible.
12. **Le changement de signature de `listIllustrationWork` est fait d'un coup, sans shim.** Un
    onglet d'admin resté ouvert sur l'ancien bundle verra sa requête refusée. Une compatibilité
    transitoire ne le sauverait pas : la **forme de retour** change aussi, donc l'ancien bundle
    lirait `data.withoutIllustration` — `undefined` — et planterait au rendu. Écran d'admin à un
    seul opérateur derrière un jeton : un rechargement suffit, et le coût d'un shim inefficace ne se
    justifie pas.

## Risks / open questions

- **Coût des lectures de documents.** Cinq sections lues à chaque rendu, même tout replié : ~250
  petits documents. Négligeable à quelques centaines de recettes, et c'est le prix des compteurs ;
  ça ne passerait pas à l'échelle d'un corpus beaucoup plus gros.
- **`ILLUSTRATION_WORK_MAX = 500` reste un plafond arbitraire**, même nommé honnêtement (décision 7).
- **La fenêtre de migration rend le travail photo indisponible**, arbitrage excepté. C'est le prix
  assumé de ne pas afficher une file partielle ; le backfill de quelques centaines de documents dure
  quelques secondes, mais un corpus beaucoup plus gros rendrait cette fenêtre gênante.
- **Ordre de déploiement.** Nouvel index + nouveau champ + nouvelle signature arrivent ensemble ;
  voir décision 11.
- **« À embellir » et le rythme de travail.** Si l'opérateur uploade 20 photos d'affilée, la section
  toujours ouverte affiche 20 lignes en attente. C'est voulu, mais c'est la section qui grossira le
  plus vite après ce lot.

## Out of scope

- Le fallback d'image de la vitrine (décision 10 : inchangé).
- Toute marque publique du drapeau sur la fiche recette — `DESIGN.md` dit que la provenance n'existe
  pas comme champ.
- Compteurs exacts au-delà du plafond (composant `aggregate`).
- Vraie pagination à curseur.
- Le flow de scan (`/admin/scan/$id`) et le formulaire de correction.
