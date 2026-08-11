# Plan Review Log : T9 — export automatique versionné dans git

Act 1 (grill) terminé — plan verrouillé avec Florian le 2026-08-11. MAX_ROUNDS=5.

## Act 1 — décisions arrêtées pendant le grill

| #   | Question                        | Décision                                                                                                      | Recommandation de Claude                                                                   |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Q1  | Quel dépôt reçoit la sauvegarde | **Ce dépôt, public** — la provenance n'est stockée nulle part, donc le texte ne désigne aucune source         | (a) dépôt privé dédié — **écartée**, contradiction signalée puis assumée par le mainteneur |
| Q2  | Contenu exporté                 | `published` **et** `review`                                                                                   | idem                                                                                       |
| Q3  | Images                          | JSON seul, `storageId` conservés pour la traçabilité                                                          | idem                                                                                       |
| Q4  | Déclencheur et clé              | GitHub Actions dans ce dépôt + action HTTP Convex à secret                                                    | idem                                                                                       |
| Q5  | Cadence                         | **Hebdomadaire** + `workflow_dispatch`                                                                        | (a) quotidienne — écartée après le tableau des offres Convex                               |
| Q6  | Disposition                     | un fichier par recette, `<slug>.json`, repli `<id>.json`                                                      | idem                                                                                       |
| Q7  | Restauration dans le périmètre  | oui, avec un essai réel contre `dev`                                                                          | idem                                                                                       |
| Q8  | Champs exportés                 | donnée éditoriale seule, ordre de clés fixé                                                                   | idem                                                                                       |
| Q9  | Recette supprimée               | miroir                                                                                                        | idem                                                                                       |
| Q10 | Visibilité d'un échec           | notification GitHub **+** `LAST_RUN.json` horodaté                                                            | idem                                                                                       |
| Q11 | Emplacement dans le dépôt       | **répertoire `backup/` sur `main`** + test de chemin dans `ignoreCommand`                                     | (a) branche orpheline — écartée, une seule branche à connaître                             |
| Q13 | Garde-fous du miroir            | refus sur liste vide **et** sur plus de 20 % de suppressions ; `LAST_RUN` avec les comptes par statut         | idem                                                                                       |
| Q14 | Sémantique de restauration      | recettes seules, références perdues assumées ; remplacement total derrière un drapeau, cible `dev` par défaut | idem                                                                                       |

Faits établis par Claude pendant le grill, sans rien demander au mainteneur : visibilité du dépôt,
`slug` optionnel dans le schéma, champs dérivés à exclure, absence de `crons.ts` et `http.ts`,
déclencheurs de `ci.yml`, orientation de `ignoreCommand`, présence de `tsx` et de Zod, et le tableau
des sauvegardes Convex par offre (manuelles 7 jours et 2 copies en gratuit, périodiques réservées à
Pro).

Deux alternatives à T9 ont été chiffrées et écartées devant le mainteneur : l'offre Convex Pro
(25 USD/mois, périodique hebdo, rétention 14 jours, photos incluses) et un export manuel mensuel sur
disque (gratuit, couvre les photos, mais manuel donc oublié).

## Contradiction signalée, puis assumée

Sur Q1, Claude a signalé que commiter le texte des recettes dans un dépôt public défait les trois
mécanismes de non-indexation posés par T12, et que l'historique git rend la publication
irréversible. Le mainteneur a maintenu son choix, motif consigné dans la décision n° 1 du plan. Ce
point est clos et ne sera pas rouvert en Act 2 — mais il reste le désaccord le plus lourd du grill,
et il est noté ici pour que la trace existe.

## Round 1 — Codex (`gpt-5.6-sol`, effort medium, codex-cli 0.144.5)

Quinze constats, verdict `VERDICT: REVISE`. Résumé fidèle, dans l'ordre rendu :

1. **Base de comparaison Vercel fausse.** Le pathspec `:(exclude)backup` marche et le clone Vercel
   contient dix commits, donc `HEAD^` existe — mais `HEAD^..HEAD` masque un changement applicatif
   dans un push multi-commits. Vercel expose `VERCEL_GIT_PREVIOUS_SHA`, le dernier déploiement
   réussi. Fix : comparer `VERCEL_GIT_PREVIOUS_SHA..HEAD`, et construire si le SHA manque.
2. **Routage HTTP sous-spécifié** : ni `httpRouter()` ni `export default http` ne sont mentionnés,
   alors qu'ils sont obligatoires.
3. **Le raccord `httpAction` → `internalQuery` manque** : `ctx.runQuery(internal.export.backupPayload,
{})` n'est pas écrit, ce qui laisse planer une fausse incompatibilité.
4. **Validateurs Convex absents** : `args` et `returns` doivent être déclarés, et le validateur de
   recette sauvegardée factorisé.
5. **`recipeSchema` ne peut pas valider ce format** : `strictObject`, refuse `id`, `status`, `slug`,
   `publishedAt` et les `storageId`, et exige des `nullable` là où Convex stocke des optionnels.
6. **Noms de fichiers ni sûrs ni uniques** : le slug est une chaîne libre sans contrainte d'unicité ;
   `/`, `..` ou `LAST_RUN` visent un chemin inattendu, et deux slugs égaux s'écrasent.
7. **`LAST_RUN.json` casse la promesse « ne commiter que si ça change »** : son horodatage varie à
   chaque passage. Fix proposé : ne le versionner que si son digest change, et publier le battement
   dans le résumé Actions.
8. **Écriture non transactionnelle** : le script écrit avant d'avoir calculé toutes les suppressions.
   Fix proposé : répertoire temporaire puis échange.
9. **Restauration par lots ni atomique ni idempotente** : relancer duplique, et une panne après
   effacement laisse une base partielle. Fix : JSONL plus `convex import --table recipes --replace`.
10. **L'affirmation sur les `_id` est fausse** : `convex import` conserve `_id` et `_creationTime`,
    même si `ctx.db.insert` ne le permet pas.
11. **La preuve de restauration ne prouve rien** : `recipes:countsByType` ne compte que les
    `published`, et le contenu des documents n'est pas vérifié.
12. **Le rebase après push rejeté publie un instantané obsolète** : l'absence de conflit n'implique
    pas la compatibilité avec le nouveau `main`.
13. **Le push vers `main` marche** (aucune protection ni ruleset, `contents: write` surcharge le
    défaut) **mais les deux secrets n'existent pas** dans le dépôt.
14. **`paths-ignore` sur `ci.yml` repose sur une mauvaise causalité** : un push au `GITHUB_TOKEN` ne
    déclenche pas de workflow, donc il n'y avait rien à empêcher.
15. **Aucun test planifié** pour l'auth, le routage, les collisions, le seuil de suppression, la
    stabilité JSON ou une panne en cours de remplacement.

### Claude's response

**Vérifié avant d'accepter**, parce que quatre constats reposaient sur des faits externes :

- `VERCEL_GIT_PREVIOUS_SHA` existe bien — documentation Vercel, « the git SHA of the last successful
  deployment for the project and branch », exposée uniquement quand un Ignored Build Step est
  configuré. Constat 1 exact.
- `convex import` : « will retain their `_id` and `_creationTime` fields », « the `_id` field must
  match Convex's ID format », « data import creates and replaces tables atomically ». Constats 9 et
  10 exacts, et mon affirmation « Convex n'accepte pas qu'on impose un `_id` » était vraie pour
  `ctx.db.insert` seulement.
- `src/lib/recipe-schema.ts` : `z.strictObject`, champs `nullable`, aucun `id`/`status`/`slug`.
  Constat 5 exact.
- `convex/recipes.ts:122` : `countsByType` filtre `status: 'published'`. Constat 11 exact.

**Accepté tel quel** : 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15. Les conséquences structurelles :
un fichier `src/lib/backup-schema.ts` versionné apparaît (constats 5 et 7 de forme), `_id` et
`_creationTime` entrent dans la charge sauvegardée (constat 10), le script de restauration devient un
constructeur de JSONL suivi d'un `convex import --replace` et la mutation `restoreBatch` disparaît
(constat 9), la modification de `ci.yml` disparaît (constat 14), la preuve de restauration devient
« comptes par statut plus digest canonique » (constat 11), un push rejeté échoue au lieu de rebaser
(constat 12), et une section Tests entière est ajoutée (constat 15).

**Refusé, avec motif** :

- **Constat 7 — supprimer le battement.** Le constat est juste : `LAST_RUN.json` fait partir un
  commit chaque semaine. Mais c'est exactement ce que le mainteneur a choisi en Q10, et pour une
  raison que le fix proposé ne couvre pas : GitHub désactive silencieusement les `schedule` d'un
  dépôt inactif depuis 60 jours. Un résumé d'exécution Actions ne dit rien d'un workflow qui **ne
  tourne plus** ; la date du dernier commit, oui. Le battement rend même le dépôt actif, donc le
  mécanisme se protège lui-même. Concession retenue : deux messages de commit distincts, pour que
  `git log --oneline backup/` reste lisible.
- **Constat 8 — répertoire temporaire puis échange.** La moitié utile est retenue : plus rien n'est
  écrit avant que tout soit décidé en mémoire. L'échange atomique est refusé parce que la vraie
  frontière transactionnelle est ailleurs — le workflow ne commite que si le script sort à 0, et sur
  un runner éphémère un miroir à moitié écrit n'est jamais publié. En local, `git restore backup/`
  suffit. Ajouter un répertoire temporaire achèterait une garantie déjà tenue par le commit.

## Round 2 — Codex

Codex **retire ses constats 7 et 8** : « le heartbeat protège effectivement l'activité du dépôt, et
le préflight empêche les erreurs métier de produire un état partiel publié. » Les treize corrections
acceptées sont jugées correctement intégrées. Sept problèmes restants, verdict `VERDICT: REVISE` :

1. **La restauration échoue systématiquement sur `LAST_RUN.json`** : le glob `backup/*.json` inclut
   le manifeste, qui ne satisfait pas `backupRecipeSchema` — et la recherche des fichiers obsolètes
   peut le compter comme une recette supprimée, donc alimenter le seuil de 20 %.
2. **La version du format n'est liée à rien** : `formatVersion` vit dans la réponse HTTP et dans
   `LAST_RUN.json`, mais aucune version ne gouverne les fichiers recette lus par la restauration.
3. **Le digest post-restauration ne peut pas correspondre** : la sauvegarde porte les deux
   `storageId`, le JSONL les omet volontairement, donc reprojeter « sur les champs de la sauvegarde »
   compare des `null` à des ids.
4. **La restauration de production contourne toute confirmation** : `--replace --yes` est passé dans
   tous les cas, or `--yes` sert précisément à supprimer le garde-fou interactif.
5. **Le contournement du seuil est inaccessible au workflow** : `workflow_dispatch` n'a aucun input,
   donc une suppression légitime de plus de 20 % rebloque à chaque relance.
6. **La justification locale du refus 8 est fausse** : `git restore backup/` ne supprime pas les
   fichiers non suivis créés avant une erreur.
7. **Le secret d'URL est ambigu** : une action HTTP Convex est servie sur `*.convex.site`, pas sur
   l'URL applicative `*.convex.cloud`.

### Claude's response

**Vérifié** : la documentation Convex sur les actions HTTP dit « HTTP actions are exposed at
`https://<your deployment name>.convex.site` » et prévient « make sure this is the URL that ends in
`.convex.site`, and not [`.convex.cloud`] ». Constat 7 exact, et il aurait cassé le premier passage —
`.convex.cloud` aurait produit une erreur sans rapport avec l'authentification.

**Les sept sont acceptés**, aucun refus cette ronde :

- 1 et 2 fusionnent en une seule décision de forme : `LAST_RUN.json` devient un **manifeste
  obligatoire** avec son propre schéma `backupManifestSchema`, validé **avant** toute recette, porteur
  de la `formatVersion` qui gouverne les fichiers. Il est exclu par nom de la découverte des recettes
  **et** du calcul du seuil de suppression. L'autre option offerte — envelopper chaque recette dans
  `{ formatVersion, recipe }` — est écartée et le motif est écrit dans les risques : elle abîme la
  lisibilité du diff, qui est le livrable de la tâche.
- 3 introduit `restorableProjection`, partagée, qui force les deux `storageId` à `null` des deux côtés
  du digest.
- 4 sépare les deux cibles : `--yes` contre `dev` seulement ; contre la production, `--prod` **et**
  `--confirm-replace`, sans `--yes`, donc la confirmation interactive de Convex reste.
- 5 ajoute un input booléen `allow_prune` au `workflow_dispatch`, `false` par défaut, non offert au
  `schedule`.
- 6 corrige la phrase : après un échec local, `git status` puis `trash` sur les fichiers non suivis.
- 7 fixe `CONVEX_BACKUP_URL=https://fleet-bat-50.convex.site/backup`, avec le motif, et ajoute un
  smoke test authentifié plus un `workflow_dispatch` manuel **avant** d'activer le `schedule`.

## Round 3 — Codex

Les sept corrections de la ronde 2 sont jugées intégrées, et l'absence de wrapper par fichier est
acceptée comme « un compromis acceptable puisque la restauration refuse tout snapshot sans manifeste
reconnu ». Verdict `VERDICT: REVISE`, avec pour la première fois une séparation explicite entre ce qui
bloque et ce qui ne bloque pas.

**Défaut bloquant** — _le manifeste n'est pas confronté aux fichiers découverts._ Il est validé
structurellement, mais son `total` et ses comptes par statut ne sont comparés à rien. Un fichier
supprimé par accident produit donc un import tronqué **dont le digest passe**, puisque le côté attendu
et le côté restauré s'appuient tous deux sur le même ensemble amputé.

**Raffinements non bloquants** — `Cache-Control: no-store` sur la réponse authentifiée ; tester la
comparaison de jeton avec des longueurs différentes, une primitive du genre `timingSafeEqual` levant
dans ce cas ; `timeout-minutes` sur le job et une échéance sur le `fetch`.

### Claude's response

**Le défaut bloquant est accepté et c'est le meilleur constat de la revue** : il attaque la
vérification elle-même, pas le mécanisme. Le manifeste devient le témoin extérieur de ce que la
sauvegarde devrait contenir — total et comptes par statut comparés aux fichiers validés **avant** de
générer le JSONL, toute divergence arrête la restauration, et un cas de test est ajouté pour le
fichier manquant comme pour le compte faux.

**Les trois raffinements sont pris tout de suite** plutôt que reportés à l'implémentation : ils
coûtent une ligne chacun et deux d'entre eux changent un comportement observable. En particulier la
comparaison de jeton porte désormais sur le **condensé** des deux valeurs — sans ça, un jeton d'une
autre longueur produit une 500 au lieu d'un `401`, ce qui est à la fois un bug et une fuite
d'information. Le test correspondant est ajouté à la matrice.

## Round 4 — Codex

`VERDICT: APPROVED`. « Aucun défaut matériel restant. » Les points fermés, dans les termes de la
revue : le manifeste détecte un snapshot tronqué **avant** l'import destructif ; l'authentification
renvoie systématiquement `401`, longueur incorrecte comprise, et interdit la mise en cache ; les
limites temporelles empêchent un runner bloqué ; la restauration reste atomique, idempotente,
vérifiable et doublement protégée en production ; le diff Vercel, le routage Convex et le push GitHub
sont cohérents avec l'environnement réel ; et les compromis refusés sont documentés sans empêcher
l'objectif. « Les détails restants relèvent de l'implémentation et de l'exécution des tests prévus,
pas d'une révision architecturale. »

## Résolution

Convergence à la ronde 4 sur un maximum de 5. Vingt-trois constats reçus au total, vingt et un
acceptés, deux refusés avec motif écrit — et les deux refus ont été retirés par le reviewer lui-même
à la ronde suivante.

Ce que les deux actes ont changé, en dehors de la forme :

- **Deux affirmations fausses du plan initial ont été détruites par des faits vérifiables** :
  « `HEAD^` est la seule base de comparaison possible » (`VERCEL_GIT_PREVIOUS_SHA` existe) et « Convex
  n'accepte pas qu'on impose un `_id` » (vrai pour `ctx.db.insert`, faux pour `convex import`). La
  seconde a remplacé une boucle de mutations non atomique par un import atomique et idempotent.
- **Le mécanisme de vérification a été attaqué, pas seulement le mécanisme de sauvegarde.** Sans la
  confrontation du manifeste aux fichiers découverts, la preuve de restauration validait un import
  tronqué. C'est le constat qui a le plus rapproché T9 d'une vraie sauvegarde.
- **Trois pièges d'environnement réel ont été évités avant le premier passage** : `.convex.site` et
  non `.convex.cloud`, `LAST_RUN.json` avalé par son propre miroir, et une modification de `ci.yml`
  qui n'aurait rien protégé puisqu'un push au `GITHUB_TOKEN` ne déclenche aucun workflow.

## Act 3 — Build

Builder : Codex `gpt-5.6-sol`, effort `medium`, codex-cli 0.144.5. Spec gelée :
`docs/superpowers/plans/2026-08-11-t9-export/PLAN.md`, sections 1 à 8. La section 9
(provisionnement) est restée hors du diff, par contrat.

### Round 1 — Codex build

Dix fichiers créés, quatre modifiés. Les cinq commandes de preuve passent chez Codex : `typecheck`,
161 tests sur 26 fichiers, `eslint`, `prettier --check`, `actionlint`. Aucune déviation déclarée.

### Claude's verdict — round 1

Preuves relancées de mon côté, toutes vertes. Trois vérifications indépendantes du rapport :

- `npx convex codegen` reproduit la modification de `convex/_generated/api.d.ts` à l'octet — aucune
  dérive de fichier généré, ce que le rapport ne pouvait pas prouver seul.
- La comparaison d'authentification porte bien sur les condensés SHA-256 des deux en-têtes, sur 32
  octets fixes : un jeton de longueur différente donne un `401`, pas une 500.
- Le test de déterminisme réordonne les treize clés de la fixture et compare les octets. C'est le bon
  test, pas une approximation — il prouve au passage que `parse` normalise l'ordre des clés.

Quatre problèmes renvoyés, un mineur en prime :

1. **`restorableProjection` était du code mort** — trois occurrences en tout, sa définition et son
   propre test. La preuve centrale du plan, la comparaison _après_ restauration par digest canonique,
   n'avait aucune implémentation : `assertManifestMatches` ne couvrait que fichiers contre manifeste.
   C'était le seul écart qui touchait la valeur de la tâche, pas sa forme.
2. **Les tests des scripts étaient rangés dans `src/lib/`** et importaient `../../scripts/backup`,
   parce que `vitest.config.ts` n'incluait que `src/**` et `convex/**`. Le correctif était la config.
3. **`git config user.name github-actions[bot]` non quoté** — `[bot]` est un glob bash, cassé le jour
   où un fichier d'un caractère nommé `b`, `o` ou `t` traîne à la racine.
4. **La première exécution réelle échouera à coup sûr** et rien ne le disait : la production a zéro
   recette, donc le garde-fou n° 1 refuse. À documenter, pas à affaiblir.
5. Mineur : deux comparateurs pour un même ordre d'identifiants, `<`/`>` dans `convex/export.ts` et
   `localeCompare` dans `scripts/restore.ts`.

### Round 2 — Codex fix

Les cinq points corrigés. La vérification post-import existe maintenant et tourne par défaut :
relecture de la cible par `convex run export:backupPayload`, validation Zod de la sortie, comparaison
des comptes au manifeste puis du digest canonique calculé des deux côtés à travers
`restorableProjection`. Tests déplacés vers `scripts/`, `vitest.config.ts` étendu, quotes posées,
`backup/README.md` documente la base vide et la vérification, comparateur unifié en
`compareBackupIds`.

### Claude's verdict — round 2

Preuves relancées : `typecheck` propre, **166 tests sur 26 fichiers**, `eslint` sans rien,
`prettier --check` conforme, `actionlint` propre. Diff relu intégralement. Le test qui compte est là et
dit la bonne chose : deux jeux de recettes ne différant que par leurs `storageId` produisent le
**même** digest — c'est exactement la raison d'être de `restorableProjection`.

Un seul chemin reste non prouvé, et par ma propre contrainte : le branchement CLI de la vérification
(`convex run` et l'analyse de sa sortie) n'a jamais tourné contre un déploiement réel. Les fonctions
pures qu'il entoure sont testées ; le tuyau ne l'est pas. Il se validera à la première restauration
réelle contre `dev`, qui fait partie du provisionnement.

Total : 18 fichiers, +1493 −1. Deux rounds sur deux autorisés, aucune reprise en main nécessaire.
