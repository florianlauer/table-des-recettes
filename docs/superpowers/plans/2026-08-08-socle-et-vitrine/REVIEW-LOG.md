# Plan Review Log — Socle et vitrine publique

Acte 1 (grill-with-docs) terminé. Plan verrouillé, `CONTEXT.md` créé, ADR 0001 écrit.

- `PLAN_FILE` = `docs/superpowers/plans/2026-08-08-socle-et-vitrine/PLAN.md`
- `LOG_FILE` = `docs/superpowers/plans/2026-08-08-socle-et-vitrine/REVIEW-LOG.md`
- `MAX_ROUNDS` = 5
- Codex CLI 0.144.5, modèle `gpt-5.6-sol`, effort `medium`

## Acte 1 — arbitrages du grill

| # | Question | Décision | Trace |
|---|---|---|---|
| 1 | `slug` typé `string?` alors qu'une recette publiée en a toujours un | Frontière de lecture : les queries publiques rendent `PublishedRecipe` avec `slug: string` obligatoire ; une publication sans slug lève | [ADR 0001](../../../adr/0001-frontiere-de-lecture-brouillon-publie.md) |
| 2 | Recherche tronquée à 50 sans le dire | `.take(1024)`, plafond dur Convex — la troncature cesse d'exister | plan, tâche 8 |
| 3 | Le recalcul produit `0 g de sel` en divisant | Trois paliers : entier > 10, demi de 1 à 10, quart en dessous, plancher `0,25` | plan, tâche 5 |
| 4 | La substitution du nombre laisse `1 œufs` | Accord au singulier sous 2, avec liste d'invariables français | plan, tâche 5 |

Décision prise sans question, avec sa raison : le marqueur `†` des lignes non recalculées est
conservé et inscrit dans `DESIGN.md`. Un signal porté par la seule couleur échouerait sur la
contrainte de lisibilité dégradée posée par `PRODUCT.md`.

Défauts corrigés au passage : `params={{ slug: recipe.slug ?? "" }}` fabriquait un lien vers
`/recette/` ; `formatQuantity` en `toFixed(1)` aurait affiché `0,3` au lieu de `0,25`.

---

## Round 1 — Codex

Thread `019fe36e-b868-7c22-ae1d-32720fc1023e`. 20 constats, verdict **REVISE**.

Retenus : 18. Rejetés : 2.

### Le constat le plus grave

**#8 — la singularisation corrompait des mots français.** La règle générale `-aux → -al`
transformait `poireaux` en `poireal`. « Tarte fine aux **poireaux** » et sa ligne `6 poireaux`
sont dans le jeu de seed que j'avais écrit : le bug se serait déclenché au premier recalcul de
portions de la tâche 11. Même famille : `couscous → couscou`, `houmous → houmou`.

Correctif appliqué : suppression de la règle générale. Le dépluralisation par retrait du `s`/`x`
final traite déjà correctement les pluriels en `-aux` du vocabulaire culinaire (`poireaux`,
`noyaux`, `pruneaux`). Un seul irrégulier déclaré (`bocaux → bocal`), et `couscous`/`houmous`
ajoutés aux invariables. Trois tests de non-régression, dont un portant explicitement sur la
ligne du seed.

### Retenus et appliqués

| # | Constat | Correctif |
|---|---|---|
| 2 | Câblage SSR incomplet : `setupRouterSsrQueryIntegration` absent | Paquet `@tanstack/react-router-ssr-query` (vérifié en 1.167.1) ajouté, intégration câblée |
| 3 | `QueryClient` et `ConvexQueryClient` en singletons de module — cache partagé entre requêtes serveur | `getRouter()` crée les trois par requête |
| 5 | `convex-test` ne prouve pas la recherche réelle | Tâche 9, étape 7 : table de vérification contre le déploiement de développement |
| 6 | Convex refuse > 16 termes ou > 32 caractères par terme | `toSearchQuery()` tronque avant l'appel |
| 7 | `searchText` sans frontière d'écriture | `convex/lib/recipeWrites.ts` — `withSearchText()`, seul point d'entrée autorisé |
| 8 | Singularisation corruptrice | voir ci-dessus |
| 9 | Le remplacement du premier nombre peut fabriquer une ligne fausse | Le nombre trouvé doit **égaler** l'annotation, sinon `scaled: false`. Meilleur que le correctif proposé : couvre aussi « 200 g de chocolat à 70 % » |
| 10 | Frontières d'arrondi et valeurs non finies sous-testées | Gardes `Number.isFinite` + tests de frontière à 1, 10, 10,5 |
| 11 | La dague pouvait s'afficher sans sa note | `lines` et `showNote` dérivés d'un calcul unique |
| 12 | Le schéma Zod canonique de la spec disparaît | Report explicite documenté (voir ci-dessous) |
| 13 | Seed destructif, fichiers orphelins, risque de mauvais déploiement | Argument littéral `confirm`, suppression des fichiers avant les documents |
| 14 | `StorageCtx` typé à la main | `Pick<QueryCtx, "storage">` |
| 15 | Recette inexistante en HTTP 200 | `notFound()` levé dans le loader + `notFoundComponent` |
| 16 | La fiche ignore la double page desktop de `DESIGN.md` | Grille à deux colonnes ≥ 900 px, repli linéaire mobile |
| 17 | Libellés pluriels utilisés pour une recette unique | `TYPE_LABELS` singulier / `TYPE_FILTER_LABELS` pluriel |
| 18 | Chaque frappe empile une entrée d'historique et un abonnement | Champ local, synchronisation débouncée 250 ms en `replace` |
| 19 | Le SSR n'est jamais vérifié | Étape `curl \| grep` sur la réponse brute |
| 20 | Les étapes de commit contredisent la règle du dépôt | Renommées « point d'arrêt — relecture puis commit manuel » |

### Rejetés

**#1 — « le spike T1 est un prérequis, ajouter une Task 0 ».** Rejeté sur le fond. La spec bloque
l'**ingestion** sur T1, pas la vitrine : le schéma des recettes est spécifié indépendamment, et
le découpage en quatre plans a été arbitré explicitement avec l'utilisateur, qui a choisi le
plan 1 en connaissance de cause. Codex a par ailleurs lu le `PLAN.md` racine — le plan de spike
d'un **autre** chantier — malgré la consigne de l'ignorer, et en a tiré « le journal du spike ne
contient pas de verdict approuvé ». Le raisonnement porte sur un document hors périmètre.

**#4 — « ajouter des alias morphologiques `-al/-aux` dans `searchText` ».** Rejeté comme YAGNI.
`bocal`, `cheval` et `travail` ne sont pas des ingrédients ; les seuls pluriels en `-aux` du
corpus (`poireaux`, `noyaux`, `pruneaux`) sont réguliers et déjà couverts. La moitié utile du
constat — que la règle `-aux` cassait des mots — est traitée en #8.

### Défaut introduit par la révision elle-même, puis corrigé

Le remplacement de l'import `@tanstack/react-router` a touché les **deux** routes : `index.tsx`
importait `notFound` sans l'utiliser. Corrigé.

---

## Round 2 — Codex

Verdict : **REVISE**. 10 constats, dont 4 marqués bloquants et 3 réellement nouveaux.

Préambule de Codex, à porter au dossier : « Le `PLAN.md` racine n'a pas été lu. Je ne réouvre pas
le point `-al/-aux` : avec le corpus déclaré, le choix YAGNI tient. » Les deux rejets du round 1
sont donc tenus des deux côtés, et l'incident de périmètre ne se répète pas.

Corrections du round 1 confirmées présentes par Codex : SSR par requête,
`setupRouterSsrQueryIntegration`, 404, debounce en `replace`, libellés singulier/pluriel,
frontières d'arrondi testées, gardes numériques, singularisation prudente, note `†`, helper
`withSearchText`, vérification SSR brute, commits manuels.

| # | Constat | Correctif appliqué |
|---|---|---|
| 1 | L'arbitrage des quatre plans contredit toujours la règle écrite de la spec | Règle réécrite dans `2026-08-08-table-des-recettes-tasks.md` : T1 ne bloque que ce qui **consomme** l'extraction ; l'arbitrage du 2026-08-09 est consigné |
| 2 | Le schéma Zod n'est pas seulement reporté, il est contourné | Rattachement explicite de T2 au plan d'ingestion, avec la raison : sa forme dépend de ce que le modèle de T1 sait produire |
| 3 | **Bloquant nouveau** — `ConvexHttpClient.mutation(internal.…)` est interdit par Convex | Script réécrit en `scripts/seed-images.sh` : `npx convex run` (authentifié administrateur, atteint les fonctions internes) pour les deux mutations, `curl` pour le POST du fichier |
| 4 | `pickDisplayImage` rabotait `Id<"_storage">` en `string`, puis le passait à `ctx.storage.getUrl` | `RecipeImages`, `DisplayImage` et `pickDisplayImage` génériques sur `T extends string` |
| 5 | Le littéral `"efface-et-repeuple"` ne prouve pas que le déploiement ciblé est de développement | Garde côté mutation : `process.env.ALLOW_DESTRUCTIVE_SEED !== "true"` lève |
| 6 | Fuites de stockage : réexécution orpheline l'ancien fichier, échec d'`attach` orpheline le nouveau | `attach` supprime l'ancien fichier avant de réassigner, et supprime le nouveau si le slug est introuvable |
| 7 | `{ raw: "2 à 3 gousses", quantity: 2 }` produisait `"4 à 3 gousses"` | Garde `RANGE_OR_FRACTION` : plage ou fraction après le nombre correspondant → ligne rendue telle quelle, `scaled: false` |
| 8 | **Nouveau** — la vérification `courgette` sur le déploiement réel ne pouvait pas passer | Recette « Tian de courgettes » ajoutée au seed persistant |
| 9 | La double page n'était pas composée en deux blocs : l'auto-placement donnait une ligne par enfant | Deux wrappers `.recipe__left` / `.recipe__right` placés en `grid-row: 1`, photo et préparation en `grid-column: 1 / -1` |
| 10 | **Nouveau** — `git diff -A` n'existe pas, et la tâche 9 revenait de Step 7 à Step 6 | `git diff`, et le point d'arrêt de la tâche 9 devient Step 8 |

### Claude's response

Aucun rejet ce round : les dix constats sont fondés et tous appliqués.

Le #3 mérite d'être noté comme une vraie erreur de conception, pas une inattention : le plan
appelait une `internalMutation` depuis un `ConvexHttpClient`, ce que Convex interdit **par
définition** — c'est ce qui rend une fonction interne interne. Le correctif ne contourne pas la
règle, il change d'acteur : la CLI `convex run` s'authentifie en administrateur et a légitimement
accès aux fonctions internes. La mutation reste donc hors d'atteinte du client public.

Le #9 est le seul constat de nature visuelle, et il est exact : `grid-column` sur des enfants
directs ne suffit pas à composer deux colonnes indépendantes — sans wrapper, la grille attribue
une **ligne** à chaque enfant et la colonne de droite descend au lieu de démarrer face au titre.

---

## Round 3 — Codex

Verdict : **REVISE**. 5 constats, dont 3 nouveaux.

Confirmés présents : recherche Convex testée côté backend, dénormalisation et racinisation
cohérentes, singularisation et paliers d'arrondi, SSR, typage `Id<"_storage">` préservé, garde
destructive du seed, recette avec courgettes, grille desktop, commandes Git.

| # | Constat | Correctif appliqué |
|---|---|---|
| 1 | Conflit d'autorité T1 « non résolu » | Déjà corrigé avant ce round — Codex citait la spec d'avant l'amendement. Renforcé quand même : voir #2 |
| 2 | T2 reste listé sous « Socle » avec `convex/schema.ts` en fichier, ce qui contredit son report | T2 retitré « plan d'ingestion », avec un bloc **Ordre** disant que `convex/schema.ts` existe déjà et que T2 le fait *dériver* du Zod. En-tête de section ajouté sur la répartition entre plans |
| 3 | **Nouveau** — `convex/recipes.ts` importe `buildSearchText` et `toSearchTokens` sans les utiliser | Import réduit à `toSearchQuery` |
| 4 | **Nouveau** — `devImages:attach` remplace et supprime des images sans aucune garde serveur | `assertDevDeployment()` exigeant `ALLOW_DEV_IMAGES === "true"`, appliqué aux trois mutations |
| 5 | **Nouveau** — la promesse « aucun orphelin » du script est fausse : `curl` rend 0 sur un HTTP 500, `sed` accepterait un JSON d'erreur comme identifiant, et une panne entre l'upload et l'attachement laisse un blob sans référence | `curl --fail-with-body`, `jq -er '.storageId'`, mutation `discardOrphan` appelée par un `trap EXIT` levé seulement après l'attachement. `jq` ajouté à `devenv.nix` |

### Claude's response

Le #1 est le seul point où Codex a raison sur le fond mais se trompe sur les faits : la spec
**avait** été amendée avant ce round, aux lignes qu'il cite. Il lisait sa propre copie du round
précédent. Le constat n'en était pas moins utile, parce que le #2 pointe le résidu réel : amender
la prose ne suffisait pas tant que T2 restait listé sous « Socle » avec `convex/schema.ts` comme
livrable de création. Un lecteur qui saute la prose et lit la liste voyait toujours la
contradiction.

Le #4 est le meilleur constat des trois rounds. Le seed avait reçu sa garde au round 2, mais
`devImages` avait été raisonné comme inoffensif *parce que ses mutations sont internes* — or
c'est faux : la CLI s'authentifie en administrateur, donc « interne » ne protège de rien contre
un `CONVEX_DEPLOYMENT` mal pointé. Ces mutations suppriment des images. La garde manquait au seul
endroit où l'erreur est irréversible.

Le #5 est exact sur les trois mécanismes de shell, et chacun transforme un échec en succès
apparent — le pire mode de panne pour un script qu'on lance une fois et qu'on ne relit jamais.

---

## Round 4 — Codex

Verdict : **REVISE**. 4 constats, tous nouveaux, tous fondés. Aucun rejet.

Constats des rounds précédents vérifiés comme corrigés par Codex : arbitrage T1 et rattachement
de T2 inscrits dans la spec, imports morts supprimés, `ALLOW_DEV_IMAGES` côté serveur,
`curl --fail-with-body` + `jq -er` + nettoyage sur échec.

| # | Constat | Correctif appliqué |
|---|---|---|
| 1 | Le nettoyage introduit une race destructrice : si `attach` est validée mais que la CLI perd la réponse, le `trap` supprime un fichier désormais référencé | `discardOrphan` prend le slug, relit la recette et **ne supprime que si elle ne pointe pas** sur ce `storageId`. Lecture et suppression dans la même mutation |
| 2 | La singularisation ampute l'adjectif antéposé : « 3 gros œufs » sous deux donnait « 1 gro œufs » | Ensemble fermé `PRENOMINAL_ADJECTIVES` ; `singularizeHead` accorde les adjectifs antéposés puis le nom, et s'arrête là. `gros`, `vieux`, `doux`, `frais`, `épais` ajoutés aux invariables |
| 3 | Un facteur égal à 1 ne conservait pas la ligne brute : `1,50 L` devenait `1,5 L`, et une ligne déjà sous deux était accordée | Court-circuit `if (factor === 1) return { text: raw, scaled: true }` |
| 4 | Le test manuel du bouton Retour était impossible : `replace` dès la première frappe efface l'entrée `/` | La transition vide→recherche est **empilée**, les frappes suivantes remplacent (`replace: current !== ""`). Le contrôle manuel est réécrit en conséquence |

### Claude's response

Les quatre sont des défauts que j'avais introduits en corrigeant les rounds précédents — c'est
le motif intéressant de ce round. Le #1 vient du filet ajouté au round 3 : ajouter un nettoyage
sans le rendre conditionnel a transformé une fuite de stockage en perte de donnée, ce qui est
strictement pire. Le #3 vient de la garde `RANGE_OR_FRACTION` du round 2, qui a fait passer le
« facteur 1 » du statut d'évidence à celui de cas non traité.

Le #2 est le troisième défaut de singularisation trouvé en quatre rounds, après `1 œufs` et
`poireal`. Les deux premiers venaient d'une règle trop générale ; celui-ci vient d'une hypothèse
tacite — « le mot qui suit le nombre est le nom » — qui est fausse pour l'unique famille
d'adjectifs français placée avant le nom. Le correctif nomme cette famille au lieu d'élargir la
règle, et couvre le cas par trois tests, dont un qui vérifie que le mot **après** le nom reste
intact.

Le #4 n'est pas un bug de code mais une contradiction entre le code et son propre critère de
vérification, ce qui est plus difficile à voir : le contrôle manuel décrivait un comportement que
l'implémentation rendait impossible. Le compromis retenu — empiler l'entrée dans la recherche,
remplacer les frappes — préserve les deux intentions, ne pas polluer l'historique et ne pas
détruire le point de retour.

---

## Round 5 — Codex (dernier round, `MAX_ROUNDS=5`)

Verdict : **REVISE**. 2 constats, tous deux fondés et appliqués.

Les quatre constats du round 4 sont vérifiés corrigés par Codex : `discardOrphan` protège un
fichier déjà référencé, `factor === 1` conserve la ligne brute, les adjectifs antéposés sont
couverts, la première recherche crée une entrée d'historique.

| # | Constat | Correctif appliqué |
|---|---|---|
| 1 | L'ensemble des adjectifs antéposés produit encore du français faux : `beaux œufs` donnait « beau œuf » au lieu de « bel œuf » | `ELIDED_PRENOMINAL` pour `beaux`/`nouveaux`/`vieux`, avec une forme devant voyelle décidée sur le mot suivant. `h` volontairement exclu — il est aspiré dans « haricots » |
| 2 | Les comptes de tests annoncés sont périmés (9 vs 8, 27 vs 34, 13 vs 16) | Comptes supprimés : « suite verte, aucun test ignoré ». Un compte devient faux à chaque test ajouté, et le round précédent en avait ajouté trois |

### Claude's response

Le #1 est le **quatrième** défaut de singularisation en cinq rounds, et le plus instructif :
chaque correctif précédent élargissait la règle, et chaque élargissement ouvrait une nouvelle
famille de fautes. Ici, réparer l'accord en nombre introduisait une faute de forme —
« un beau œuf » — donc le correctif n'était pas neutre, il déplaçait l'erreur. Les trois
adjectifs concernés sont nommés explicitement plutôt que dérivés d'une règle, et le test couvre
les deux branches, voyelle et consonne, plus le `h` aspiré.

Le #2 explique pourquoi le #1 a pu se répéter si longtemps : un compte de tests écrit dans la
prose est une assertion qui n'est jamais exécutée. Il devient faux dès qu'un round ajoute un
cas, et il l'était devenu trois fois. Remplacé par la seule propriété qui compte et qui se
vérifie vraiment — la suite est verte et rien n'est ignoré.

---

## Résolution — plafond atteint sans APPROVED

`MAX_ROUNDS=5` est atteint. Le verdict final reste `REVISE`, mais **aucun constat n'est
ouvert** : les deux du round 5 sont appliqués, comme les 36 précédents. La boucle s'arrête sur
sa borne, pas sur un désaccord.

Bilan des cinq rounds : 41 constats, **39 appliqués**, 2 rejetés avec motif consigné (la Task 0
de spike, hors périmètre ; les alias morphologiques `-al/-aux`, YAGNI — rejet que Codex a
lui-même confirmé au round 2).

Le seul point qui mériterait un round 6 est la famille des accords en français, qui a produit un
constat neuf à **chacun** des cinq rounds. Ce n'est pas une preuve que le correctif actuel est
faux, c'est une preuve que le domaine est plus profond que le besoin : le recalcul de portions
est déclaré *best-effort* dans `CONTEXT.md`, et une ligne mal accordée reste lisible. Si un
sixième défaut d'accord apparaît à l'implémentation, le bon réflexe n'est pas d'élargir encore
la règle mais de supprimer l'accord automatique.

---

## Round 6 — Codex, revue de qualité de code sur l'implémentation

Après livraison des 11 tâches, `thermo-nuclear-code-quality-review` passée à Codex
(`gpt-5.6-sol`, sandbox read-only, thread `019fe6cc-a669-7732-9c22-82dc5aff0be0`). Portée : le
code écrit à la main du diff `main..HEAD`, hors généré, vendoré et prose. Verdict `REVISE` —
2 bloquants, 3 élevés. Aucun fichier ne franchit les 1 000 lignes.

### Appliqués

**1. Les modes liste et recherche assemblés côté UI par un double cast.** `search` et
`listPublished` rendaient deux formes différentes, la bascule était dupliquée dans le loader
**et** dans le composant, et le raccord tenait par un `as unknown as`. Le cast masquait le
désaccord que TypeScript signalait : trois contrats pour une seule notion, « les recettes
affichées par l'index ».

Remplacées par une query unique `browse({ query?, type? })` dont chaque ligne porte toujours
`matchedIngredient: string | null`. Une requête vide n'est pas un mode séparé, c'est l'absence
de filtre textuel. Disparaissent : le cast, le `if/else` du loader, `searchOptions`,
`listOptions` et le type `RowRecipe` recopié à la main.

Le raisonnement qui avait mené au cast — « un champ toujours nul hors recherche serait un
mensonge » — était faux. Le champ répond à « pourquoi cette ligne est là » ; hors recherche,
`null` est la réponse exacte.

**2. Les tests de recherche contournaient la frontière d'écriture qu'ils devaient certifier.**
Les fixtures écrivaient des `searchText` déjà stemmés à la main. Les tests seraient donc restés
verts si `withSearchText()` cessait de normaliser les ingrédients : l'ADR du stemming symétrique
n'était vérifiée que sur une moitié préparée d'avance.

Toutes les fixtures passent désormais par `withSearchText()`. Seule exception conservée : la
recette publiée sans slug, qui fabrique volontairement l'invariant rompu. Vérifié par sabotage —
neutraliser `stemToken` fait bien échouer le test de recherche par ingrédient, ce qui n'était pas
le cas avant.

**3. Contrats publics déclarés plusieurs fois, validés nulle part.** Les quatre queries n'avaient
aucun `returns`, et `countsByType` effaçait l'union fermée en `Record<string, number>`. Ajout des
validateurs de sortie `publishedRecipeRow` / `publishedRecipe` / `typeCounts`, type dérivé par
`Infer`, compteur exhaustif sur `RecipeType`. Le validateur des compteurs est énuméré à la main :
le handler construit un `Record<RecipeType, number>`, donc un type ajouté d'un seul côté casse la
compilation — la dérive est attrapée sans rendre le validateur illisible.

### Différés, avec motif

**Le moteur morphologique de `src/lib/scale.ts`** (classé bloquant par Codex). L'observation est
juste : 120 lignes d'exceptions françaises dans le chemin de rendu, et `label` est ignoré alors
qu'il existe au schéma. Mais le remède proposé — décider de la scalabilité à l'ingestion et
stocker `singularSuffix` / `pluralSuffix` — ne dit pas **qui produit ces suffixes**. Si c'est le
même `singularize`, le code ne disparaît pas, il déménage : ce que la grille appelle elle-même
déplacer la complexité au lieu de la supprimer. À trancher dans le contrat d'ingestion du spike
T1, pas ici.

À noter : ces constantes existent parce que les rounds 4 et 5 ci-dessus, **par Codex**, avaient
signalé `3 gros œufs → 1 gro œufs` puis `3 beaux œufs → 1 bel œuf` comme des défauts. Un Codex a
exigé la morphologie, l'autre veut la supprimer. C'est exactement le point noté en résolution du
round 5 : le domaine est plus profond que le besoin.

**`matchedIngredient` singulier ne peut pas expliquer une recherche multi-ingrédients.** Exact,
mais c'est une décision de design et non de qualité de code : `DESIGN.md` dit « afficher **la**
ligne d'ingrédient qui a produit la correspondance ». Passer à N lignes change la densité de
l'index. Renvoyé à l'arbitrage produit.
