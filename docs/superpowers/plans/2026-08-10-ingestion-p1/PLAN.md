# Plan : ingestion P1 — T2 à T6 et surface d'administration minimale

_Verrouillé par grill — Claude + Florian, 2026-08-10. Révisé au round 1 de la revue Codex._
_Worktree `ingestion-p1`, base `e9fc237`._

## Goal

Finir tout ce qui reste en P1 après la fusion de PR #1 (spike T1, verdict positif) et PR #2 (socle et
vitrine) : T2 le schéma source unique, T3 la finalisation atomique, T4 la garde d'administration, T5
le garde-fou de format d'image, T6 le verrou de la ligne brute. Plus une surface d'administration
minimale, sans laquelle aucun de ces livrables n'est atteignable depuis un navigateur et le pipeline
n'aurait jamais extrait une vraie page.

Le plan est fini quand une page de magazine photographiée depuis le téléphone traverse
compression → scan → extraction → brouillons lisibles en base, pour 0,0045 USD, **et que la trace de
cette extraction dit ce qui s'est passé** : modèle servi, provider servi, latence, coût, catégorie
d'échec le cas échéant. **Rien de ce plan ne publie** : un brouillon reste un brouillon, la vitrine
n'est pas touchée, ADR 0001 n'est pas remis en cause.

## État de départ constaté

Le périmètre réel est plus petit que les fiches de tâches ne le suggèrent, parce que PR #1 et PR #2
ont livré davantage qu'elles n'annonçaient.

Déjà en place :

- `src/lib/recipe-schema.ts` — Zod d'extraction, `repairExtraction()`, `normalizeExtraction()`.
- `spike/json-schema.ts:34` — le JSON schema OpenRouter **dérive déjà** du Zod
  (`z.toJSONSchema`, zod 4.4.3), avec `enforceStrictObjects()` qui force `additionalProperties: false`
  et `required = toutes les clés`. Le premier des trois points de vérification de T2 est donc acquis
  et exercé par les 7 pages du verdict.
- `convex/schema.ts` — les tables `scans` et `recipes`, avec `attemptId`, `startedAt`, `attempts`,
  `purgeAfter`, `imageStorageIds: v.array(...)` et les cinq champs `beautify*`. PR #2 a provisionné le
  schéma de presque tout le backlog, pas seulement celui de la vitrine.
- `convex/lib/recipeWrites.ts` — `withSearchText()`, seul point d'entrée autorisé pour écrire le
  couple (titre, ingrédients).
- `src/lib/scale.ts` + 187 lignes de tests — recalcul best-effort, lignes sans `quantity` inchangées.
- 101 fixtures en succès sous `spike/fixtures/runs/` : 174 recettes, **1865 lignes d'ingrédients**
  réelles dont **1588 annotées** d'une `quantity`, `raw` vide 0 fois, 13 modèles, schéma 1 partout.
  **Aucun test ne les rejoue** : ce sont des pièces à conviction archivées, pas un harnais.

Absent : `convex/auth.ts`, `convex/extract.ts`, `src/lib/compress.ts`, `convex/convex.config.ts`,
et toute route sous `src/routes/admin/`.

**Aucune donnée de production n'existe** : T12 (câblage Vercel ↔ Convex) n'a pas tourné, rien n'est
déployé, et les seules recettes en base sont celles que `convex/seed.ts` écrit en développement. Les
champs ajoutés par ce plan peuvent donc être **requis** sans migration, à condition de mettre
`seed.ts` à jour dans la même passe.

## Approach

### 1. T2a — un seul tuple pour les six types de plat

Les six types sont épelés quatre fois : `recipeTypeSchema` (`src/lib/recipe-schema.ts:5`),
`recipeType` (`convex/schema.ts:4`), `RECIPE_TYPES` (`src/lib/recipeTypes.ts:1`), et à la main dans
`typeCounts` (`convex/recipes.ts:42`).

`RECIPE_TYPES` devient la seule liste. `recipeTypeSchema` devient `z.enum(RECIPE_TYPES)`.
`recipeType` devient `v.union(...)` dérivé du tuple.

**Critère de bascule.** `v.union` est variadique : dériver depuis un `.map()` peut dégrader le type
inféré du validateur en union large au lieu du littéral exact. Si `Infer<typeof recipeType>` cesse
d'être égal à `RecipeType`, on n'insiste pas : on garde `v.union` écrit à la main et on ajoute une
**assertion de type** qui échoue à la compilation si les deux divergent. Le verrou compte, la
dérivation est le moyen.

`typeCounts` (`convex/recipes.ts:42`) **n'est pas touché**. Son commentaire justifie l'épellation par
un échec de build en cas de dérive, et il porte sur des compteurs, pas sur la forme d'une recette —
hors de la duplication que T2 cible.

### 2. T2b — verrou de dérive sur la forme `ingredient`

Un test assied l'accord des deux définitions d'`ingredient` : mêmes clés, et la traduction
`nullable` ↔ `optional` **écrite dans le test comme la règle qu'elle est**.

Le désaccord de forme entre `.nullable()` côté Zod (`recipe-schema.ts:16-18`) et `v.optional()` côté
Convex (`convex/schema.ts:15-17`) est **délibéré et conservé** : `null` est ce que le modèle doit
pouvoir écrire, `undefined` est ce que Convex doit stocker, et `normalizeExtraction()`
(`recipe-schema.ts:121`) est le passage de l'un à l'autre. Le test le fige au lieu de le laisser
implicite.

### 3. T2c — prompt v3, `ingredientsInferred`, et **deux schémas versionnés**

`spike/RESULTS.md:90-104` laisse deux réserves ouvertes pour T2. La première est traitée ici.

Le prompt v2 interdit explicitement de déduire une ligne d'ingrédient (`spike/prompt.ts:11` : « ne
fusionne, ne divise, n'ajoute et ne déduis aucune ligne »). Sur la page E, qui n'imprime aucune
liste, le modèle en reconstitue une — correcte, complète, dans l'ordre de la prose. Le comportement
est **validé** : une fiche sans liste d'ingrédients ne servirait pas à faire les courses. Mais il
contredit le prompt, donc rien ne garantit qu'une autre page sans liste ne rende pas un tableau vide.

- **Prompt v3** : la règle est écrite. Quand la page n'imprime aucune liste d'ingrédients,
  reconstituer la liste depuis les étapes, dans l'ordre de la prose, et poser `ingredientsInferred` à
  vrai. Partout ailleurs, l'interdiction de déduire reste entière et le champ est faux.
- **Le signal est par recette** : `ingredientsInferred`. Une page imprime une liste ou n'en imprime
  pas ; ce dont l'écran de correction aura besoin est « vérifie cette liste contre la prose », qui est
  une décision par recette, pas par ligne.

**Deux schémas, pas une asymétrie.** La version précédente de ce plan gardait le champ `.optional()`
dans le Zod en s'appuyant sur `enforceStrictObjects()` pour le rendre obligatoire côté modèle. C'était
faux : `spike/RESULTS.md:106-109` établit que **`strict: true` n'est pas contraignant sur
OpenRouter** — deux providers du même modèle ont rendu `"6 à 8 personnes"` dans un champ déclaré
`number`. Un modèle peut donc omettre `ingredientsInferred`, et un validateur défensif optionnel
l'aurait accepté sans rien dire : un échec muet, exactement la famille que ce projet a déjà payée deux
fois.

À la place :

- `extractionSchemaV2` — `ingredientsInferred: z.boolean()` **requis**. C'est ce schéma qui valide
  toute réponse vivante, et c'est lui qui produit le JSON schema envoyé au modèle. Une réponse sans le
  champ est un **échec de catégorie `invalid_schema`**, visible, pas une valeur par défaut.
- `extractionSchemaV1` — conservé tel quel, **utilisé uniquement par le rejeu des fixtures
  archivées**. Il ne sert jamais à valider une réponse vivante.
- `RECIPE_SCHEMA_VERSION` passe à `'2'`. Le rejeu lit le champ `schemaVersion` de chaque fixture et
  choisit le parseur en conséquence — les 101 archives portent `"1"`.

`repairExtraction()` n'est **pas** étendu à ce champ : réparer un booléen absent revient à en inventer
la valeur, ce que le commentaire de `repairNumber` (`recipe-schema.ts:37-40`) interdit explicitement
comme principe.

### 4. T2d — le signal traverse jusqu'à la base

Un signal qui n'atteint pas la base est décoratif. `ingredientsInferred` est ajouté :

- au type `DomainExtraction` et à `normalizeExtraction()` (`recipe-schema.ts:106-138`) ;
- à la table `recipes` de `convex/schema.ts`, en **`v.boolean()` requis** — aucune donnée de
  production n'existe, `convex/seed.ts` est mis à jour dans la même passe pour écrire `false` ;
- à la mutation de finalisation de l'étape 9 ;
- au type de sortie de la query admin de l'étape 10, pour que l'écran de correction de T8 le trouve
  déjà là.

Il **n'est pas** ajouté aux types de sortie de la vitrine (`publishedRecipeRow`, `publishedRecipe`) :
c'est une information de correction, pas d'affichage, et ADR 0001 pose que les queries publiques
n'exposent que ce dont la vitrine a besoin.

### 5. T6 — harnais de rejeu des fixtures

`tasks.md:68` réduit T6 à « rejouer `scale.ts` contre les fixtures du spike » — `raw` est déjà requis
des deux côtés et `scale.ts:56` rend déjà la ligne inchangée sans `quantity`. C'est donc un harnais,
pas une construction. Il vient **avant** l'étape 6 : il garde le changement de schéma gratuitement,
avant de dépenser.

Trois assertions :

1. Les 101 fixtures en succès valident contre le parseur correspondant à leur `schemaVersion` — donc
   `extractionSchemaV1`. Verrou de dérive du schéma archivé.
2. `raw` non vide sur les 1865 lignes.
3. `scaleIngredient` sur les 1588 lignes annotées, à plusieurs facteurs, avec une **égalité exacte** et
   non un invariant flou : le texte rendu vaut précisément le préfixe de `raw`, suivi de
   `formatQuantity(scaleQuantity(quantity, factor, unit !== undefined))`, suivi du suffixe de `raw` —
   ou strictement `raw` quand `scaled: false`. Un invariant du type « seule la plage numérique
   change » aurait accepté une régression remplaçant `2` par `999`.

Et une **mesure avec plancher** : le harnais compte combien des 1588 lignes obtiennent
`scaled: true` et assied un plancher un peu sous la valeur mesurée. `scale.ts` bascule en `unchanged`
sur cinq chemins (`NUMBER_IN_RAW` muet, premier nombre discordant, `RANGE_OR_FRACTION`) et son
commentaire (`scale.ts:38-48`) raconte qu'il a produit un défaut neuf à chacune des cinq revues du
plan socle. Aucune assertion par ligne n'attrape une régression qui ferait tomber le taux de 80 % à
20 % : chaque ligne resterait correcte, plus rien ne serait recalculé. Une valeur exacte, elle,
casserait au premier ajout de fixture.

**Si le taux mesuré est bas, c'est une découverte sur `scale.ts` à remonter avant de la figer en
plancher** — pas un résultat du harnais.

### 6. T2e — rejeu des 7 pages sous prompt v3 / schéma 2

Le verdict positif a été mesuré sous prompt v2. Changer le prompt peut faire régresser le modèle et
rien ne le dirait. On rejoue donc les 7 pages, **deux passes chacune** comme au spike.

Trois niveaux de vérification, parce que la stabilité seule ne prouve pas la justesse — deux sorties
identiques peuvent omettre les mêmes lignes :

1. **Égalité stricte des deux passes**, comme au spike. C'est cette colonne, et non le prix, qui a
   séparé les huit modèles (`spike/RESULTS.md:68`).
2. **Identité ligne par ligne contre l'archive v2** sur les pages A, B, C, F, G, H. Pas les comptes :
   le texte de chaque ligne d'ingrédient et de chaque étape. La sortie v2 a été jugée à l'œil contre
   les photos au moment du spike, c'est donc une référence légitime. Toute ligne divergente est
   examinée à la main, et l'instabilité connue de la page B sur `Pour la pâte :`
   (`spike/RESULTS.md:92`) est attendue et notée, pas comptée comme régression.
3. **Attente humaine exacte pour la page E** : les 8 lignes d'ingrédients de sa première recette sont
   transcrites à la main. C'est la seule page dont le comportement change, donc la seule où l'archive
   v2 n'est pas une référence — et c'est la seule transcription manuelle du plan.

Sortie attendue : `ingredientsInferred: true` sur la page E, `false` sur les pages qui impriment une
liste. Un `true` sur une page à liste imprimée est un échec de l'étape 3, pas du modèle.

Coût : 14 appels × 0,004518 = **0,063 USD**. À ce prix, ne pas le faire serait le seul choix
déraisonnable.

### 7. T5 — `src/lib/compress.ts`, en deux étages

La version précédente de ce plan affirmait que « le décodage *est* le garde-fou ». Ce n'était vrai
qu'à moitié : `createImageBitmap()` peut allouer l'image en pleine résolution avant tout
redimensionnement, donc un fichier compact mais gigantesque en pixels tue l'onglet avant qu'un refus
puisse s'afficher. Le garde-fou précède donc le décodage.

**Étage 1 — reniflement d'en-tête, aucune allocation d'image.** Une fonction **pure** de `src/lib/`,
qui prend les premiers octets et rend un format, des dimensions, ou un refus nommé. Elle est pure
parce qu'elle est appelée **deux fois** : ici par le navigateur, et à l'étape 9 par l'action Convex
avant l'appel facturé. Écrite et testée une seule fois.

- **Formats acceptés : JPEG et PNG, rien d'autre.** JPEG `FF D8 FF`, PNG `89 50 4E 47`.
- **Dimensions intrinsèques** — marqueur `SOF` pour JPEG, `IHDR` pour PNG.
- **Refus nommés**, avant toute allocation : **HEIC/HEIF** (`ftypheic` / `ftypheix` / `ftypmif1` /
  `ftypmsf1`) avec le message « HEIC non pris en charge, convertis en JPEG » ; **WebP**
  (`RIFF …. WEBP`) reconnu et refusé explicitement ; tout autre format inconnu ; taille de fichier
  au-delà de **25 Mo** ; nombre de pixels au-delà de **50 Mpx**.

**WebP est refusé, pas parsé.** Reconnaître un format dont on ne sait pas lire les dimensions serait
une demi-mesure — l'étage 2 a besoin de l'axe long. La source est un téléphone et le pipeline se
standardise sur JPEG ; lire `VP8` / `VP8L` / `VP8X` serait du code pour un cas qui ne se présente pas.

Le refus HEIC est prononcé **par le sniff, sur tous les navigateurs**, y compris Safari qui saurait le
décoder. Comportement uniforme volontaire : on n'accepte pas un chemin qui ne fonctionne que sur une
machine. `tasks.md:214` classe la conversion HEIC non retenue.

**Étage 2 — décodage redimensionnant.**
`createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth | resizeHeight, resizeQuality: 'high' })`,
avec **un seul** des deux axes fixé — celui que l'étage 1 a mesuré comme le plus long — pour que le
rapport d'aspect soit préservé et que le décodeur ne matérialise jamais la pleine résolution.

- **Les chiffres du spike, à l'identique** : le côté long ramené à **2000 px** sans agrandissement,
  puis JPEG **qualité 80** (`spike/ingest.ts:32-42`). Sinon le navigateur envoie au modèle des images
  qui ne ressemblent à rien de ce qui a été mesuré, et le verdict ne couvre plus la production.
- **`imageOrientation: 'from-image'` est obligatoire.** Redessiner dans un canvas efface toutes les
  métadonnées — ce qui règle le GPS que `ingest.ts:54` signale — mais efface aussi l'orientation
  EXIF. Sans ce drapeau, une page photographiée en portrait arrive **couchée** chez le modèle : échec
  muet exactement de la famille que le spike a traquée.
- **Plafond de sortie** : 4 Mo après compression, comme filet sur le cas pathologique. Les fixtures du
  spike pèsent 500 à 700 Ko.

`compress.ts` rend soit un `Blob` compressé avec ses dimensions, soit un refus **nommé** — jamais un
booléen. Le message est ce que l'humain lira.

### 8. T4 — `convex/auth.ts`, la frontière d'upload, et deux étages de plafond

`tasks.md:98` fixe le mécanisme : « secret aléatoire fort en variable d'environnement », testé « sur
une query autant que sur une mutation ». Un jeton partagé comparé à `process.env.ADMIN_TOKEN` — un
seul humain, une archive domestique, pas de fournisseur OAuth. `convex/env.d.ts` déclare déjà
`process.env`, et `convex/devImages.ts:10` / `convex/seed.ts:260` établissent le patron du geste
gardé par un drapeau d'environnement.

**Le jeton n'est jamais une variable de build.** Un `VITE_ADMIN_TOKEN` serait empaqueté dans le bundle
et lisible par quiconque charge la page ; `requireAdmin` vérifierait alors un secret que le monde
entier possède. Il est saisi à la main sur `/admin`, gardé en `sessionStorage`, et passé en **argument
explicite** — `args: { adminToken: v.string() }`. C'est laid, et c'est ce qui rend la garde uniforme
sur les queries, les mutations et les actions, ce que `tasks.md:93` exige parce que les queries Convex
sont publiques par défaut.

**Le jeton ne franchit pas la frontière interne.** Toute fonction `internal*` — réservation,
finalisation, échec, continuation de la file — ne reçoit **aucun jeton**. Un secret placé dans les
arguments d'une tâche planifiée serait persisté dans le journal du scheduler. La garde s'applique
exactement une fois, au point d'entrée public.

**Comparaison en temps constant.** Pas parce qu'une attaque temporelle sur 32 octets à travers la
gigue réseau est crédible ici, mais parce que la version correcte coûte cinq lignes. Refus si
`ADMIN_TOKEN` est absent ou vide côté serveur — jamais de comparaison contre une valeur vide.

**ADR 0001 n'est pas touché.** `browse`, `countsByType` et `getBySlug` restent publiques et continuent
de rendre `PublishedRecipeRow`. `requireAdmin` garde les **nouvelles** queries admin.

**La frontière d'upload, complètement décrite :**

Un **ticket d'upload à usage unique**. Table `uploadTickets` : `createdAt`, `consumedAt` optionnel,
`storageId` optionnel, `scanId` optionnel, **`outcome` optionnel** (`ok` ou la catégorie de refus) et
**`error` optionnel**, index sur `createdAt`.

1. `admin.generateUploadUrl` — mutation publique, `requireAdmin`, **seul point où la limite
   `scanCreation` est consommée**. Insère un ticket et rend `{ uploadUrl, ticketId }`.
2. Le navigateur téléverse le `Blob` compressé et récupère un `storageId`.
3. `admin.createScan({ adminToken, ticketId, storageId })` — `requireAdmin`, **sans nouvelle
   consommation de quota** : une URL déjà accordée doit pouvoir être finalisée. Puis, dans une seule
   transaction : ticket inconnu → refus ; ticket **déjà consommé portant le même `storageId`** → on rend
   son `scanId` (voir l'idempotence ci-dessous) ; ticket consommé avec un `storageId` différent →
   refus ; `ctx.db.system.get('_storage', storageId)` — signature exacte de `guidelines.md:451`, retour
   `FileMetadata | null`, un `null` est un refus ; `size` au-delà du plafond → refus. Sur **toute issue
   terminale, succès ou refus**, le ticket est consommé et lié au `storageId` présenté, avec son
   `outcome` et son `error`.

**Ce que le ticket fait, et ce qu'il ne fait pas.** Il ne prouve **rien** sur la provenance d'un blob :
`ctx.storage.generateUploadUrl()` ne rend aucun identifiant que le serveur puisse corréler au
`storageId` que le téléversement produira — le serveur apprend ce `storageId` par la bouche du client,
qui pourrait en présenter n'importe quel autre. Le ticket fait deux choses réelles : il **lie une
création de scan à une consommation de quota**, et il sert de **jeton d'idempotence**.

**P1 ne supprime aucun blob.** Une version précédente de ce plan supprimait le blob en cas de
dépassement de taille, en s'appuyant sur le ticket comme preuve de provenance — raisonnement circulaire.
Sans cette preuve, supprimer un `storageId` fourni par le client est une primitive dangereuse : il
suffirait de présenter l'identifiant de la photo d'une recette existante pour la faire détruire, alors
que `tasks.md:167` pose que l'originale « est stockée définitivement et n'est jamais purgée ». Un refus
laisse donc le blob en place ; il rejoint les orphelins déjà acceptés et chiffrés plus bas. Une
suppression sûre demanderait un téléversement médié par le serveur, qui appellerait lui-même
`ctx.storage.store()` — hors du périmètre de P1.

**Idempotence sur perte de réponse.** Le réseau peut tomber après que la mutation a commité : l'issue
est décidée, le ticket est consommé, et le client n'a rien reçu. Un simple « ticket déjà consommé »
ferait perdre l'information à l'humain. Une reprise présentant le **même** `storageId` **rejoue l'issue
terminale enregistrée** — le `scanId` sur un succès, le refus et son message sur un refus. Une reprise
avec un `storageId` différent est refusée. C'est pourquoi le ticket porte `outcome` et `error` et pas
seulement `scanId` : sans eux, seuls les succès seraient rejouables.

**Exactement un `storageId` en P1.** `imageStorageIds` reste un tableau — c'est le contrat de T8, qui
porte le scan multi-images — mais P1 écrit un tableau à un élément et refuse toute autre cardinalité.
Un tableau vide créerait un scan inexploitable, et plusieurs identifiants contourneraient les
hypothèses de coût de ce plan.

**Le refus est une valeur de retour, pas une exception.** `createScan` rend `{ ok: false, error }`.
Une mutation Convex est une transaction : lever annulerait **la consommation du ticket** avec le reste,
et un ticket refusé redeviendrait présentable. Le refus doit être commité pour que sa trace le soit.

**`contentType` n'est pas une vérification de format.** C'est ce que le client a déclaré au
téléversement : un HEIC étiqueté `image/jpeg` le traverserait sans broncher. Le format réel est
vérifié par reniflement d'octets magiques **côté serveur, dans l'action, avant l'appel facturé** —
étape 9. `createScan` ne vérifie donc que la taille ; il n'a pas accès au contenu du blob, une mutation
ne pouvant pas lire le stockage.

Le plafond en octets est vérifié **des deux côtés** : `compress.ts` pour un message lisible, Convex
pour l'invariant. `compress.ts` vit dans le navigateur, ce n'est pas une frontière.

**Purge des tickets périmés, et rien d'autre.** `internal.extract.sweepTickets` — `internalMutation`
bornée, indexée sur `createdAt`, qui supprime les **lignes** de tickets périmés, dans les deux états :

- **non consommés** au-delà d'un délai de grâce majorant largement la durée d'un téléversement ;
- **consommés** au-delà d'une fenêtre d'idempotence — plus longue, puisque c'est elle qui borne combien
  de temps une reprise réseau peut encore rejouer son issue. Sans cette seconde branche, la table ne
  cesserait jamais de croître.

Elle **ne supprime aucun blob**, donc elle ne peut pas détruire de données. Appelée en fin de cycle de
vidage, quand la file rend `no_work` — sans cron, que `tasks.md:214` écarte.

**Ce que cette purge ne fait pas, et pourquoi.** Un téléversement suivi d'aucun appel à `createScan`
laisse un blob dont **le serveur n'apprend jamais le `storageId`**. Aucune table ne peut contenir une
ligne pour un identifiant qui ne lui a pas été communiqué : le seul moyen de retrouver ce blob est
d'énumérer `_storage`, et une énumération n'est sûre qu'une fois **tous** les propriétaires connus —
`scans.imageStorageIds`, mais aussi `recipes.imageStorageId` et `recipes.beautifiedStorageId`. Un
balayage naïf supprimerait les photos des recettes. Cette réclamation appartient donc à **T7**, avec la
machinerie de purge, un curseur persistant et la liste complète des propriétaires. L'arithmétique de la
fuite d'ici là : environ 600 Ko par upload abandonné, ce qui suppose que l'onglet meure entre deux
appels adjacents, pour un seul administrateur — quelques mégaoctets par an contre un palier gratuit qui
en offre mille.

**Politique de limitation, exécutable et non décorative.** `@convex-dev/rate-limiter` monté via
`convex/convex.config.ts` (fichier nouveau), avec deux limites nommées, sans clé — un seul
administrateur :

| Limite         | Type         | Quota | Période | Burst | Consommée dans                          |
| -------------- | ------------ | ----- | ------- | ----- | --------------------------------------- |
| `scanCreation` | token bucket | 30    | 1 h     | 10    | `generateUploadUrl` **uniquement**       |
| `extraction`   | fixed window | 60    | 1 h     | —     | `reserve`, **en dernier** (voir étape 9) |

Un seul jeton par scan : consommer aussi dans `createScan` aurait divisé le quota réel par deux et
ouvert une fenêtre de refus après stockage du blob.

**Le plafond dur est hors de l'application** : une clé OpenRouter dédiée, plafonnée en crédit chez
OpenRouter. Un plafond côté fournisseur ne peut pas être contourné par un bug de notre côté ; c'est la
seule garde qui borne la perte maximale. Le rate limiter empêche le vol du jeton de vider ce plafond
en une minute, il ne le remplace pas.

**Tests exigés** : jeton valide, invalide, absent — sur une query **et** sur une mutation ;
dépassement de quota ; deux consommations concurrentes ; `retryAfter` propagé jusqu'à l'appelant.

### 9. T3 — `convex/extract.ts`

`fetch()` est disponible dans le runtime Convex par défaut (`guidelines.md:354`) : **pas de
`"use node"`**, ce qui permet de garder l'action et ses mutations internes dans le même fichier
(`guidelines.md:353` l'interdirait sinon).

**Point d'entrée.** `admin.startExtraction` — mutation **publique**, `requireAdmin`, qui ne fait
qu'une chose : `ctx.scheduler.runAfter(0, internal.extract.drain)`. Aucun jeton au-delà.

**Un lease global, pas une réservation par scan.** La version précédente de ce plan affirmait « jamais
deux appels OpenRouter facturés en parallèle » et c'était faux : deux clics concurrents réservaient
deux scans **différents**, chacun passant son propre appel. La réservation refuse donc désormais
**tant qu'il existe un scan `extracting` dont le lease n'a pas expiré** — un balayage de l'index
`by_status` existant, sans document singleton. Comme un seul worker peut détenir le lease, un seul
worker peut porter une continuation : la duplication de planification disparaît avec la même
correction.

**`internal.extract.reserve`** — `internalMutation`. Dans une seule transaction, et **dans cet
ordre** :

1. Refuser si un lease vivant existe → `lease_held`.
2. Chercher le plus ancien `pending` sous le plafond d'`attempts`, ou un `extracting` dont le lease a
   expiré. Rien à faire → `no_work`.
3. **Alors seulement** consommer la limite `extraction`. Refusée → `rate_limited` avec son
   `retryAfter`.
4. Poser `status: 'extracting'`, un `attemptId` neuf, `startedAt`, incrémenter `attempts`.

**L'ordre est le correctif, pas un détail de style.** Consommer le quota en premier — ce que disait la
version précédente de ce plan — laisse un double-clic ou deux continuations concurrentes brûler les 60
unités de l'heure sans passer un seul appel utile : le quota serait épuisé par des workers qui n'ont
rien trouvé à faire.

La réclamation d'un lease expiré est ce qui évite qu'un plantage de l'action entre réservation et
finalisation bloque le scan pour toujours — P1 n'a aucun autre chemin de reprise, le bouton de relance
étant en T10.

**Contrainte de durée du lease, calculable et non arbitraire :**

```
LEASE_MS > REQUEST_TIMEOUT_MS × MAX_ATTEMPTS + marge
```

L'idempotence protège les **écritures**, pas la **dépense** : si le lease expire pendant qu'un appel
OpenRouter est encore en vol, un second worker part sur le même scan et la page est facturée deux
fois. Le premier verra sa finalisation rejetée — les données restent justes, l'argent est parti.
`LEASE_MS` doit donc majorer la durée maximale d'un appel *avec* ses retries, pas sa latence moyenne
de 6,1 s. `REQUEST_TIMEOUT_MS` est fixé explicitement et les deux sont des constantes nommées dans le
même fichier, avec le calcul en commentaire.

**Machine d'états complète.** Trois issues, jamais deux :

| Issue                                        | Mutation                         | Effet                                                          |
| -------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| Extraction valide, au moins une recette      | `internal.extract.finalize`      | écrit les brouillons + `status: 'done'`                         |
| Échec **terminal**, quel que soit `attempts`  | `internal.extract.recordFailure` | `status: 'failed'`, `error` — sort de la file immédiatement     |
| Échec retryable, `attempts` sous le plafond  | `internal.extract.recordFailure` | `status: 'pending'`, `error`, lease libéré — le scan repassera  |
| Échec retryable, `attempts` au plafond       | `internal.extract.recordFailure` | `status: 'failed'`, `error` — sort de la file                   |

Les deux mutations sont **clôturées par `attemptId`** : elles ne font rien si l'`attemptId` du
document ne correspond plus à celui qu'on leur passe (`tasks.md:90`). Une relance après échec partiel
ne crée aucun doublon.

Catégories d'échec, nommées et stockées : `refusal`, `truncated`, `invalid_json`, `invalid_schema`,
`timeout`, `transport`, `no_recipes`, **`invalid_image`**. « Traité comme un échec » sans taxonomie ne
se diagnostique pas.

**Règle de classement, et elle est courte : une catégorie est terminale si et seulement si une reprise
sur des octets identiques ne peut pas changer l'issue.** `invalid_image` est la seule qui la satisfait —
le fichier ne changera pas, donc le reniflement rendra le même verdict, et sans cette règle le même blob
serait réservé et relu jusqu'au plafond d'`attempts` en tenant le lease à chaque fois. Tout ce qui vient
du modèle est **retryable** : le spike a mesuré que quatre modèles sur huit rendent une extraction
différente à deux appels identiques (`spike/RESULTS.md:24-28`), donc un refus, une troncature ou un
schéma invalide peuvent parfaitement ne pas se reproduire.

**`invalid_image` : le format réel est vérifié ici, avant de dépenser.** L'action lit le blob, passe
ses premiers octets au **même sniff pur** que `compress.ts` (étape 7), et échoue en `invalid_image`
**avant tout appel facturé** si le format ne correspond pas à un JPEG ou un PNG. `contentType` dans les
métadonnées `_storage` est déclaré par le client : sans ce contrôle, un HEIC étiqueté `image/jpeg`
arriverait chez OpenRouter et serait facturé pour rien.

`finalize` écrit les recettes via `withSearchText()`, en `status: 'review'`, **sans `slug`** — un
brouillon n'en a pas (ADR 0001) — avec `ingredientsInferred` tel que rendu par le modèle.

**La file se vide, continue après un échec, et reprend après un rate-limit.**
`internal.extract.drain` — `internalAction` : réserve, extrait, finalise ou enregistre l'échec, puis
`ctx.scheduler.runAfter(0, internal.extract.drain)`.

- Elle se replanifie **aussi après un échec** — un scan qui échoue ne doit pas arrêter la file.
- Sur `rate_limited`, elle se replanifie **à `retryAfter`**, pas à l'arrêt. Une action planifiée n'a
  pas d'appelant : « enregistrer le `retryAfter` » sans le reprogrammer laisserait la file à moitié
  vidée et personne pour lire la valeur.
- Elle s'arrête sur `lease_held` — un autre worker travaille — et sur `no_work`, où elle appelle
  `sweepTickets` avant de rendre la main.

Le plafond d'`attempts` est le garde-fou anti-boucle : sans lui, l'auto-replanification est une boucle
infinie facturée.

**Observabilité dès P1, pas reportée à T11.** Sur chaque scan, un objet `lastAttempt` :
`attemptId`, `model`, `servedProvider`, `latencyMs`, `costUsd`, `failureKind` le cas échéant, et le
nombre de réparations qu'a produites `repairExtraction()`. **Ni réponse brute, ni jeton, ni clé.**
Sans ça, la première vraie extraction ne permet pas de distinguer un timeout d'un refus, ni de voir
qu'un provider inattendu a servi la requête. La journalisation **par tentative** dans une table dédiée
reste T11 ; `lastAttempt` est conçu pour y déménager.

**L'image part en data URI base64**, comme `spike/openrouter.ts:400-403`, pas via
`ctx.storage.getUrl()`. Une URL de stockage éviterait l'encodage, mais c'est un changement non mesuré
sur la chose exacte validée sur 7 pages, et tous les providers ne vont pas chercher les URLs
distantes. **L'encodage se fait par tranches** sur un `Uint8Array` : `String.fromCharCode(...tableau)`
fait sauter la pile sur plusieurs centaines de kilo-octets, et il n'y a pas de `Buffer` dans l'isolat.

**Portage minimal, pas réutilisation.** `spike/openrouter.ts` fait 13,9 K dont l'essentiel est de la
machinerie d'échelle — `supportsTemperature`, `disableReasoning`, replay sur
`Reasoning is mandatory`, comptabilité de budget — utile pour comparer 412 endpoints, inutile pour
appeler le seul modèle retenu. Et il lit avec `node:fs` et encode via `Buffer`, donc il n'est pas
portable tel quel. Ce qu'on reprend : le prompt, le JSON schema dérivé du Zod, `repairExtraction()`,
et le fait que `strict: true` **n'est pas contraignant** (`spike/RESULTS.md:106-109`) — la validation
reste défensive à la réception.

Le durcissement complet de l'appel et la journalisation par tentative sont **T11, en P2**. Ici :
`strict: true`, `require_parameters: true`, modèle et provider figés en variables d'environnement,
refus et troncatures traités comme des échecs **catégorisés**.

### 10. Surface d'administration minimale

Une route `/admin`, et une frontière serrée :

1. Le champ de saisie du jeton, gardé en `sessionStorage`.
2. Un sélecteur de fichier qui passe par `compress.ts`, téléverse, et appelle `createScan`. Les refus
   de `compress.ts` s'affichent avec leur message nommé.
3. Une liste brute des scans — statut, nombre d'images, nombre de brouillons produits, catégorie
   d'échec et `lastAttempt`. **Cette liste est la query admin que T4 doit garder** : elle cesse d'être
   hypothétique. Son type de sortie est explicite, pas le document brut (ADR 0001).
4. Un bouton nu qui appelle `startExtraction`, sans les compteurs `pending`/`extracting` ni la
   sémantique de relance de T10.

`/admin` n'est pas la vitrine, mais utilise les jetons de `src/styles/tokens.css` pour ne pas
introduire un second système visuel. `DESIGN.md` régit les surfaces publiques.

### 11. Preuve de bout en bout

Une vraie page de magazine, photographiée depuis le téléphone, traverse `compress.ts` → scan →
extraction → brouillons lisibles en base, **et `lastAttempt` raconte l'appel**. C'est le seul critère
d'acceptation du plan qui ne soit pas un test unitaire. Coût : 0,0045 USD.

### 12. Mettre à jour le journal des tâches

Cocher T2 à T6 dans `docs/superpowers/specs/2026-08-08-table-des-recettes-tasks.md` et y noter ce que
PR #2 avait déjà provisionné, pour que la prochaine passe ne redécouvre pas le décalage entre les
fiches et le code.

## Key decisions & tradeoffs

1. **Pas de pont Zod→Convex ; un tuple unique et un test de dérive.** `convex-helpers` n'est pas
   installé, la table `recipes` porte 16 champs dont le Zod n'en décrit que 5, `searchText` est
   explicitement interdit au schéma d'extraction (`tasks.md:80`), et le désaccord
   `nullable`/`optional` est un choix juste qu'une dérivation mécanique écraserait. `tasks.md:79`
   demande que le choix du pont soit explicite — un test nommé est un choix explicite ; il ne demande
   pas qu'un pont existe. **Ce qu'on perd** : un champ ajouté au Zod ne se propage pas en base tout
   seul. Le test échoue jusqu'à ce qu'il soit écrit aux deux endroits. C'est un rappel, pas une
   génération.
2. **Deux schémas versionnés, pas un champ optionnel.** `ingredientsInferred` est **requis** dans le
   schéma qui valide les réponses vivantes. Puisque `strict: true` n'est pas contraignant sur
   OpenRouter, un champ optionnel aurait laissé passer une omission en silence. Les 101 fixtures
   archivées sont lues par le parseur v1, choisi d'après leur propre champ `schemaVersion`. **Ce qu'on
   paie** : deux schémas à maintenir, et un rejeu qui doit router selon la version.
3. **Le signal de déduction est par recette, pas par ligne**, et il traverse jusqu'à la base. Le cas
   partiel — une page qui imprime une liste incomplète et complète le reste en prose — n'est pas
   couvert. Accepté : aucune des 7 pages ne le présente.
4. **`@convex-dev/workpool` refusé, `@convex-dev/rate-limiter` pris.** `attemptId` n'est pas de la
   sérialisation, c'est une clôture d'idempotence sur l'écriture finale ; workpool **suppose**
   l'idempotence (« retry only idempotent actions ») au lieu de la fournir, il ne remplacerait donc
   que le déclenchement, pour une file dont la profondeur réelle est de un à cinq scans avec un seul
   humain devant. Le rate limiter, lui, fait une chose qu'on coderait mal à la main
   (`guidelines.md:320`), et il arrive avec une politique chiffrée plutôt qu'une intention : **un seul
   jeton par scan**, consommé à la génération d'URL ; et pour l'extraction, consommé **en dernier**,
   après avoir constaté qu'il y a bien du travail — sinon des workers à vide épuisent le quota.
5. **Un lease global sérialise la file ; le plafond d'`attempts` borne la boucle.** La réservation
   refuse tant qu'un lease vivant existe, ce qui rend vraie l'affirmation « un seul appel OpenRouter à
   la fois » et supprime du même coup la duplication de continuations.
6. **`LEASE_MS > REQUEST_TIMEOUT_MS × MAX_ATTEMPTS + marge`, comme contrainte écrite.** L'idempotence
   protège les écritures, pas la dépense : un lease trop court fait payer la même page deux fois.
7. **Le jeton d'admin est vérifié exactement une fois, au point d'entrée public**, et ne franchit
   jamais la frontière interne — un secret dans les arguments d'une tâche planifiée serait persisté
   dans le journal du scheduler.
8. **Le garde-fou d'image précède le décodage, et il est vérifié deux fois.** Le sniff d'en-tête est
   une fonction pure de `src/lib/` qui donne format, dimensions et plafond de pixels sans allouer
   d'image ; le décodage redimensionne ensuite en un seul passage. Le **même** sniff tourne côté
   serveur avant l'appel facturé, parce que `contentType` dans les métadonnées `_storage` est déclaré
   par le client et ne prouve rien. Formats acceptés : JPEG et PNG. HEIC et WebP sont refusés
   explicitement, uniformément sur tous les navigateurs — Safari compris, qui saurait décoder le HEIC.
9. **Un refus de `createScan` est une valeur de retour, pas une exception.** Une mutation Convex est
   une transaction : lever annulerait la consommation du ticket avec le reste, et un ticket refusé
   redeviendrait présentable.
10. **P1 ne supprime aucun blob, et le ticket d'upload n'est pas une preuve de provenance.**
    `generateUploadUrl` ne rend aucun identifiant corrélable au `storageId` produit : le serveur
    l'apprend du client. Supprimer un `storageId` fourni par le client serait donc une primitive de
    destruction offerte à l'appelant. Le ticket sert à ce qu'il sait faire — lier une création de scan à
    une consommation de quota, et servir de jeton d'idempotence sur perte de réponse réseau.
    Corollaire : **la réclamation des blobs orphelins reste hors de P1**, avec T7, où un balayage de
    `_storage` pourra être sûr une fois tous les propriétaires connus. Ce qu'on purge ici, ce sont des
    **lignes** de tickets périmés, jamais des octets.
11. **Une catégorie d'échec est terminale si et seulement si une reprise sur des octets identiques ne
    peut pas changer l'issue.** `invalid_image` est la seule ; tout ce qui vient du modèle est retryable,
    parce que le spike a mesuré que quatre modèles sur huit rendent une sortie différente à deux appels
    identiques.
12. **Exactement un `storageId` par scan en P1.** `imageStorageIds` reste un tableau parce que c'est le
    contrat de T8, mais toute autre cardinalité est refusée à l'entrée.
13. **L'observabilité entre en P1.** Un pipeline dont la première exécution réelle ne dit pas ce qui
   s'est passé n'est pas livrable, même si tous ses tests unitaires passent.
14. **La surface d'administration minimale entre dans le périmètre.** Sans elle, ce plan livrerait une
    action que rien ne déclenche, une compression que rien n'appelle et une garde qui vérifie un jeton
    que rien ne fournit — et n'aurait aucun critère d'acceptation qui ne soit pas un test unitaire. Le
    projet a déjà payé deux fois ce mode d'échec : le spike existe parce que l'hypothèse centrale
    n'avait jamais été vérifiée (`tasks.md:14`), ADR 0001 existe parce qu'un `?? ""` fabriquait un
    lien mort que personne n'avait cliqué.
15. **Le prompt change, donc on remesure — et on mesure la justesse, pas seulement la stabilité.**
    0,063 USD, avec identité ligne par ligne contre l'archive v2 et une attente humaine sur la seule
    page dont le comportement change.

## Risks / open questions

- **Typage variadique de `v.union`.** Dériver le validateur depuis un `.map()` sur le tuple peut
  dégrader le type inféré. Critère de bascule écrit à l'étape 1 : si `Infer<typeof recipeType>` cesse
  d'égaler `RecipeType`, on garde le validateur écrit à la main plus une assertion de type.
- **Le prompt v3 peut faire régresser le modèle sans que 14 appels le montrent.** Le spike a établi
  que le discriminant réel est la stabilité entre deux appels identiques, et deux passes sur sept
  pages restent un petit échantillon. La comparaison ligne par ligne contre l'archive v2 réduit le
  risque bien plus que les comptes seuls, elle ne l'annule pas.
- **`sessionStorage` est lisible par un XSS sur `/admin`.** Accepté pour une archive domestique à un
  seul administrateur. Un jeton en cookie `HttpOnly` demanderait un point de terminaison serveur que
  ce plan n'a pas.
- **Le sniff d'en-tête est du code à écrire correctement du premier coup.** Le marqueur `SOF` d'un
  JPEG demande de sauter les segments, et un JPEG progressif ou tronqué doit produire un refus nommé
  plutôt qu'une exception. À tester sur les 8 pages de `spike/fixtures/pages/`, qui sont des JPEG
  réels sortis du même pipeline.
- **`resizeWidth` sans `resizeHeight` dépend du navigateur.** La spécification préserve le rapport
  d'aspect quand un seul axe est donné ; si un navigateur cible s'en écarte, il faut retomber sur un
  redimensionnement au canvas et documenter que le pic mémoire n'est alors plus borné par le décodeur.
- **Le plancher du taux de recalcul n'est pas encore connu.** Il sera mesuré à l'écriture du test de
  l'étape 5 puis posé un peu en dessous. Si le taux réel s'avère bas, c'est une découverte sur
  `scale.ts` à remonter avant d'être figée en plancher.
- **Les chiffres de quota sont des premières valeurs, pas des mesures.** 30 scans et 60 extractions à
  l'heure sont dimensionnés sur un humain qui numérise une pile de magazines. Ils sont dans une
  constante nommée, et le premier usage réel dira s'ils gênent.
- **Monter un premier composant Convex crée `convex/convex.config.ts`.** Fichier nouveau, effet sur
  le déploiement à vérifier avant T12.
- **Les deux délais de `sweepTickets` sont des chiffres à poser.** Le délai des tickets **non
  consommés** doit majorer largement la durée d'un téléversement : purger un ticket encore en vol ferait
  échouer un `createScan` légitime — un refus visible, pas une perte de données, mais inutile. La
  fenêtre d'idempotence des tickets **consommés** borne combien de temps une reprise réseau peut rejouer
  son issue ; trop courte, une reprise tardive ne retrouve pas son `scanId`. La borne `.take(n)` doit
  tenir dans les limites de transaction rappelées par `guidelines.md:334`.
- **Les blobs orphelins s'accumulent jusqu'à T7.** Assumé et chiffré : environ 600 Ko par upload
  abandonné, ce qui suppose que l'onglet meure entre deux appels adjacents. Un balayage de `_storage`
  ne devient sûr qu'avec la liste complète des propriétaires, `recipes.imageStorageId` et
  `beautifiedStorageId` compris.

## Out of scope

- **T7** rétention `purgeAfter` — le champ et son index existent, la logique attend. **Et la
  réclamation des blobs orphelins**, qui exige un balayage de `_storage` avec curseur persistant et la
  liste complète des propriétaires (`scans.imageStorageIds`, `recipes.imageStorageId`,
  `recipes.beautifiedStorageId`). Ce plan ne purge que des **lignes** de tickets périmés.
- **T8** scan multi-images et écran de correction, avec ajout et suppression de recettes.
- **T9** export versionné dans git.
- **T10** compteurs `pending`/`extracting` et sémantique de relance. Ce plan pose un bouton nu.
- **T11** durcissement complet de l'appel et journalisation par tentative dans une table dédiée. Ce
  plan pose `lastAttempt` sur le scan, conçu pour y déménager.
- **T12** câblage Convex ↔ Vercel.
- **T13** / **T14** embellissement — spike en cours dans un autre worktree, hors de ce plan.
- **La publication d'un brouillon.** Aucune écriture de `slug`, `publishedAt` ou
  `status: 'published'`. La vitrine ne change pas.
- **La conversion HEIC dans le navigateur** (`tasks.md:214`).
- **Le cron de surveillance de la file** (`tasks.md:214`).
- **La deuxième réserve du spike** (`spike/RESULTS.md:92`) — l'instabilité de la page B sur les
  étiquettes de section (`Pour la pâte :` entrant une passe sur deux dans la ligne d'ingrédient).
  Sans conséquence sur les comptes, et la corriger demanderait une troisième révision de prompt donc
  un troisième rejeu. Attendue et notée dans la comparaison de l'étape 6, ouverte pour T11.
