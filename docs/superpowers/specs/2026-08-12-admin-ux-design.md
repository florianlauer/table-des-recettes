# Plan : retours UX de l'atelier d'administration

_Tour 4 — révisé par Claude après les critiques Codex des tours 1 à 4, 2026-08-12._
_Base : `main` à `a8872ed` (PR #14 « skip » et PR #15 « prompt v4 » mergées). Toutes les références de
ligne ci-dessous sont vérifiées sur cette base._
_Journal de l'argument : [`2026-08-12-admin-ux-review-log.md`](./2026-08-12-admin-ux-review-log.md)._

Surfaces concernées : `/admin` (`src/routes/admin.tsx`), `/admin/illustrations`
(`src/routes/admin_.illustrations.tsx`), `/admin/scan/$id` (`src/routes/admin_.scan.$id.tsx`) et le
formulaire de recette (`src/routes/-RecipeForm.tsx`).

## Objectif

Trois défauts constatés, pas supposés. **Un** : aucun lien d'admin ne se signale comme cible —
`src/styles/app.css:47-50` pose `a { color: inherit; text-decoration: none }` et la règle de survol
(`app.css:55-64`) ne nomme que des sélecteurs des surfaces publiques (`.row__title`,
`.filters__item`, `.back`, `.failure__retry`). Pire, dans la liste des scans le texte cliquable est
`{scan.status}` (`admin.tsx:140-142`) : le mot « done » sert d'étiquette de lien. **Deux** :
`.admin-page button` (`app.css:123-129`) n'a ni `:hover`, ni `:active`, ni `cursor: pointer`, ni
état `:disabled` — un bouton mort est indiscernable d'un bouton vivant, exactement le défaut que
`DESIGN.md` corrige déjà pour `−` du sélecteur de portions. **Trois** : chaque page tient un seul
booléen `busy`, si bien qu'un clic gèle tous les boutons de la page et que le retour atterrit dans
un `<p role="status">` en tête de document (`admin.tsx:130`, `admin_.illustrations.tsx:85`,
`admin_.scan.$id.tsx:88`) — sur une liste de quarante lignes, l'opérateur ne voit rien se produire.

Le plan corrige les trois et ajoute la pièce que le diagnostic a fait apparaître : sur cet écran,
**l'attente réelle n'est pas dans le clic**. `requestBeautify` planifie et rend la main en quelques
centaines de millisecondes ; le travail dure ensuite neuf à trente secondes dans l'état
`row.beautifyStatus === 'generating'`. Un retour visuel attaché à la promesse du clic couvrirait
donc les 300 ms qui ne comptent pas et laisserait muettes les 26 s qui comptent.

Décisions déjà arbitrées avec le propriétaire du produit, non rouvertes ici : filet permanent sur
les liens d'admin ; retour au participe présent sur le bouton lui-même plus résultat au plus près du
geste ; barre de progression ; verrouillage par ligne, verrou de page réservé aux gestes de page ;
périmètre = les quatre surfaces.

## Approche

### 1. Le geste est typé, jamais analysé depuis une chaîne — `src/lib/gestures.ts`

```ts
export type GestureScope =
  | { kind: 'page' } // réécrit tout l'écran : Tout publier, Relancer, images d'un scan
  | { kind: 'row'; rowId: string } // une recette, un scan de la liste
  | { kind: 'isolated'; id: string } // ne concurrence que lui-même : la capture de /admin

export type Gesture = { scope: GestureScope; action: string }

/** Sérialisation structurelle — `JSON.stringify` sur un objet à clés ordonnées. Aucun séparateur
 *  à échapper, donc injective même si un identifiant contient `:`. Sert de clé de Record, et
 *  n'est jamais reparsée. */
export function gestureId(gesture: Gesture): string

/** Symétrique par construction. Testé dans les deux sens, case par case. */
export function conflicts(running: Gesture, requested: Gesture): boolean
```

| En cours ↓ / Demandé → | `page`  | `row A` | `row B` | `isolated X` | `isolated Y` |
| ---------------------- | ------- | ------- | ------- | ------------ | ------------ |
| `page`                 | oui     | oui     | oui     | **non**      | **non**      |
| `row A`                | **oui** | oui     | non     | non          | non          |
| `isolated X`           | **non** | non     | non     | oui          | non          |

Deux lignes portent une décision, pas une commodité. « `row A` en cours bloque un geste de `page` »
est la justification même du verrou de page : « Tout publier » ne part pas pendant l'enregistrement
d'une ligne. Et **`isolated` ne croise jamais `page`** : c'est ce qui permet à un envoi de douze
pages de ne pas geler la file d'extraction pendant une minute. La version du tour 1 écrivait « oui »
dans cette case et contredisait donc sa propre décision 7.

### 2. Un seul contrat d'action, et les messages deviennent du code pur

Les mutations rendent des formes incompatibles : `ActionOutcome` (`-RecipeForm.tsx:13-14`),
l'`Outcome` des illustrations (`admin_.illustrations.tsx:23`), une chaîne
`'purged' | 'deferred' | …` (`admin.tsx:190-198`), un statut à quatre branches
(`admin.tsx:338-348`), un `AttachResult` (`src/lib/useAttachImage.ts:7-8`).

```ts
export type GestureResult = { ok: boolean; text: string }

// src/lib/gestureMessages.ts — pur, testé branche par branche
export function purgeMessage(
  result: 'purged' | 'deferred' | 'already_purged',
): GestureResult
export function extractionMessage(
  result: StartExtractionResult,
  { now }: { now: number },
): GestureResult
export function uploadMessage({
  total,
  failures,
}: {
  total: number
  failures: readonly string[]
}): GestureResult
export function outcomeMessage(outcome: {
  ok: boolean
  error?: string
  message?: string
}): GestureResult
/** Tout ce qui a été *lancé* : une mutation, une action, `fetch`, la compression canvas. */
export function thrownMessage(error: unknown): GestureResult
```

**Les exceptions font partie du contrat** : `run` entoure l'action d'un `try/catch`, normalise
l'`unknown` par `thrownMessage`, et ne finalise que le jeton courant. Aucune promesse rejetée ne peut
laisser un geste en cours pour toujours.

### 3. `src/lib/useGestures.ts` — registre synchrone, jeton, époque

```ts
type Run = {
  gesture: Gesture
  token: number // monotone, par exécution
  pendingLabel: string
  startedAt: number
  estimateMs: number | null
  progress: { fraction: number; text: string } | null
  /** Posé quand la ligne a quitté les données : le résultat sera republié en section. */
  orphaned: boolean
}
```

- **Double clic avant re-render.** L'autorité est un `useRef<Map<string, Run>>` consulté **et écrit
  avant tout `await`** : `run()` commence par un test-et-pose atomique et n'appelle jamais l'action si
  `conflicts` répond oui contre une entrée vivante. Le `disabled` du bouton reste dérivé de l'état
  pour le rendu — un confort, pas la garde.
- **Deux exécutions successives de même geste.** Chaque exécution porte un `token` monotone ; tout
  `setProgress`, résultat ou finalisation portant un jeton périmé est ignoré.
- **Changement d'époque.** L'`epoch` (`adminToken` + identité de route) ne se contente pas
  d'invalider les complétions : à son changement, le registre **et** les résultats visibles sont
  **vidés synchroniquement**, sinon des entrées mortes continueraient de verrouiller les gestes de la
  nouvelle page. Les jetons de l'ancienne époque sont invalidés dans la foulée.
- **Péremption des résultats.** Un résultat n'est pas un dépôt permanent : démarrer un nouveau geste
  sur la même ressource efface les résultats de cette ressource, et une modification de l'opérateur
  dans le formulaire (`onChange`, donc `dirty`) efface le résultat qu'elle vient de périmer. Sans
  cette règle, deux actions successives laissent deux messages contradictoires sous la même ligne.

```ts
const gestures = useGestures({ epoch })
gestures.run(gesture, { pendingLabel, estimateMs, settle }, action) // action: () => Promise<GestureResult>
gestures.settle(gesture) // appelé depuis un effet qui observe les données réactives
gestures.markOrphaned(gesture)
gestures.running(gesture) · gestures.outcome(gesture) · gestures.blocked(gesture) · gestures.setProgress(...)
```

### 4. Le geste ne se termine pas quand la promesse se termine

`requestBeautify` rend la main avant que la requête réactive ne porte `beautifyStatus ===
'generating'`. Sans garde, le bouton redevient « Embellir » et cliquable pendant cette fenêtre. Le
serveur refuse le second appel (`convex/illustrations.ts:230-231`), donc rien n'est facturé deux fois
— mais l'écran mentirait.

Quatre corrections par rapport au tour 1 :

- **Pas de prédicat en closure.** Un `settleWhen: () => boolean` capturerait la `row` du rendu du
  clic et resterait faux pour toujours. Le règlement est donc **déclaratif** : la route déclare
  `settle: { until: 'observed' }`, et un `useEffect` qui observe les données réactives appelle
  `gestures.settle(gesture)` quand l'état attendu est présent. Ce sont les données fraîches qui
  parlent, pas une closure figée.
- **L'état attendu est la transition, pas un état terminal quelconque.** Au clic sur « Embellir » la
  ligne est déjà `idle` ; un effet autorisé à régler sur `idle | review | failed` finaliserait donc
  immédiatement, avant toute transition serveur, et la garde ne servirait à rien. L'exécution
  **capture l'état au lancement** et ne se règle que sur l'état visé — `generating` pour une
  génération — ou sur un état terminal **observé après** cette transition.
- **Un refus finalise tout de suite.** L'attente d'observation n'est armée qu'après un
  `GestureResult.ok === true`. Un refus de précondition ou de limite de débit — « Une génération est
  déjà en cours », « Trop de générations lancées » (`convex/illustrations.ts:230-239`) — ne sera suivi
  d'aucune transition réactive : le maintenir en attente gèlerait le contrôle sur un message qui est
  déjà la réponse finale. Idem pour toute exception.
- **Pas de libération aveugle au bout de 3 s.** Relâcher sans confirmation ramène exactement le
  double déclenchement que le registre existe pour empêcher. À 3 s, l'écran dit « confirmation
  retardée… » ; **le verrou tient** jusqu'à l'une de ces trois sorties, toutes portées par des
  données : l'état serveur attendu (ou un état terminal : `review`, `failed`, `idle`), une erreur de
  la requête, ou un changement d'époque. Pour l'embellissement, le bail de 90 s
  (`src/lib/illustrationWork.ts:15`) est le filet ultime : passé ce délai, le bouton « Abandonner
  cette génération » apparaît et rend la main à l'opérateur.

### 5. L'horloge ne fait pas re-rendre la page — `src/lib/clock.ts`

Une cadence de 250 ms posée sur l'état de la page reconstruirait les quarante lignes, leurs tableaux
de gestes et leurs images quatre fois par seconde. Seules les barres battent : un tick partagé
consommé par `useSyncExternalStore`, démarré à la première souscription et **arrêté à la dernière**.

Deux exigences de cette API, explicitées parce qu'elles se ratent :

- `getSnapshot` **ne rend pas `Date.now()`** — une valeur qui change à chaque appel déclenche une
  boucle de rendu. Il rend un **compteur de tick** que seul l'intervalle incrémente ; l'horloge est
  lue une fois par tick et stockée.
- `getServerSnapshot` est **obligatoire** : TanStack Start rend côté serveur. Il rend une valeur
  stable (`0`), donc aucune divergence d'hydratation.

Le battement existant à 15 s (`admin.tsx:39-42`, `admin_.illustrations.tsx:44-48`) reste tel quel :
il sert l'apparition du bouton d'abandon, pas la barre.

### 6. `-AdminButton.tsx` et `-AdminFileInput.tsx`

Les trois parcours d'envoi passent par un `<input type="file">` (`admin.tsx:108-119`,
`admin_.scan.$id.tsx:130-141`, `admin_.illustrations.tsx:310-323`) : ils reçoivent le même contrat que
les boutons, sinon les surfaces les plus lentes restent les seules muettes.

`AdminFileInput` traite aussi un défaut présent aujourd'hui : **la valeur de l'entrée est remise à
`''` immédiatement**, après avoir copié la liste des fichiers et avant de lancer le geste. Sans ça,
resélectionner le même fichier après un échec — ou après un événement refusé par le registre —
n'émet aucun `change` et l'écran paraît mort.

`AdminButton` rend les deux libellés **dans la même cellule de grille**, l'inactif en
`visibility: hidden` : la largeur est celle du plus long des deux, la ligne ne saute pas. Aucune
mesure JavaScript.

**Les conteneurs `<p>` doivent changer avant** : `MigrationBanner` (`admin_.illustrations.tsx:188-202`)
et l'alerte `imagesChanged` (`admin_.scan.$id.tsx:147-160`) rendent aujourd'hui un bouton dans un
`<p>`. Un composant qui y ajoute une barre, un résultat et un motif de blocage produirait des blocs
dans un `<p>` — HTML invalide, fermeture implicite du paragraphe. Ces deux conteneurs deviennent des
`<div>`.

Table des participes, explicite (aucune dérivation automatique du français) :

| Repos                                                 | En cours        |
| ----------------------------------------------------- | --------------- |
| Embellir / Régénérer                                  | Embellissement… |
| Accepter l'embellissement                             | Acceptation…    |
| Rejeter le candidat                                   | Rejet…          |
| Dépublier l'embellissement                            | Dépublication…  |
| Supprimer le candidat conservé                        | Suppression…    |
| Abandonner cette génération                           | Abandon…        |
| Retirer la photo / Retirer                            | Retrait…        |
| Ajouter / Remplacer la photo · Photographier une page | Envoi…          |
| Enregistrer                                           | Enregistrement… |
| Publier / Tout publier                                | Publication…    |
| Dépublier                                             | Dépublication…  |
| Supprimer                                             | Suppression…    |
| Relancer l'extraction                                 | Relance…        |
| Ajouter une recette                                   | Ajout…          |
| Lancer / Relancer la migration                        | Migration…      |
| Les corrections sont à jour                           | Enregistrement… |

### 7. `-GestureProgress.tsx` et `progressView`

```ts
export function progressView({
  startedAt,
  now,
  progress,
  estimateMs,
  floor,
}: {
  startedAt: number
  now: number
  progress: { fraction: number; text: string } | null
  estimateMs: number | null
  floor: number
}): {
  visible: boolean
  fraction: number | null
  text: string
  valueText: string
  /** Le nouveau maximum. La fonction reste pure : elle calcule, elle ne range pas. */
  nextFloor: number
}
```

Le texte de phase voyage **avec** la fraction. Le plancher monotone appartient à un `ref` **local au
composant**, réinitialisé quand le `token` change et écrit dans un effet — jamais pendant le rendu,
jamais dans le registre partagé.

| Situation                                          | `visible` | `fraction`                       | `text`                                        |
| -------------------------------------------------- | --------- | -------------------------------- | --------------------------------------------- |
| écoulé < 400 ms                                    | `false`   | —                                | `''`                                          |
| fraction connue                                    | `true`    | `progress.fraction`              | `progress.text` (`Compression 3 / 12 pages…`) |
| inconnue, estimation présente, écoulé ≤ estimation | `true`    | `min(écoulé / estimation, 0.95)` | `18 s / ~26 s d'habitude`                     |
| inconnue, écoulé > estimation                      | `true`    | `0.95`                           | `41 s · plus long que d'habitude`             |
| inconnue, aucune estimation                        | `true`    | `null`                           | `41 s · pas d'estimation`                     |

**Normalisation, testée valeur par valeur** : `now - startedAt` ramené à `0` s'il est négatif ; une
`estimateMs` non finie, `NaN` ou `≤ 0` traitée comme absente ; `fraction` bornée à `[0, 1]` puis
jamais sous `floor`. Un `aria-valuenow` invalide ou une largeur négative sont impossibles par
construction.

Le seuil de 400 ms reprend `DESIGN.md` § Résistance : « Chargement… n'apparaît qu'au-delà du délai du
routeur, jamais sur un chargement rapide. » Le plafond à 95 % empêche la barre de promettre une fin.
Quand `fraction === null`, la barre n'est pas rendue — seule la note reste.

### 8. Ce qui est annoncé, ce qui est nommé, ce qui garde le focus

- La progression **n'est pas** une région live : un `aria-live` qui change toutes les 250 ms est un
  bavardage inutilisable. `role="progressbar"` et `aria-valuetext` suffisent.
- La barre porte un **nom accessible** : `aria-labelledby` vers l'identifiant du libellé du geste
  **et** celui du titre de la ligne — « Embellissement, Tarte aux poireaux », jamais une barre
  anonyme au milieu de quarante.
- `aria-busy` va sur le **conteneur** du geste, pas sur le bouton : un bouton `disabled` est mal
  restitué et sa bascule n'est pas annoncée de façon fiable.
- Le **résultat** est la seule chose annoncée : `role="status"`, nœud **monté avec le `token` pour
  clé**, si bien que deux « Fait. » consécutifs remontent un nœud neuf et sont réannoncés.
- **La progression de la migration n'est plus une alerte.** `MigrationBanner` est aujourd'hui un
  `<p role="alert">` dont le compteur `migrated` évolue : chaque mise à jour serait annoncée
  assertivement. Le statut évolutif perd `role="alert"` ; celui-ci reste sur les erreurs et sur le
  résultat terminal.
- **Le motif de blocage** remplace les deux `title=` (`admin_.scan.$id.tsx:173`,
  `-RecipeForm.tsx:266-270`) par une ligne visible reliée par **`aria-describedby`** — `DESIGN.md`
  § Résistance : « Un attribut `title` ne compte pas : il n'est pas fiable au lecteur d'écran et
  inatteignable au toucher. »
- **Ligne qui disparaît.** Accepter, publier ou supprimer retire la recette de la liste. Ordre
  imposé, parce que Convex peut rafraîchir la requête avant que la mutation ne publie son résultat :
  la ligne absente est **marquée `orphaned`**, son exécution est **conservée jusqu'à sa résolution**,
  le résultat est **republié au niveau de la section**, et l'entrée n'est purgée qu'après. Purger dès
  la disparition ferait ignorer la complétion — c'est-à-dire perdre le seul message qui compte.
- **Le focus n'est pas volé, et ni l'instant du lancement ni celui de la disparition ne suffisent.**
  Quand l'effet constate que la ligne a quitté les données, React l'a déjà démontée et
  `document.activeElement` vaut `body` : trop tard pour savoir si le focus était dedans. Mais un
  drapeau figé au lancement est trop tôt : l'opérateur peut lancer A puis aller travailler dans B, et
  la republication de A lui volerait le focus. Ce qu'il faut est donc **le dernier endroit focalisé,
  suivi dans le temps** : un écouteur `focusin` **au niveau du `document`** tient un
  `lastFocusedRowId`, qu'il affecte à la ligne la plus proche de la cible (`closest('[data-row-id]')`)
  **ou à `null`** quand celle-ci n'appartient à aucune ligne gérée. À la republication, le focus ne se
  déplace vers le `<h2>` (`tabIndex={-1}`) que si `lastFocusedRowId` est encore celui de la ligne
  disparue.

  Un écouteur posé sur la seule section ne suffirait pas : il verrait bien le passage de la ligne A à
  la ligne B, mais pas le départ vers un contrôle **extérieur** à la section — le champ du jeton, par
  exemple. `lastFocusedRowId` resterait A, et la disparition de A volerait le focus depuis un champ
  en cours de saisie.

### 9. Les travaux serveur, pilotés par horodatage

- **Embellissement** — `row.beautifyStatus === 'generating'` et `row.beautifyStartedAt`
  (`convex/illustrations.ts:374`, `394`).
- **File d'extraction, `/admin`** — `status.currentLease.startedAt` (`admin.tsx:315-321`). Le bouton
  garde son libellé dérivé par `deriveQueueState` (`src/lib/queueStatus.ts:63-86`).
- **Relance depuis `/admin/scan/$id`** — `getScanForCorrection` **n'expose ni `startedAt` ni bail**
  (`convex/admin.ts:538-560`) : la table du tour 1 promettait une barre que les données ne portent
  pas. `startedAt: v.union(v.number(), v.null())` est donc **ajouté à cette requête et à son
  validateur** — deux lignes, additif, et l'écran cesse d'afficher « État : extracting » sans dire
  depuis quand.

**L'horloge serveur est dans le périmètre, sur les trois pages.** `/admin` corrige déjà la dérive via
`api.admin.serverTime` (`admin.tsx:44-52`) ; `/admin/illustrations` calcule `now` sur `Date.now()`
(`admin_.illustrations.tsx:38`) et afficherait un écoulé faux — barre d'emblée au-delà de
l'estimation sur un client déréglé de trente secondes ; et `/admin/scan/$id` n'a aucune horloge
aujourd'hui, or c'est précisément là qu'arrive la nouvelle barre de relance appuyée sur un
`startedAt` **serveur**. Le décalage est extrait dans `src/lib/useServerClock.ts`, appliqué sur les
**trois** pages, avec repli borné à `0` si l'appel échoue,
et **chaque appel est étiqueté par son époque** : une réponse lancée avec l'ancien jeton qui
arriverait après celle du nouveau est ignorée au lieu d'écraser l'offset courant.

### 10. L'estimation nomme le modèle en service, sinon elle se taît

Les deux journaux prennent les **200 derniers appels** puis groupent par identité
(`convex/admin.ts:464`, `convex/illustrations.ts:481`). Une moyenne pondérée par `attempts`, comme un
choix du groupe le plus récent, peut décrire un modèle **retiré du service** — l'estimation serait
fausse précisément le jour du changement de modèle.

Le client ne peut pas trancher seul : `BEAUTIFY_MODEL` est bien un constant (`src/lib/beautifyPrompt.ts:23`),
mais le modèle **et le provider** d'extraction viennent de l'environnement serveur
(`OPENROUTER_MODEL`, `OPENROUTER_PROVIDER`, `convex/extract.ts:224-226`, tous deux exigés).
**C'est donc le serveur qui marque les groupes en service.**

**Le provider entre dans l'identité de groupe.** Un même modèle servi par un autre provider peut
doubler la latence sans rien changer d'autre — c'est exactement le cas où une estimation héritée
mentirait. Les deux journaux enregistrent déjà `servedProvider` (`convex/beautify.ts:266`, et
`AttemptObservation` côté extraction) mais aucun ne l'utilise pour grouper : `JournalledAttempt`
(`src/lib/attemptStats.ts:20-28`) et `JournalledBeautifyAttempt` (`src/lib/beautifyStats.ts:25-33`)
gagnent donc `servedProvider: string | null`, qui rejoint la clé de groupe et la ligne affichée par
les blocs de statistiques. Bénéfice au-delà de l'estimation : un changement de routage devient
visible au lieu d'être moyenné avec le reste.

**Le type pur et la forme wire se séparent.** `AttemptSummary` et `BeautifySummary` sont inférés du
validateur et **rendus par les fonctions pures** `summarizeAttempts` / `summarizeBeautifyAttempts`
(`src/lib/attemptStats.ts:36-51`, `src/lib/beautifyStats.ts:69-73`) : rendre `isCurrent` obligatoire
sur ces types casserait ces fonctions au typecheck, puisque seule la requête connaît la
configuration. Donc :

```ts
// src/lib/attemptStats.ts — inchangé pour les fonctions pures
export const attemptSummaryBase = v.object({
  /* … champs actuels + servedProvider … */
})
export type AttemptSummary = Infer<typeof attemptSummaryBase>

// la forme wire, celle que la requête déclare
export const attemptSummary = v.object({
  ...attemptSummaryBase.fields,
  isCurrent: v.boolean(),
})
export type WireAttemptSummary = Infer<typeof attemptSummary>
```

La requête marque, la fonction pure résume : aucune des deux ne fait le travail de l'autre.

**L'identité configurée est lue comme l'extraction la lit.** Pas de déclaration dans
`defineApp` — `convex/convex.config.ts` ne sert qu'à `app.use(rateLimiter)`, et le dépôt lit
l'environnement par `process.env` **injectable** (`convex/extract.ts:216 : environment = process.env`),
ce qui est précisément ce qui rend `extract.ts` testable. Le plan reprend ce motif :

**L'identité comparée est complète, et les providers sont comparés dans le même espace de noms.**
Deux pièges, tous deux vérifiés dans le dépôt plutôt que supposés :

- Les groupes d'extraction sont séparés par **quatre** champs — modèle, provider, `promptVersion`,
  `schemaVersion`. Comparer les deux premiers laisserait un ancien groupe `isCurrent` après un
  changement de prompt ou de schéma, et son estimation contaminerait la barre. `PROMPT_VERSION`
  (`src/lib/recipe-prompt.ts:3`) et `RECIPE_SCHEMA_VERSION` (`src/lib/recipe-schema.ts:5`) sont des
  constants client : les quatre champs sont donc disponibles sans rien demander au serveur.
- `OPENROUTER_PROVIDER` est un **slug** (`convex/extract.ts:140-141` : `provider: { only: [provider] }`)
  tandis que `raw.provider` est un **nom d'affichage** (`convex/extract.ts:172`) : `google-ai-studio`
  d'un côté, `Google AI Studio` de l'autre. Une égalité directe ne marquerait **jamais** aucun groupe
  et la barre disparaîtrait silencieusement. Le dépôt porte déjà le remède —
  `normalizeProviderIdentifier` (`spike/openrouter.ts:121-123`, minuscules et suppression des
  espaces, tirets et underscores), utilisé par le harnais précisément pour cette comparaison
  (`spike/openrouter.ts:295-296`). Il est **recopié** dans `src/lib/provider.ts`, pas importé : le
  banc `spike/` n'est pas du code applicatif, exactement comme `BEAUTIFY_MODEL` a été recopié depuis
  `spike13/` plutôt qu'importé (`src/lib/beautifyPrompt.ts:2`).

```ts
// src/lib/provider.ts — recopié de spike/openrouter.ts:121, seul endroit où les deux
// espaces de noms d'OpenRouter (slug demandé, nom servi) se rejoignent.
export function normalizeProviderIdentifier(provider: string): string

// src/lib/currentIdentity.ts — pur, injectable, testé
export function configuredExtractionIdentity(environment: {
  OPENROUTER_MODEL?: string
  OPENROUTER_PROVIDER?: string
}): {
  model: string
  provider: string
  promptVersion: string
  schemaVersion: string
} | null
export function configuredBeautifyIdentity(): {
  model: string
  promptVersion: string
}

/** Compare un groupe à l'identité configurée, providers normalisés des deux côtés. */
export function isCurrentGroup(
  group: {
    model: string
    servedProvider: string | null
    promptVersion: string
    schemaVersion: string
  },
  identity: ReturnType<typeof configuredExtractionIdentity>,
): boolean
```

Enfin :

1. `isCurrent` est posé sur les groupes dont l'identité **est** celle configurée : les quatre champs
   pour l'extraction, provider normalisé de part et d'autre ; modèle + version de prompt pour
   l'embellissement — celui-ci ne pinne aucun provider (`convex/beautify.ts` n'en envoie pas), donc
   plusieurs providers servis peuvent y être marqués.
2. `estimateFrom(groups)` fait la moyenne des groupes `isCurrent` **pondérée par `attempts`**, et
   n'en regarde aucun autre. Un seul groupe pour l'extraction en pratique, un par provider servi pour
   l'embellissement.
3. Le total des appels `isCurrent` doit atteindre `MIN_ESTIMATE_SAMPLE = 3`. En dessous — et donc
   **au premier appel suivant un changement de modèle ou de provider, où aucun groupe n'est
   `isCurrent`** — `estimateMs === null` : pas de barre, seulement l'écoulé. Une configuration neuve
   ne se voit jamais prêter la vitesse de l'ancienne.

Réserve maintenue : `averageLatencyMs` agrège aussi les échecs techniques rapides, donc l'estimation
tire un peu vers le bas et « plus long que d'habitude » s'affiche tôt. Le message reste vrai.

### 11. Affordance — `src/styles/app.css`, section `--- admin ---`

```css
/* L'admin est un outil : le lien porte son filet en permanence. Les surfaces publiques gardent
   leur règle — nu au repos, filet au survol. */
.admin-page a {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}
.admin-page button,
.admin-page input[type='file']::file-selector-button {
  cursor: pointer;
}
@media (hover: hover) {
  .admin-page a:hover {
    color: var(--ochre-hover);
    text-decoration-color: var(--ochre);
  }
  .admin-page button:not(:disabled):hover,
  .admin-page input[type='file']:not(:disabled):hover::file-selector-button {
    color: var(--ochre-hover);
    border-color: var(--ochre-hover);
  }
}
/* Le tactile n'a pas de survol : c'est la seule confirmation qu'un doigt gras a été enregistré. */
.admin-page a:active,
.admin-page button:not(:disabled):active,
.admin-page input[type='file']:not(:disabled):active::file-selector-button {
  color: var(--ochre-hover);
}
/* Un contrôle mort le dit — le précédent est `−` du sélecteur de portions. */
.admin-page button:disabled,
.admin-page input[type='file']:disabled::file-selector-button {
  color: var(--rule-strong);
  border-color: var(--rule);
  cursor: default;
}
.gesture__bar {
  height: 2px;
  background: var(--rule);
}
.gesture__fill {
  height: 100%;
  background: var(--ochre);
}
.gesture__note,
.admin-page__blocked {
  font-size: var(--type-meta);
  color: var(--ink-muted);
  margin: 0.3rem 0 0;
}
```

Aucun aplat hors la barre, qui porte une fraction et donc une information ; aucun coin arrondi,
aucune ombre, aucun soulèvement, aucune roue, aucun squelette. `DESIGN.md` § Anti-slop s'applique à
`/admin` et reste tenu.

### 12. La liste des scans cesse de nommer une cible par son état

`listScans` renvoie `createdAt` et `drafts[].title` (`convex/admin.ts:479-524`) :

```
Scan du 12 août à 14 h 03        ← le lien, avec son filet
12 pages · 3 brouillons · terminé
Tarte aux poireaux · Soupe de courge · Clafoutis
```

L'état redevient une donnée sur la ligne au lieu d'être l'étiquette du lien.

### 13. Progression réelle de l'envoi

`uploadCompressed` (`src/lib/uploadCompressed.ts`) gagne un `onPhase?: (phase: 'compression' |
'ticket' | 'upload') => void`, propagé par `useAttachImage` et `useAttachIllustration`. Poids
cumulés : `compression` 0 → 0.60, `ticket` 0.60 → 0.65, `upload` 0.65 → 1. Sur N fichiers,
`fraction = (fichiersFaits + fractionDuFichierCourant) / N`, texte `Compression 3 / 12 pages…`.

Pas de progression en octets : `fetch` n'expose pas la progression d'envoi, il faudrait revenir à
`XMLHttpRequest` (`uploadCompressed.ts:43`), et la compression canvas domine le temps sur une photo
de téléphone.

### 14. Table exhaustive des gestes

| Surface                | Contrôle                                                            | `action`                 | Portée             | Progression                             | Résultat                                                 |
| ---------------------- | ------------------------------------------------------------------- | ------------------------ | ------------------ | --------------------------------------- | -------------------------------------------------------- |
| `/admin`               | Photographier une page                                              | `capture`                | `isolated:capture` | fraction réelle (i/N × phases)          | sous l'entrée                                            |
| `/admin`               | Démarrer / Relancer la file                                         | `extract`                | `page`             | bail serveur + estimation               | sous le bloc file                                        |
| `/admin`               | Purger la photo                                                     | `purge`                  | `row:<scanId>`     | aucune                                  | sous la ligne                                            |
| `/admin/illustrations` | Lancer / Relancer la migration                                      | `migrate`                | `page`             | **compteur, sans barre**                | sous la bannière                                         |
| `/admin/illustrations` | Embellir / Régénérer                                                | `generate`               | `row:<recipeId>`   | `beautifyStartedAt` + estimation        | sous la ligne                                            |
| `/admin/illustrations` | Accepter · Rejeter · Dépublier · Supprimer le candidat · Abandonner | `accept` …               | `row:<recipeId>`   | aucune                                  | sous la ligne, republié en section si elle disparaît     |
| `/admin/illustrations` | Ajouter / Remplacer la photo                                        | `upload`                 | `row:<recipeId>`   | fraction réelle                         | sous la ligne                                            |
| `/admin/illustrations` | Retirer la photo                                                    | `detach`                 | `row:<recipeId>`   | aucune                                  | sous la ligne                                            |
| `/admin/scan/$id`      | Ajouter une page · Retirer une page                                 | `upload` · `detachImage` | `page`             | fraction réelle · aucune                | sous le bloc images                                      |
| `/admin/scan/$id`      | Relancer l'extraction                                               | `rescan`                 | `page`             | `startedAt` (champ ajouté) + estimation | sous le bloc actions                                     |
| `/admin/scan/$id`      | Ajouter une recette · Tout publier · Les corrections sont à jour    | `addRecipe` …            | `page`             | aucune                                  | sous le bloc actions                                     |
| `/admin/scan/$id`      | Enregistrer · Publier · Dépublier · Supprimer                       | `save` …                 | `row:<recipeId>`   | aucune                                  | sous le formulaire, republié en section à la disparition |

**La migration n'a pas de barre** : `listIllustrationWork` ne rend que
`{ started, done, migrated }` (`convex/illustrations.ts:417-420`) et **aucun total** — la requête lit
un seul document, précisément pour ne pas compter la table entière. Une fraction est donc impossible
sans changer ce contrat, et le changer contredirait la raison d'être de la migration par lots. Le
geste affiche un compteur (`3 recette(s) indexée(s)`) sans `role="progressbar"`.

Les envois et retraits de pages sont de portée **page** : ils réécrivent les images du scan et posent
`imagesChangedAt`, qui bloque la publication de toutes les recettes. La capture de `/admin` est
**isolée** : elle crée des scans neufs sans rien invalider, et la file ne consomme que des scans
`pending` déjà écrits — un scan qui arrive en cours de route sera pris au tour suivant.

### 15. Tests

| Fichier                                                 | Ce qui est couvert                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/gestures.test.ts`                              | `conflicts` sur les quinze cases de la table, dans les deux sens ; `gestureId` injectif y compris avec un identifiant contenant `:` ou `"`                                                                                                                                                                                                                                                                 |
| `src/lib/gestureMessages.test.ts`                       | les cinq adaptateurs, branche par branche, `thrownMessage` sur une `Error`, une chaîne et un objet nu                                                                                                                                                                                                                                                                                                      |
| `src/lib/gestureProgress.test.ts`                       | les cinq lignes du tableau, `nextFloor` monotone, borne à 95 %, et la normalisation (`now < startedAt`, `estimateMs` à `0`, `NaN`, `Infinity`, `fraction` négative et > 1)                                                                                                                                                                                                                                 |
| `src/lib/estimate.test.ts`                              | `estimateFrom` : seuls les groupes `isCurrent` comptent, moyenne pondérée quand il y en a plusieurs ; aucun groupe `isCurrent` ⇒ `null` ; total sous `MIN_ESTIMATE_SAMPLE` ⇒ `null` ; journal vide ⇒ `null`                                                                                                                                                                                                |
| `src/lib/currentIdentity.test.ts`                       | environnement complet, `OPENROUTER_MODEL` seul, `OPENROUTER_PROVIDER` seul, aucun des deux ⇒ `null` ; `isCurrentGroup` : les quatre champs doivent concorder, un `promptVersion` ou un `schemaVersion` périmé ⇒ faux                                                                                                                                                                                       |
| `src/lib/provider.test.ts`                              | `normalizeProviderIdentifier` : `'google-ai-studio'` ↔ `'Google AI Studio'`, underscores, espaces multiples, casse turque écartée par `toLocaleLowerCase('en')`                                                                                                                                                                                                                                            |
| `convex/admin.test.ts` · `convex/illustrations.test.ts` | **la production de `isCurrent`, pas seulement sa consommation** : un groupe marqué quand l'environnement correspond, **aucun** après un changement de modèle **ou de provider**, jamais un groupe d'un autre modèle marqué. Le commentaire de `src/lib/attemptStats.ts:33-38` le dit : Convex ne vérifie pas le retour d'un handler contre son validateur à la compilation — un test est le seul garde-fou |
| `src/lib/clock.test.ts`                                 | faux timers : l'intervalle démarre à la première souscription, **est arrêté** à la dernière, `getSnapshot` stable entre deux ticks, `getServerSnapshot` constant                                                                                                                                                                                                                                           |
| `src/lib/gestureRegistry.test.ts`                       | la fonction pure de test-et-pose, hors React : seconde demande dans le même tour refusée, jeton périmé ignoré, vidage synchrone au changement d'époque, conservation d'un `Run` `orphaned` jusqu'à sa résolution                                                                                                                                                                                           |
| `src/routes/-AdminButton.test.tsx`                      | rendu figé par `react-dom/server` (`react-dom` est déjà une dépendance) : les deux libellés présents et l'inactif masqué, `aria-describedby` posé quand un motif de blocage existe, `aria-labelledby` de la barre pointant le libellé et le titre de la ligne                                                                                                                                              |

Vérification finale : `npm run test`, `npm run typecheck`, `npm run check`.

## Décisions et compromis contestables

1. **`isolated` ne croise pas `page`.** Une capture et un démarrage de file peuvent donc courir
   ensemble. Assumé : la file ne prend que des scans déjà écrits.
2. **Le verrou tient jusqu'à confirmation, sans libération temporisée.** Un geste peut donc rester en
   cours plus longtemps que l'opérateur ne l'attend, avec « confirmation retardée… » à 3 s. Le prix
   de ne pas rendre un contrôle cliquable sur une hypothèse. Les sorties restent bornées par des
   données : état visé observé, état terminal postérieur, refus ou exception, erreur de requête,
   changement d'époque, bail de 90 s.
3. **Le registre synchrone en `ref` est l'autorité, pas l'état React.** Deux sources pour une même
   vérité, l'une pour la garde, l'autre pour le rendu — seul moyen de refuser un second clic survenu
   avant le re-render.
4. **Estimation par la moyenne, pas par la médiane** : `averageLatencyMs` existe déjà, une médiane
   demanderait un calcul serveur nouveau. Biais vers le bas assumé.
5. **`isCurrent` posé par le serveur, et le provider dans l'identité de groupe.** Le serveur est le
   seul à connaître `OPENROUTER_MODEL` et `OPENROUTER_PROVIDER` ; et un même modèle servi par un autre
   provider peut doubler la latence. Coût : `servedProvider` entre dans la clé de groupe, donc la
   ligne affichée par les blocs de statistiques la nomme et un journal existant se scinde en
   plusieurs groupes à la première lecture. Lu comme un gain de diagnostic, pas comme une régression.
6. **Type pur et forme wire séparés** (`attemptSummaryBase` / `attemptSummary`) plutôt qu'un champ
   optionnel. Un `isCurrent?: boolean` laisserait la requête libre de l'oublier — précisément ce que
   Convex ne rattrape pas à la compilation.
7. **Une barre estimée reste une extrapolation.** Alternative écartée par le propriétaire : compteur
   sans barre. Garde-fous : plafond 95 %, bascule « plus long que d'habitude », aucune barre sous
   l'échantillon minimal ni hors configuration en service.
8. **La migration n'aura pas de barre**, contrairement à ce que le tour 0 promettait : le contrat
   serveur n'a pas de dénominateur, et lui en donner un annulerait l'unique lecture de document qui
   justifie la migration par lots.
9. **Le serveur bouge, un peu.** `isCurrent` sur les deux résumés, `servedProvider` dans les deux
   identités de groupe, `startedAt` sur `getScanForCorrection`. Le plan n'est donc plus « aucun
   changement serveur » ; il est « aucune migration, aucun retrait, aucune requête nouvelle ».
10. **`process.env` injectable plutôt que `defineApp({ env })`.** C'est le motif du dépôt
    (`convex/extract.ts:216`), c'est ce qui rend l'extraction testable, et `convex.config.ts` ne
    sert ici qu'aux composants.
11. **Les deux libellés rendus en permanence** figent la largeur du bouton sur le plus long des deux.
12. **`aria-busy` sur le conteneur, progression non annoncée, résultat re-monté par `token`, statut de
    migration privé de `role="alert"`.** Choix explicites contre les réflexes inverses.
13. **`lastFocusedRowId` suivi par `focusin`**, plutôt qu'un drapeau figé au lancement ou une lecture
    de `activeElement` à la disparition : le premier volerait le focus à l'opérateur parti travailler
    ailleurs, la seconde arrive après le démontage, quand `activeElement` vaut déjà `body`.
14. **`normalizeProviderIdentifier` recopié de `spike/openrouter.ts:121`**, pas importé : `spike/` est
    un banc, pas du code applicatif. Même convention que `BEAUTIFY_MODEL`, recopié de `spike13/`
    (`src/lib/beautifyPrompt.ts:2`). Coût : deux copies de trois lignes à garder cohérentes.
15. **Filet permanent sur les liens d'admin**, ce qui écarte l'admin de la sobriété des surfaces
    publiques. `DESIGN.md` libère déjà `/admin` de Fraunces, de l'échelle fluide et des encres de
    type ; seule la liste anti-slop reste contraignante, et un filet n'y figure pas.
16. **Tests de rendu par `react-dom/server` seulement.** Pas de `@testing-library`, pas de test
    navigateur : les courses sont couvertes par les fonctions pures qui les portent, et la production
    de `isCurrent` par des tests Convex. Limite reconnue.

## Risques et questions ouvertes

- **Le conflit de branche est résolu, mais il a déplacé la base.** PR #14 (`4da32eb`) a remplacé le
  `enabled: adminToken.length > 0` par le motif `adminToken ? { adminToken } : 'skip'` dans les trois
  routes, et PR #15 (`a8872ed`) a porté le prompt d'embellissement en `v4`. Le plan est réancré sur
  `a8872ed` ; les requêtes remontées au niveau page devront adopter le motif `'skip'`, pas `enabled`.
  Ce déplacement est aussi une **démonstration du point 1 du tour 4** : `BEAUTIFY_PROMPT_VERSION` est
  passé de `v3` à `v4` entre le tour 0 et le tour 4 de cette revue. Une identité de groupe qui
  ignorerait `promptVersion` estimerait aujourd'hui la vitesse de `v4` avec les latences de `v3`.
- **La fenêtre que `settle` referme est peut-être vide.** Une mutation Convex résolue est committée et
  le client reçoit un instantané cohérent ; la fenêtre visée est celle du re-render. À mesurer sur
  `requestBeautify` avant de généraliser `settle` aux autres gestes — s'il n'y a rien à refermer,
  c'est du dispositif en trop.
- **Un `Run` `orphaned` dont la promesse ne revient jamais** garde une entrée vivante jusqu'au
  changement d'époque. Borné, mais réel.
- **Une génération abandonnée côté serveur mais restée `generating`** afficherait une barre plafonnée
  à 95 % indéfiniment ; le bouton d'abandon à 90 s est le recours.
- **`isCurrent` est calculé, pas journalisé.** Si l'identité configurée change en cours de session,
  les résumés basculent d'un tour de requête à l'autre et l'estimation disparaît le temps que trois
  appels de la nouvelle configuration soient journalisés. C'est le comportement voulu, mais il se lit
  comme une régression si on ne le sait pas.
- **`servedProvider` est le provider _servi_, pas le provider _demandé_.** Côté extraction les deux
  devraient coïncider puisque `OPENROUTER_PROVIDER` est exigé, mais si OpenRouter servait autre chose
  que ce qui est pinné, aucun groupe ne serait `isCurrent` et l'estimation disparaîtrait sans qu'on
  sache pourquoi. Le bloc de statistiques nommant désormais le provider, l'écart serait au moins
  visible à l'écran.
- **Ajouter `servedProvider` à la clé de groupe fragmente les statistiques existantes.** Un journal de
  200 appels servis par deux providers affichera deux lignes là où il en affichait une, avec des
  échantillons plus petits — donc plus bruyants. Assumé.
- **Aucune télémétrie sur la qualité des estimations** (tour 1, point 21, rejeté). Si la barre mente,
  le constat viendra de l'usage.

## Hors périmètre

- Aucune migration de schéma. Trois validateurs de sortie élargis (`isCurrent` ×2, `startedAt` ×1) et
  deux identités de groupe étendues (`servedProvider`), aucun champ retiré, aucune requête nouvelle.
- Aucun changement sur les surfaces publiques (`/`, `/recette/$slug`).
- Pas de mode sombre, pas de refonte de la composition, pas de tri ni de regroupement des listes,
  pas de raccourcis clavier.
- Pas de progression en octets, pas de dénominateur de migration.
- Pas de `@testing-library`, pas de test navigateur, pas de télémétrie applicative.
