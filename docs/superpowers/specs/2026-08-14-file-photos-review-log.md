# Plan Review Log: refonte de la file de travail des photos (`/admin/illustrations`)

Started 2026-08-14 (session). MAX_ROUNDS=5. Reviewer: Codex CLI 0.144.5, `gpt-5.6-sol`,
`model_reasoning_effort=medium`, read-only sandbox.

## Round 1 — Codex

- Critique — `active` et `toBeautify` se chevauchent : toute recette `review`/`generating`/`failed` avec original reste au stage `to-beautify`, donc elle apparaît deux fois (PLAN.md:151, PLAN.md:159). Fix : intégrer l'activité au stage dérivé ou ajouter un index permettant de limiter `toBeautify` à `beautifyStatus === 'idle'` avant `take(51)`.
- Critique — `_creationTime` mesure la création de la recette, pas celle du lot photo : une photo ajoutée aujourd'hui à une vieille recette sera regroupée et triée à une date historique (PLAN.md:168). Fix : ajouter un `illustrationUpdatedAt` mis à jour lors des transitions pertinentes et l'utiliser dans l'index, le tri et les séparateurs.
- Critique — le plafond sans pagination rend les éléments après le 50e inaccessibles, surtout dans `toBeautify`, alors que l'objectif est précisément de rendre tout le travail restant actionnable (PLAN.md:301). Fix : paginer au minimum les sections actionnables ou fournir « Charger plus ».
- Critique — modifier directement `by_illustration` ajoute un index composé à backfiller pendant le déploiement ; le plan ignore l'exigence Convex d'un index `staged` pour une table existante et conserve un nom qui ne décrit plus ses champs (PLAN.md:44). Fix : déployer `by_hasIllustration_and_illustrationStage` en mode staged, attendre son backfill, puis l'activer et retirer l'ancien index lors d'un déploiement ultérieur.
- Critique — supprimer `backfillIllustrations` peut invalider une continuation déjà planifiée via `internal.migrations.backfillIllustrations`, laissant l'ancienne migration inachevée sans reprise possible (PLAN.md:181). Fix : conserver l'ancien worker et sa constante jusqu'à confirmation que sa migration est terminée dans tous les environnements.
- Critique — `noPhotoAvailable` reste optionnel dans le schéma mais devient un `boolean` obligatoire pour `withIllustration` ; les documents historiques fournissent `boolean | undefined`, donc les sites décrits comme « lit […] sur le doc » ne compilent pas sans normalisation (PLAN.md:38, PLAN.md:58). Fix : utiliser explicitement `recipe.noPhotoAvailable ?? false` dans chaque appel et tester les documents historiques sans champ.
- Critique — la relance manuelle reprend la mécanique existante sans verrou ni génération : relancer pendant qu'une continuation est encore planifiée peut créer plusieurs chaînes concurrentes et rendre le curseur ou l'état trompeur. Fix : ajouter un identifiant d'exécution/lease vérifié par chaque batch, plus `updatedAt` et `lastError` pour distinguer une migration active d'une migration bloquée.
- Critique — le changement atomique de signature casse toute page d'administration déjà ouverte avec `includeIllustrated` ; le plan reconnaît le problème mais ne le résout pas (PLAN.md:286). Fix : introduire une nouvelle requête ou accepter temporairement les deux formes d'arguments pendant une version de transition.
- Critique — les tests prévus ne couvrent ni le non-chevauchement `active`/`toBeautify`, ni le tri selon la date réelle d'activité, ni l'accès au 51e élément, ni une double relance concurrente. Fix : ajouter ces quatre tests d'intégration avant implémentation.

VERDICT: REVISE

### Claude's response

Deux affirmations vérifiées dans le repo avant d'agir, toutes deux confirmées : `convex/_generated/ai/guidelines.md:186` impose que le nom d'index liste tous ses champs, `:191` documente l'exigence `staged`. Et `migrations.ts:87-101` planifie bien une chaîne sans verrou.

**Accepté (1) — chevauchement `active` / `toBeautify`.** Défaut réel et le plus grave des neuf : deux `<article data-row-id>` identiques et deux `AdminButton` sur la même clé de geste. Fix retenu **différent des deux proposés** : ni absorber l'activité dans le stage (ce qui forcerait chaque transition de `beautify.ts`, finalisation depuis une action incluse, à réécrire le stage), ni un index dédié à `toBeautify` seul — le chevauchement vaut pour **les quatre** sections d'étape, pas seulement celle-là (une recette `failed` sans photo serait dans `active` et dans `missing`). Retenu : un invariant de partition global, `beautifyStatus` en deuxième clé de l'index neuf, et `eq('beautifyStatus','idle')` dans la plage pour les quatre sections. Zéro écriture supplémentaire, partition prouvable, promue en section dédiée du plan.

**Accepté (2) — `illustrationUpdatedAt`.** Juste pour `toBeautify`/`done`, et le fix va plus loin que le tri : le champ devient la **troisième clé d'index**, sinon la sélection de page reste par date de scan et la 51ᵉ recette photographiée aujourd'hui n'est jamais atteinte. Backfillé à `_creationTime`, ce qui préserve la date de scan dans « Sans photo » — la date que l'opérateur y cherche.

**Accepté (3) — plafond.** « Afficher 50 de plus », plafond entier relevable, écrêté serveur à `ILLUSTRATION_WORK_MAX = 500`. Un curseur complet est rejeté : cinq curseurs à fusionner dans une requête qui doit rester une lecture cohérente. Limite nommée dans les risques.

**Accepté (4), fix remplacé.** Plutôt que déployer un index composé staged en deux passes, l'index existant `by_illustration` n'est **pas touché du tout** et un index neuf est ajouté avec un nom conforme. Ça supprime le rebuild, le renommage, et la danse en deux déploiements d'un coup. `staged: true` explicitement écarté avec sa justification (corpus de quelques centaines de lignes) et la sortie de secours documentée.

**Accepté (5) — ancienne migration conservée**, marquée dépréciée, retrait dans un lot ultérieur. Bonne prise : une chaîne en vol référence `internal.migrations.backfillIllustrations`.

**Accepté (6) — `?? false` au point d'appel**, pas caché dans le helper, pour que le compilateur refuse un `boolean | undefined` passé par mégarde. Test sur document historique ajouté.

**Accepté (7) — jeton d'exécution.** Défaut préexistant que ce lot réutiliserait tel quel. `runId` + `lastError` sur la ligne `migrations`, chaque batch vérifie qu'il possède encore le jeton et s'éteint sinon.

**Rejeté (8) — shim de transition sur la signature.** Le raisonnement de Codex s'arrête à mi-chemin : la **forme de retour** change aussi, donc tolérer l'ancien argument `includeIllustrated` ne sauve pas l'onglet resté ouvert — l'ancien bundle lirait `data.withoutIllustration` (`undefined`) et planterait au rendu. Un shim coûterait du code de compatibilité pour un bénéfice nul. Écran d'admin à un seul opérateur derrière un jeton, un rechargement suffit. Promu de « risque nommé » à décision 11 avec ce raisonnement.

**Accepté (9) — les quatre tests**, plus trois autres que la révision a rendus nécessaires : écrêtage du plafond serveur, `stageOf` sur ses huit combinaisons, et la partition testée sur chaque couple (stage, statut) plutôt que sur le seul cas cité.

## Round 2 — Codex

- Critique — l'invariant de migration est faux : les recettes non migrées avec `beautifyStatus !== 'idle'` restent sélectionnées par `active`, puis `updatedAt: recipe.illustrationUpdatedAt` vaut `undefined` et peut faire échouer le validateur de retour (PLAN.md:30, PLAN.md:218, PLAN.md:234). Fix : utiliser `illustrationUpdatedAt ?? _creationTime` pour `active` et tester explicitement une recette active pré-migration.
- Critique — `v.number()` accepte notamment les valeurs non finies, et « borné par 500 » ne traite ni `NaN`, ni les nombres négatifs, ni les décimaux avant `.take()` (PLAN.md:187). Fix : normaliser chaque limite avec un contrôle `Number.isFinite`, `Math.floor` et un clamp explicite `[0, ILLUSTRATION_WORK_MAX]`, puis tester `NaN`, `Infinity`, `-1` et `1.5`.
- Critique — `lastError` est ajouté et affiché, mais aucun mécanisme ne capture l'échec d'une mutation planifiée dans une transaction séparée ; en plus, afficher un message brut contredit la politique existante de masquage des erreurs serveur (PLAN.md:264). Fix : planifier une action-wrapper qui appelle le batch, journalise l'erreur brute côté serveur et persiste uniquement un code/message opérateur assaini via une mutation distincte.
- Critique — le plan laisse encore les sections partielles utilisables pendant le backfill, donc l'opérateur peut conclure qu'un lot est terminé ou agir sur une vue incomplète malgré le bandeau (PLAN.md:272). Fix : désactiver les quatre sections d'étape jusqu'à `migration.done`, tout en gardant `active` visible avec le fallback de date.
- Critique — `ILLUSTRATION_WORK_MAX = 500` transforme seulement le défaut « 51e inaccessible » en « 501e inaccessible » alors que `truncated` peut encore annoncer des éléments restants sans moyen de les atteindre. Fix : utiliser une vraie pagination à curseur pour les sections actionnables, ou au minimum fournir une requête/page dédiée au-delà de 500.

VERDICT: REVISE

### Claude's response

**Accepté (1) — l'invariant était faux, et la faute était à moi.** `active` est lu par `by_beautify_status`, qui ne touche pas au stage : une recette non migrée et non-`idle` y est bien servie, et son `updatedAt` `undefined` casse le validateur de retour — donc **tout** l'écran, arbitrage compris, pendant la fenêtre de migration. La section « partition invariant » est réécrite pour distinguer les deux cas de document non migré au lieu de les résumer faussement, le mapper lit `illustrationUpdatedAt ?? _creationTime`, et le test est nommé avec sa condition d'échec (« sans le fallback, ce test échoue sur le validateur de retour »).

**Accepté (2) — normalisation des plafonds.** Juste : `v.number()` est un float64. `boundedLimit` avec `Number.isFinite` / `Math.floor` / clamp `[0, MAX]`, extrait en fonction pure et testé sur les huit entrées limites.

**Accepté (3), fix remplacé par une suppression.** Les deux moitiés de la critique sont vérifiées — `src/lib/adminError.ts:1-7` interdit bien le message technique côté admin (`DESIGN.md` § Résistance) — mais sa conclusion (une action-wrapper qui journalise et persiste un code assaini) construit de la machinerie pour un besoin déjà couvert. `lastError` était du scope creep que j'avais accepté trop vite au round 1 : je le **retire**. Le besoin réel — distinguer une migration bloquée d'une active — est servi par `updatedAt`, qui existe déjà sur la ligne `migrations` (« dernière avance il y a X »). Le `runId`, lui, est conservé : il fonctionne dans une seule transaction et corrige un vrai défaut.

**Accepté (4) — sections d'étape indisponibles, pas partielles.** C'était ma propre question ouverte du round 1 ; Codex tranche dans le bon sens et j'étais d'accord. Drapeau `stagesReady`, les quatre sections ne sont pas lues du tout tant que la migration n'est pas `done`, `active` reste entière. Effet de bord : trois lectures au lieu de sept pendant la fenêtre. La question ouverte est retirée des risques, remplacée par le coût assumé (le travail photo est indisponible pendant le backfill).

**Partiellement accepté (5).** Le diagnostic est juste — un `truncated` au plafond dur annonce des lignes qu'aucun geste n'atteint, ce qui est un mensonge d'interface. Fix accepté : au plafond, le bouton « Afficher 50 de plus » disparaît au profit de la phrase que le projet emploie déjà (« Liste plafonnée : traite celles-ci, les suivantes viendront »). La pagination à curseur est **rejetée** : 500 dépasse le corpus entier, donc le mur est théorique, et cinq curseurs à fusionner dans une requête qui doit rester une lecture cohérente coûte plus que le problème. Un seuil de réexamen explicite remplace l'estimation au doigt mouillé : le jour où une section rapporte `truncated` à 500, la pagination devient le lot suivant.

## Round 4 — Codex

- Critique — le test central d'inventaire ne peut pas énumérer `api.illustrations` : l'API générée vaut `anyApi`, un proxy dynamique de références dont les fonctions ne sont pas exposées via `Object.keys` (convex/_generated/api.js:13, PLAN.md:416). Fix : inspecter statiquement les exports/modules sources ou ajouter une règle ESLint/AST interdisant les écritures des cinq champs hors helpers autorisés.
- Critique — même réalisable, cet inventaire limité à `api.illustrations` ne couvre pas les mutations internes de `beautify.ts`, alors que deux finalisations y écrivent précisément les champs protégés (PLAN.md:191). Fix : faire porter le contrôle statique sur tout `convex/**/*.ts` et ajouter des tests de timestamp aux chemins internes succès/échec de finalisation.

VERDICT: REVISE

### Claude's response

Vérifié : `convex/_generated/api.js:11` importe bien `anyApi`. Le mécanisme que j'avais proposé au round 3 ne pouvait pas fonctionner — critique factuelle, acceptée sans réserve.

**Accepté (1), premier fix de Codex retenu, second écarté.** Le test énumère les **exports des modules sources** (`import * as illustrations from './illustrations'`, idem `beautify`), qui sont des objets réels et s'énumèrent. La règle ESLint/AST interdisant l'écriture des cinq champs hors helpers serait une garantie plus forte — elle attraperait un site oublié, pas seulement une fonction non classée — mais c'est un plugin à écrire et maintenir pour un périmètre de deux modules ; rejeté avec ce motif.

**Accepté (2), et la critique relève une incohérence interne de mon plan.** Mon propre tableau d'inventaire liste `beautify.ts:386` et `:441` parmi les 13 sites, et la phrase du test suivant scopait le contrôle à `api.illustrations` : les deux sites les plus faciles à oublier étaient donc exclus du garde-fou censé les protéger. L'inventaire porte désormais sur les deux modules, et les tests de timestamp couvrent explicitement les deux chemins internes de finalisation, succès et échec, atteints comme le fait déjà `beautify.test.ts`.

## Round 5 — Codex

Aucun problème matériel restant. Les invariants, migrations, bornes, transitions et tests couvrent désormais les risques identifiés.

VERDICT: APPROVED

### Outcome

Convergence au round 5 sur MAX_ROUNDS=5. 19 critiques sur quatre rounds : 17 acceptées (dont 6 avec
un fix différent de celui proposé), 2 rejetées avec motif logué (shim de compatibilité de signature,
pagination à curseur). Aucune ligne de code écrite pendant la boucle.

## Après implémentation — le bouton de migration

Une question du propriétaire après la création de la PR : « on est d'accord que c'est un bouton
lancer migration dans l'app admin ? c'est une bonne pratique ? »

Non. Et la boucle de review ne l'avait pas vu, moi non plus. Le bouton était hérité du lot T14 et
personne — ni Codex sur quatre rounds, ni moi — ne l'a remis en cause, parce qu'il existait déjà.
C'est l'angle mort de la boucle : elle attaque ce que le plan ajoute, pas ce qu'il reprend tel quel.

Pire, la décision 12 acceptée au round 2 en avait aggravé l'enjeu. Rendre les quatre sections
**indisponibles** pendant la fenêtre de migration était le bon choix pour l'honnêteté de l'écran,
mais il transformait « oublier le bouton donne une liste partielle » en « oublier le bouton tue le
flux photo ». Un flux principal ne peut pas dépendre de quelqu'un qui se souvient d'appuyer.

Vérifié avant de recommander quoi que ce soit : `convex deploy` n'a pas de `--run` pour la production
(`--preview-run` seulement, documenté « ignored if deploying to a production deployment »). Il n'y a
donc pas de hook post-déploiement gratuit — c'est un second appel à enchaîner.

Choix du propriétaire : le composant officiel `@convex-dev/migrations`. Trois conséquences, toutes
des retraits :

- La mécanique maison disparaît : table `migrations`, curseur, worker qui se replanifie, jeton `runId`
  contre deux chaînes sur un curseur. Le composant refuse un doublon et reprend au curseur d'un batch
  échoué ; le verrou n'a plus d'objet.
- L'ancienne migration `hasIllustration`, conservée au round 1 sur une critique de Codex, est
  supprimée avec. La crainte tenait : une continuation en vol référençant
  `internal.migrations.backfillIllustrations` échouerait. Mais le coût réel est un job planifié qui
  échoue une fois dans les journaux, et la nouvelle migration écrit `hasIllustration` sur tout
  document sans étape — le corpus est réparé quelle que soit l'issue de l'ancienne chaîne. La
  décision 8 s'inverse donc, avec le motif chiffré qui manquait au round 1.
- L'heuristique « dernière avance il y a X », acceptée au round 2 comme substitut à `lastError`,
  disparaît aussi : `state: inProgress | success | failed | canceled` — plus `unknown` quand la
  migration n'a jamais tourné — dit directement ce qu'un délai depuis la dernière écriture
  approximait.

Le déclencheur est désormais le déploiement : `vercel.json` en production, le job `data` du workflow
d'aperçu après son import de données. `npm run migrate` / `migrate:prod` restent pour la main.
