# Plan : T9 — export automatique versionné dans git

_Verrouillé par grill — Claude + Florian, 2026-08-11. Révisé après trois rondes de revue
adversariale, approuvé à la quatrième._

## Goal

Donner au projet une copie de la donnée éditoriale **hors de Convex**, versionnée, et un historique
qui se lit recette par recette. Une tâche planifiée hebdomadaire interroge un endpoint HTTP Convex
dédié, écrit un fichier JSON par recette sous `backup/` de ce dépôt, et commite. Un script de
restauration, essayé contre le déploiement de dev, complète la boucle : sans lui ce ne serait pas une
sauvegarde mais un dépôt de fichiers.

Ce qui motive la tâche : l'offre gratuite Convex ne fait **aucune** sauvegarde automatique, garde
sept jours et deux copies au maximum, et tout reste chez le même hébergeur. Une fois les photos
purgées par T7, les recettes corrigées à la main sont la seule donnée du projet longue à reproduire.

## État de départ constaté

Vérifié dans le dépôt et dans la documentation le 2026-08-11 :

| Fait                                                                                                                                                                                           | Conséquence pour ce plan                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Le dépôt est **public** (`gh repo view` → `PUBLIC`)                                                                                                                                            | Le `GITHUB_TOKEN` du runner suffit à commiter, aucun PAT nulle part                                                |
| `recipes.status ∈ {review, published}`, `slug` **optionnel** et **sans contrainte d'unicité**                                                                                                  | Le nom de fichier a besoin d'un repli et d'une détection de collision                                              |
| `searchText`, `beautifiedAccepted`, `beautifyStatus` sont **requis** dans le schéma                                                                                                            | Une restauration doit les reconstruire, pas les omettre                                                            |
| `buildSearchText(title, ingredients)` existe dans `src/lib/normalize.ts`                                                                                                                       | `searchText` se recalcule sans dupliquer de logique                                                                |
| `recipeSchema` (`src/lib/recipe-schema.ts`) est un `strictObject` sans `id`, `status`, `slug`, `publishedAt` ni `storageId`, et exige des champs `nullable` là où Convex stocke des optionnels | **Il ne peut pas valider la charge de sauvegarde** : il faut un schéma dédié et versionné                          |
| `recipes:countsByType` filtre `status: 'published'`                                                                                                                                            | Il ne peut pas vérifier une restauration qui contient aussi des `review`                                           |
| Ni `convex/crons.ts` ni `convex/http.ts` n'existent                                                                                                                                            | `http.ts` est un fichier neuf ; aucun cron Convex n'est introduit                                                  |
| `vercel.json` porte `ignoreCommand: test "$VERCEL_ENV" != production`                                                                                                                          | Un commit sur `main` redéploie la production — vérifié en vrai le 2026-08-10                                       |
| **`VERCEL_GIT_PREVIOUS_SHA`** existe : « the git SHA of the last successful deployment for the project and branch », exposée uniquement quand un Ignored Build Step est configuré              | La bonne base de comparaison est le dernier déploiement réussi, pas `HEAD^`                                        |
| **`convex import` conserve `_id` et `_creationTime`** s'ils sont fournis, exige le format d'id Convex, et « creates and replaces tables atomically »                                           | La restauration est un import atomique, pas une série de mutations                                                 |
| Un push effectué avec le `GITHUB_TOKEN` du runner **ne déclenche pas** de nouvelle exécution de workflow                                                                                       | Aucune modification de `ci.yml` n'est nécessaire ; Vercel, lui, réagit au webhook git et a besoin de son garde-fou |
| `tsx` et Zod sont déjà là                                                                                                                                                                      | Les scripts sont du TypeScript lancé par `tsx`                                                                     |
| Convex gratuit : sauvegardes **manuelles** seulement, 7 jours, 2 par déploiement. Périodique quotidienne ou hebdo = **Pro** (25 USD/mois)                                                      | La sauvegarde intégrée ne couvre pas le besoin, même à cadence hebdomadaire                                        |

## Approach

### 1. `src/lib/backup-schema.ts` — la forme, versionnée et à part

Deux schémas Zod dédiés et un numéro de version, `BACKUP_FORMAT_VERSION = '1'` :

- `backupRecipeSchema` — une recette sauvegardée. Sert **aux deux bouts** : validation de la charge
  reçue par le script d'export, validation de chaque fichier lu par le script de restauration.
- `backupManifestSchema` — le contenu de `backup/LAST_RUN.json` : `formatVersion`, horodatage, total,
  comptes par statut. C'est un **manifeste obligatoire**, pas un journal décoratif : il porte la
  version qui gouverne les fichiers recette, et le script de restauration le lit et le valide
  **avant** de toucher une seule recette. Sans lui, ou avec une `formatVersion` inconnue, la
  restauration s'arrête.

Le manifeste est aussi ce qui évite deux pièges de miroir : `LAST_RUN.json` est exclu par nom de la
découverte des fichiers recette **et** du calcul du seuil de suppression. Sinon il serait validé
comme une recette — et échouerait — puis compté comme une recette disparue.

Et un troisième objet partagé, `restorableProjection` : la projection d'une recette sur ce qui
**survit réellement** à une restauration, `imageStorageId` et `beautifiedStorageId` forcés à `null`.
C'est elle, et non la sauvegarde brute, qui sert à comparer avant et après.

Champs, dans cet ordre — c'est aussi l'ordre d'écriture :

`id`, `creationTime`, `title`, `type`, `servings`, `ingredients[]` (`raw`, `quantity`, `unit`,
`label`), `ingredientsInferred`, `steps[]`, `status`, `slug`, `publishedAt`, `imageStorageId`,
`beautifiedStorageId`.

Tous les champs facultatifs sont normalisés en `null`, jamais absents : un champ qui apparaît et
disparaît produirait un diff sur un document inchangé. `id` et `creationTime` sont là parce que
`convex import` sait les restaurer — ce sont eux qui rendent la restauration idempotente.

Exclus délibérément : `searchText` (dérivé de `title` et `ingredients`), `beautifyStatus`,
`beautifyAttemptId`, `beautifyError` (machine à états), `beautifiedAccepted` (décision humaine, mais
sur une image que la sauvegarde ne contient pas), `scanId` (pointe vers une table non sauvegardée).

### 2. `convex/export.ts` — la donnée à sauvegarder

Une `internalQuery` `backupPayload`, avec `args: {}` et un validateur `returns` explicite construit
depuis un validateur Convex partagé `backupRecipe` — le pendant côté Convex du schéma Zod
ci-dessus. Elle renvoie toute recette de statut `review` ou `published`, triée par `_id` croissant,
projetée sur les champs ci-dessus, optionnels normalisés en `null`.

### 3. `convex/http.ts` — l'endpoint de lecture

Fichier neuf, structure imposée par Convex :

```ts
const http = httpRouter()
http.route({ path: '/backup', method: 'GET', handler: backupEndpoint })
export default http
```

`backupEndpoint` est un `httpAction` qui : lit l'en-tête `Authorization`, le compare à
`process.env.BACKUP_TOKEN` **en temps constant**, répond `401` avec un corps vide si ça ne colle pas
ou si la variable est absente, puis appelle `ctx.runQuery(internal.export.backupPayload, {})` et
renvoie `{ formatVersion, generatedAt, recipes }` en `application/json`, avec
`Cache-Control: no-store`.

Deux détails de la comparaison en temps constant : elle porte sur le **condensé** des deux valeurs,
pas sur les valeurs elles-mêmes, parce qu'une primitive du genre `timingSafeEqual` **lève** quand les
longueurs diffèrent — un jeton d'une autre taille produirait une erreur 500 au lieu d'un `401`. Et
l'absence de `BACKUP_TOKEN` côté serveur doit refuser, jamais laisser passer.

`BACKUP_TOKEN` : 32 octets aléatoires, variable d'environnement Convex posée **sur la production
seulement**. Le choix d'un endpoint plutôt que d'une clé de déploiement dans un secret GitHub est
délibéré : une clé de déploiement donne les pleins pouvoirs d'écriture sur la production, l'endpoint
ne donne qu'une lecture de la charge de sauvegarde.

### 4. `scripts/backup.ts` — le miroir et ses garde-fous

Lancé par `npm run backup`. **Rien n'est écrit avant que tout soit décidé** : la charge est lue,
validée, les chemins calculés, les collisions détectées et les suppressions autorisées, et seulement
ensuite le disque est touché.

1. Préflight : `CONVEX_BACKUP_URL` et `BACKUP_TOKEN` présents, sinon échec immédiat avec le nom de la
   variable manquante.
2. `GET` l'endpoint, avec un délai maximal explicite — un `fetch` sans échéance laisserait le job
   pendu jusqu'au plafond du runner. Valider `formatVersion` et chaque recette contre
   `backupRecipeSchema`. Une charge invalide arrête tout avant d'avoir touché un fichier.
3. **Garde-fou n° 1** : une liste vide arrête le script en échec. C'est le mode de panne qui
   effacerait toute la sauvegarde en ayant l'air normal.
4. Calculer le nom de fichier de chaque recette : `backup/<slug>.json`, où `<slug>` est réduit à
   `[a-z0-9-]+`. Repli `backup/<id>.json` si le slug est absent, vide après réduction, ou égal au nom
   réservé `LAST_RUN`. **Deux recettes qui réclament le même fichier arrêtent le script** en nommant
   les deux `id` : le schéma n'impose pas l'unicité du slug, donc une collision est un vrai problème
   de donnée, pas un cas à arbitrer silencieusement.
5. Sérialiser chaque recette dans l'ordre de clés du schéma, indentation 2, saut de ligne final. Un
   fichier dont les octets ne changent pas n'est pas réécrit.
6. Lister les fichiers de `backup/` qui ne correspondent plus à aucune recette, `LAST_RUN.json`
   **exclu par nom**. **Garde-fou n° 2** : si les suppressions dépassent 20 % des fichiers recette
   existants, arrêter en échec, sauf `BACKUP_ALLOW_PRUNE=1`. Sinon les supprimer — c'est le miroir
   voulu, l'historique git garde la trace.
7. Écrire le manifeste `backup/LAST_RUN.json` : `formatVersion`, horodatage, total, comptes par
   statut.
8. Sortir un résumé sur la sortie standard : combien de fichiers écrits, supprimés, inchangés. C'est
   ce que le message de commit reprendra.

### 5. `.github/workflows/backup.yml` — la tâche planifiée

`on: schedule` à `0 3 * * 0` (dimanche 03 h UTC) et `workflow_dispatch` avec un **input booléen
`allow_prune`, `false` par défaut**, transmis en `BACKUP_ALLOW_PRUNE=1` au script. Sans lui, une
suppression légitime de plus de 20 % — une purge de recettes voulue — bloquerait la sauvegarde à
chaque exécution suivante, y compris manuelle, sans aucun moyen de la débloquer autrement qu'en
éditant le workflow. L'input n'est pas offert au `schedule` : le contournement reste un geste humain.

`permissions: contents: write`, `timeout-minutes: 10`, groupe de `concurrency` sans annulation,
actions tierces épinglées par SHA comme dans `preview.yml`.

Le job : checkout de `main`, `npm ci --ignore-scripts`, `npm run backup` avec `CONVEX_BACKUP_URL` et
`BACKUP_TOKEN` en secrets de dépôt, puis commit et push.

Deux détails qui comptent :

- **Message de commit distinct selon le contenu** : `chore(backup): 12 recipes, 2 changed` quand des
  recettes ont bougé, `chore(backup): heartbeat, no recipe changed` quand seul `LAST_RUN.json`
  change. `git log --oneline backup/` reste lisible malgré le battement hebdomadaire.
- **Un push rejeté fait échouer le job, sans rebase.** Une PR mergée pendant l'exécution peut avoir
  changé le format, le schéma ou `backup/` lui-même : rejouer un instantané produit avec l'ancien
  code au-dessus du nouveau `main` est faux même quand git ne signale aucun conflit. Le job rouge est
  le bon signal, et `workflow_dispatch` permet de relancer proprement.

### 6. Ne pas redéployer la production pour rien

Une seule ligne, dans `vercel.json` :

```
test "$VERCEL_ENV" != production || git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . ':(top,exclude)backup/**'
```

Rappel de l'orientation : **sortie 0 = build ignoré**. Hors production, le premier test suffit. En
production, on ignore le build quand rien n'a changé en dehors de `backup/` **depuis le dernier
déploiement réussi** — pas depuis le commit précédent, ce qui couvre les push multi-commits. Si
`VERCEL_GIT_PREVIOUS_SHA` est vide ou absent du clone, `git diff` sort non nul et **le build a
lieu** : l'échec est du bon côté.

Aucune modification de `ci.yml`. Un push fait avec le `GITHUB_TOKEN` du runner ne déclenche pas de
workflow, donc les six contrôles ne tourneront pas sur le commit de sauvegarde. Vercel, lui, réagit
au webhook git et pas aux workflows : d'où l'asymétrie, et d'où le garde-fou ci-dessus.

Ajouter `backup` à `.prettierignore` : le script produit un JSON déterministe qui n'a pas à
satisfaire prettier, et `npm run check` ne doit pas casser à cause d'une sauvegarde.

### 7. `scripts/restore.ts` — un import atomique, pas des mutations

Lancé par `npm run restore`. Lit et valide d'abord le manifeste `backup/LAST_RUN.json` et sa
`formatVersion`, puis les fichiers recette — `LAST_RUN.json` exclu — contre `backupRecipeSchema`.

Ensuite, et **avant de générer quoi que ce soit** : le total et les comptes par statut des fichiers
validés sont comparés à ceux que déclare le manifeste. Toute divergence arrête la restauration. Sans
ce contrôle, un fichier supprimé par accident produirait un import silencieusement tronqué — et le
digest de vérification le laisserait passer, puisque le côté attendu et le côté restauré
s'appuieraient tous deux sur le même ensemble amputé. Le manifeste est le seul témoin extérieur de ce
que la sauvegarde devrait contenir.

Puis **écrire un JSONL** où chaque ligne est un document `recipes` complet :

- `_id` et `_creationTime` repris de la sauvegarde — `convex import` les conserve, ce qui rend une
  restauration répétée idempotente au lieu de dupliquer les recettes ;
- `searchText` recalculé par `buildSearchText` ;
- `beautifiedAccepted: false`, `beautifyStatus: 'idle'` — requis par le schéma, absents de la
  sauvegarde ;
- `scanId`, `imageStorageId`, `beautifiedStorageId` **omis** : les blobs et les scans n'existent pas
  dans le déploiement cible.

Puis `convex import --table recipes --replace`, qui remplace la table atomiquement. Deux niveaux de
garde, parce que la commande détruit :

- **contre `dev`**, la cible par défaut : `--yes` est passé, la table de dev est jetable ;
- **contre la production**, il faut `--prod` **et** `--confirm-replace`, et `--yes` n'est **pas**
  passé — la confirmation interactive de Convex reste donc en place. `--yes` existe précisément pour
  supprimer ce garde-fou : le passer en production ferait de `--prod` un remplacement total sans
  aucune confirmation.

Avant d'écrire, le script affiche combien de recettes il va restaurer, par statut, et ce qu'il perd.

**Preuve à produire** : restauration réelle contre `dev`, puis comparaison de deux choses entre la
sauvegarde et la base — les **comptes par statut** et un **digest canonique**. Le digest se calcule
des deux côtés à travers `restorableProjection`, jamais sur la sauvegarde brute : le JSONL omet
volontairement les deux `storageId`, donc comparer les champs bruts renverrait toujours faux.
`recipes:countsByType` ne sert pas ici : il ne compte que les `published`.

### 8. Tests

- `backup-schema` : un document complet passe, un champ en trop échoue, un optionnel absent échoue
  (la normalisation en `null` est le contrat).
- Nommage : slug avec accents, espaces, `/`, `..`, slug vide, slug `LAST_RUN`, deux slugs identiques
  (doit échouer), slug absent.
- Garde-fous : liste vide, suppressions à 19 % et à 21 %, contournement par `BACKUP_ALLOW_PRUNE`, et
  `LAST_RUN.json` jamais compté comme une recette supprimée.
- Manifeste : absent, `formatVersion` inconnue, `formatVersion` attendue — la restauration s'arrête
  dans les deux premiers cas. Et surtout : un fichier recette manquant, ou un compte par statut qui
  ne colle pas au manifeste, doit arrêter la restauration.
- Déterminisme : deux sérialisations de la même recette donnent les mêmes octets ; l'ordre des clés
  ne dépend pas de l'ordre d'arrivée.
- Endpoint : sans en-tête, avec un mauvais jeton, **avec un jeton d'une autre longueur**, avec
  `BACKUP_TOKEN` absent côté serveur → `401` dans les quatre cas, jamais une 500 ; avec le bon jeton
  → `200`.
- Restauration : construction du JSONL depuis un jeu de fichiers, avec `searchText` recalculé et les
  champs requis reconstruits ; un second passage produit le même JSONL.
- `actionlint` sur `backup.yml`.

### 9. Provisionnement et journal

À faire une fois, hors diff. Générer `BACKUP_TOKEN`, le poser en variable d'environnement Convex sur
la production, créer les deux secrets de dépôt `CONVEX_BACKUP_URL` et `BACKUP_TOKEN` — ni l'un ni
l'autre n'existe aujourd'hui, vérifié.

`CONVEX_BACKUP_URL` vaut **`https://fleet-bat-50.convex.site/backup`**, et pas `.convex.cloud`. Une
action HTTP Convex n'est pas servie sur le domaine applicatif : la documentation prévient
explicitement « make sure this is the URL that ends in `.convex.site` ». `.convex.cloud` est l'URL du
client, celle qui est déjà dans `VITE_CONVEX_URL` — s'en servir ici donnerait une erreur qui n'a rien
à voir avec l'authentification.

**Smoke test avant d'activer le `schedule`** : un `curl` authentifié sur l'endpoint, puis un
`workflow_dispatch` manuel. Le `schedule` n'est ajouté qu'après.

Puis `backup/README.md` (format, ordre des clés, règle de nommage, rôle du manifeste, procédure de
restauration et ce qu'elle ne restaure pas), cocher T9 dans le fichier de tâches et le passer à ✅
dans `docs/SUIVI.md`.

## Key decisions & tradeoffs

1. **La sauvegarde vit dans ce dépôt public.** Motif retenu : la provenance des recettes n'est
   stockée nulle part — `DESIGN.md` acte que le champ n'existe pas — donc le texte ne désigne aucune
   source. Contrepartie assumée et irréversible : le contenu devient consultable par la recherche
   GitHub, indexable, et présent dans l'historique git pour toujours. Un dépôt privé dédié avait été
   proposé et écarté.
2. **`published` et `review`.** La spec disait « les recettes publiées », mais son propre motif parle
   des corrections manuelles — or une recette en `review` les porte déjà.
3. **Aucun octet d'image.** Git est un mauvais magasin de blobs, et `DESIGN.md` pose que la moitié
   des recettes n'aura jamais d'image. Les `storageId` restent dans le JSON pour la traçabilité, pas
   pour la restauration.
4. **Un endpoint HTTP à secret plutôt qu'une clé de déploiement.** Moindre privilège : le secret
   n'ouvre qu'une lecture de sauvegarde, pas l'écriture sur la production.
5. **Hebdomadaire, plus déclenchement manuel.** Fenêtre de perte de sept jours, acceptée.
6. **Un fichier par recette, nommé par slug réduit, repli sur l'id, collision fatale.** C'est le
   critère d'acceptation : « historique lisible recette par recette ». Le schéma n'imposant pas
   l'unicité du slug, écraser silencieusement serait perdre une recette dans la sauvegarde même.
7. **Un schéma de sauvegarde dédié et versionné**, et non `recipeSchema`. Celui du projet est
   `strict`, ignore `status`, `slug`, `publishedAt` et les `storageId`, et attend des `nullable` là
   où Convex stocke des optionnels. Le réutiliser aurait fait échouer la validation au premier
   passage.
8. **`_id` et `_creationTime` sont sauvegardés.** Parce que `convex import` sait les restaurer : c'est
   ce qui transforme la restauration en opération idempotente.
9. **La restauration est un `convex import --replace`, pas une série de mutations.** Atomique par
   contrat, contre une boucle de mutations qui laisse une base à moitié écrite si elle casse au
   milieu, et qui duplique tout si on la relance.
10. **Répertoire `backup/` sur `main`, pas de branche orpheline.** Une seule branche à connaître. Le
    prix est le test de chemin dans `ignoreCommand`, sur le chemin critique du déploiement.
11. **Le battement hebdomadaire est conservé, contre l'avis de la revue.** `LAST_RUN.json` change à
    chaque passage, donc un commit part même sans correction. C'est voulu : GitHub désactive
    silencieusement les `schedule` d'un dépôt inactif depuis 60 jours, et la date du dernier commit
    est le seul signal de vie visible sans ouvrir l'onglet Actions. Un résumé d'exécution Actions
    disparaît de la vue et ne dit rien d'un workflow qui ne tourne plus. Le coût — 52 commits par an
    — est absorbé par le message de commit distinct, et ne touche pas
    `git log backup/<slug>.json`, qui reste l'historique promis par la tâche.
12. **Pas de répertoire temporaire ni d'échange atomique côté script**, contre l'avis de la revue.
    Tout est décidé en mémoire avant la première écriture, ce qui couvre le cas utile. Au-delà, la
    frontière transactionnelle réelle est le commit : le workflow ne commite que si le script sort
    à 0, et sur un runner éphémère un miroir à moitié écrit n'est jamais publié. En local, la reprise
    demande de regarder `git status` : `git restore backup/` remet les fichiers suivis, mais **ne
    supprime pas** ceux qu'une écriture interrompue vient de créer — ils sont non suivis, à envoyer à
    `trash` à la main.
13. **Un push rejeté échoue au lieu de rebaser.** Un instantané produit avec l'ancien code n'est pas
    rendu valide par l'absence de conflit git.
14. **Aucun cron Convex.** La planification vit dans GitHub Actions, où les logs et le bouton de
    relance sont déjà.
15. **Aucune modification de `ci.yml`.** Un push au `GITHUB_TOKEN` ne déclenche pas de workflow : la
    protection envisagée n'aurait rien protégé.
16. **Pas de limitation de débit applicative sur l'endpoint.** Le jeton fait 32 octets aléatoires et
    la plateforme a ses propres limites.

## Risks / open questions

- **`VERCEL_GIT_PREVIOUS_SHA` n'est exposée que si un Ignored Build Step est configuré.** C'est notre
  cas — `ignoreCommand` est précisément cela — mais la variable pointe le dernier déploiement
  **réussi** : après un build en échec, la comparaison porte sur une base plus ancienne, donc elle
  élargit le diff et fait construire plus souvent que nécessaire. Erreur du bon côté.
- **Le SHA précédent peut être absent du clone.** `git diff` échoue, sortie non nulle, le build a
  lieu. Du bon côté également.
- **GitHub désactive les `schedule` après 60 jours d'inactivité du dépôt**, silencieusement. Le
  battement hebdomadaire commite, donc le dépôt n'est jamais inactif — le mécanisme se protège
  lui-même tant qu'il tourne. S'il s'arrête, la date du dernier commit le dit.
- **Aucune alerte active.** Personne n'est prévenu si la tâche se tait ; il faut regarder. Assumé
  pour un projet à un mainteneur.
- **`convex import --replace` remplace la table entière** : une recette créée après la sauvegarde
  disparaît à la restauration. C'est la définition d'une restauration, mais il faut le savoir avant
  de lancer la commande sur la production.
- **Le jeton donne accès aux brouillons.** Qui détient `BACKUP_TOKEN` peut lire les recettes en
  `review`. Elles partent dans un dépôt public de toute façon : exposition réelle nulle.
- **Les previews n'auront pas `BACKUP_TOKEN`** — l'endpoint y répond `401`, ce qui est correct.
- **Sept jours de perte possible**, par choix de cadence.
- **Les photos ne sont pas sauvegardées.** Seule l'offre Pro, ou un export manuel avec
  `--include-file-storage`, les couvrirait.
- **Le format de sauvegarde a une version, mais aucune migration n'est écrite.** Passer à
  `formatVersion: '2'` demandera de décider quoi faire des fichiers existants. Hors périmètre
  aujourd'hui, mais le manifeste porte le champ pour que la question soit posable — et pour qu'une
  restauration refuse une version qu'elle ne connaît pas au lieu de deviner.
- **La version vit dans le manifeste, pas dans chaque fichier recette.** Un fichier recette déplacé
  ou récupéré seul, hors de son manifeste, n'est plus interprétable avec certitude. L'alternative —
  envelopper chaque recette dans `{ formatVersion, recipe }` — a été écartée : elle ajoute une
  indirection à chaque fichier et abîme précisément la lisibilité du diff que la tâche cherche.

## Out of scope

- **Les octets des images** et toute forme de stockage de blob dans git.
- **Les tables `scans` et `uploadTickets`** : reproductibles, contrairement à une correction.
- **L'offre Convex Pro** et ses sauvegardes périodiques intégrées.
- **La restauration du graphe complet** — liens de scan, blobs.
- **Un second remote de sauvegarde** (disque, autre hébergeur).
- **Toute alerte active** en cas de tâche muette.
- **Une migration de `formatVersion`.**
- **La publication d'un brouillon** (reliquat R3) : la sauvegarde lit les deux statuts, elle ne
  change pas la façon dont ils se remplissent.
