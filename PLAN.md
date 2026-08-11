# Plan : T7 rétention des photos de scan + T10 surface de file d'attente

_Verrouillé par grill — Claude + Florian, 2026-08-10. Branche `worktree-t7-t10-admin`, base `694cd6d`._
_Révisé après les rounds 1, 2 et 3 de revue Codex (voir `PLAN-REVIEW-LOG.md`)._

## Goal

Rendre la surface `/admin` utilisable au quotidien en fermant deux trous adjacents. **T7** : une
photo de scan ne doit jamais disparaître avant qu'on ait pu constater qu'une extraction était
partielle — aujourd'hui rien ne la supprime, et le jour où quelque chose la supprimera il faut que
ce soit tard et volontaire. **T10** : un scan bloqué doit se voir sans effort, et le bouton
d'extraction doit dire la vérité sur ce qu'il vient de faire. Les deux sont couplés par l'écran : un
scan dont la photo est purgée ne peut plus être relancé, et si l'écran ne le dit pas, cette
impossibilité passe pour un bug.

## État de départ, vérifié dans le code

- `scans.purgeAfter` et l'index `by_purge_after` **existent dans le schéma et ne sont ni lus ni
  écrits par une seule ligne de code**. Aucun `ctx.storage.delete` ne porte sur une photo de scan.
  → T7 n'est pas « remplacer la suppression immédiate » : la suppression n'a jamais été écrite.
- Aucun `convex/crons.ts`.
- `recipes.status` ne vaut que `review | published`, et **rien n'écrit `published`** (reliquat R3).
  → le déclencheur décrit dans la tâche (« `purgeAfter` posé seulement quand plus aucune recette du
  scan n'est en `review` ») est faux pour l'éternité en l'état.
- **`recipes.imageStorageId` est écrit aujourd'hui**, par `devImages.attach` (`convex/devImages.ts:43`)
  et par `seed.ts`, tous deux gardés par déploiement (`assertDevDeployment()`,
  `ALLOW_DESTRUCTIVE_SEED`). L'affirmation « rien ne l'écrit avant T14 » des versions précédentes de
  ce plan était **fausse**.
- `sweepTickets` supprime les tickets consommés au bout de 7 jours (`CONSUMED_TICKET_RETENTION_MS`).
  Une ligne de `uploadTickets` n'est donc **pas** un enregistrement durable.
- `createScan` est **déjà idempotent sur une reprise réseau** : un ticket déjà consommé avec le même
  `storageId` rend le `scanId` existant.
- `src/routes/admin/file` n'existe pas. L'admin est un seul `src/routes/admin.tsx` (158 lignes).
- `startExtraction` renvoie `v.null()`, se contente de `scheduler.runAfter(0, drain)` et rend la main
  **avant** que `drain` tourne. L'UI affiche donc « Extraction démarrée. » y compris quand `drain`
  sort immédiatement en `lease_held`, `no_work` ou `rate_limited`.
- `reserve` est le **seul point d'exclusion atomique** de la file : il récupère les baux expirés
  (`startedAt <= now - LEASE_MS`, `LEASE_MS = 150 s`) et refuse le travail si un bail est vivant.
- `drain` sur `rate_limited` se replanifie via `scheduler.runAfter(retryAfter, drain)` et **ne laisse
  aucune trace en base**.
- `listScans` établit déjà l'idiome du dépôt pour une lecture bornée : `.take(CAP + 1)` puis un
  booléen `draftsTruncated`.
- Les **guidelines Convex du dépôt** imposent trois contraintes que ce plan doit respecter :
  - `:329` **interdisent de lire l'horloge dans une query** — « pass the current time in as an
    argument […] (`Date.now()` is fine in mutations and actions) » ;
  - `:331` **interdisent `.collect().length` pour compter** — lecture bornée ou
    `@convex-dev/aggregate` ;
  - `:374` **interdisent `crons.weekly`/`daily`/`hourly`** — seuls `crons.interval` et `crons.cron` ;
  - `:99` autorisent `ctx.runMutation` depuis une mutation comme **sous-transaction** : « If a nested
    call throws, its writes roll back independently, so the caller can catch the error and continue
    with its own writes intact. »
- Côté Convex les tests sont sérieux (`convex-test` + vrai schéma + `rateLimiterTest.register`).
  Côté React il n'existe **aucune infra de test** : pas de jsdom, pas de RTL.
- `DESIGN.md` ne contient pas une seule occurrence de « admin ».

## Approche

Une branche, **trois commits**, une PR. Le troisième existe pour que l'ordre de déploiement soit
représentable : le cron ne doit pas pouvoir être déployé avant que le backfill ait été vérifié.

### Commit 1 — T7, rétention côté Convex (sans cron)

1. **Schéma** (`convex/schema.ts`) — deux champs sur `scans` :
   - `purgedAt: v.optional(v.number())` ;
   - `nextAttemptAt: v.optional(v.number())` — l'échéance à laquelle une reprise est déjà planifiée.
     C'est le correctif du constat Codex 4.1 (voir point 15) : sans trace durable, une limitation
     survenue pendant un drain automatique était invisible après un rechargement de l'écran, et la
     file s'affichait « à l'arrêt » alors qu'une reprise était programmée.

   `purgeAfter` reste `v.optional(v.number())` (les lignes existantes n'en ont pas), l'index
   `by_purge_after` est inchangé. **Aucun index nouveau** — voir la décision nº7.

2. **Nouveau fichier `convex/retention.ts`** :

   ```ts
   export const RETENTION_AFTER_TREATMENT_MS = 7 * 24 * 60 * 60 * 1000
   export const RETENTION_CEILING_MS = 90 * 24 * 60 * 60 * 1000
   // Aucune photo ne peut être purgée avant ce délai après la pose de son échéance, quel que soit
   // son âge : c'est ce qui empêche le backfill d'envoyer l'historique à la purge du premier cron.
   export const PURGE_GRACE_MS = 14 * 24 * 60 * 60 * 1000
   // Report appliqué quand la purge tombe sur un scan dont le bail est vivant.
   export const PURGE_DEFERRAL_MS = 2 * LEASE_MS
   // Report appliqué quand la suppression d'un blob échoue : il fait sortir la ligne de la tranche
   // échue, sans quoi un lot entièrement en échec la rebloquerait à chaque passage de cron.
   export const PURGE_FAILURE_BACKOFF_MS = 24 * 60 * 60 * 1000
   export const PURGE_BATCH = 100
   export const BACKFILL_AUDIT_CAP = 1000
   ```

3. **`purgeAfter` est toujours posé, et jamais dans le passé.** Une seule fonction pure décide de
   l'échéance, et les deux écrivains (création, backfill) passent par elle :

   ```ts
   export function ceilingFor({
     createdAt,
     now,
   }: {
     createdAt: number
     now: number
   }): number {
     return Math.max(createdAt + RETENTION_CEILING_MS, now + PURGE_GRACE_MS)
   }
   ```

   **Le `max` est le correctif du constat Codex 1.6, et c'est le plus important du plan** : sans lui,
   tout scan de plus de 90 jours reçoit une échéance déjà passée et part au premier passage du cron,
   sans aucun délai de grâce. `createScan` insère
   `purgeAfter: ceilingFor({ createdAt: consumedAt, now: consumedAt })`.

4. **Audit avant backfill, en une seule lecture bornée** — `internalMutation auditPurgeAfter` :
   parcourt `by_purge_after` avec `q.eq('purgeAfter', undefined)`, **`.take(BACKFILL_AUDIT_CAP + 1)`**,
   n'écrit rien, et journalise le compte, l'échéance minimale que `ceilingFor` poserait, et un
   booléen `truncated`. **Le `+ 1` est le correctif du constat Codex 4.3** : lire exactement
   `BACKFILL_AUDIT_CAP` rendrait « pile 1000 lignes » indiscernable de « tronqué à 1000 ». `truncated`
   se calcule sur la ligne excédentaire, et seules les 1000 premières sont auditées — l'idiome
   `draftsTruncated` du dépôt, appliqué ici aussi.

   **Pas de `dryRun` réenchaînable et pas de curseur** (constats Codex 2.4 et 3.3) : n'écrivant rien,
   un tel mode relirait indéfiniment les mêmes lignes, et un curseur serait de l'infrastructure de job
   pour une opération qu'on lance trois fois dans la vie du projet. Une lecture unique plafonnée à
   1000 est exacte pour un fonds personnel et honnête au-delà, grâce à `truncated`.

5. **Backfill** — `internalMutation backfillPurgeAfter` : même plage d'index, `.take(PURGE_BATCH)`,
   pose `ceilingFor(...)`, se réenchaîne via `ctx.scheduler.runAfter(0, …)` tant qu'un lot est plein.
   Ici le réenchaînement est sûr : chaque ligne traitée quitte la plage d'index. Lancé à la main
   (`npx convex run`), par environnement, jamais depuis le cron.

6. **Libération anticipée** — `releaseIfTreated(ctx, scanId)` : **fonction helper ordinaire** prenant
   un `MutationCtx`. Sort si `purgedAt` est posé ; interroge `recipes.by_scan` à la recherche d'une
   recette en `review` ; s'il n'y en a aucune, patch
   `purgeAfter: Math.min(purgeAfter ?? Infinity, now + RETENTION_AFTER_TREATMENT_MS)`. **Le `min`
   est structurel : la libération abaisse, jamais ne prolonge.**

   **Elle n'a aucun appelant dans cette PR** (constat Codex 1.8, retenu contre la décision du round 1
   du grill). Le brancher sur `recordFailure` aurait fait de l'échec terminal le _seul_ déclencheur
   actif, donc aurait raccourci la rétention exactement des photos dont on a le plus besoin pour
   diagnostiquer un `invalid_image` douteux ou rephotographier — l'inverse du but de T7. Le helper
   est écrit et testé, prêt pour T8/R3. **Conséquence assumée : dans cette PR, le plafond est le seul
   mécanisme de rétention actif.**

7. **Un seul chemin de suppression, atomique par scan** — `internalMutation purgeOneScan({ scanId })`
   dans `retention.ts`, **seule fonction qui supprime un blob**, appelée par le cron comme par la
   purge manuelle via `ctx.runMutation` :

   - si `purgedAt` est déjà posé → sortie sans effet (idempotence) ;
   - **si le bail est vivant** (`status === 'extracting'` et `startedAt > now - LEASE_MS`) → ne
     supprime rien, **reporte** `purgeAfter` à `now + PURGE_DEFERRAL_MS`, rend `'deferred'`. C'était le
     trou du constat Codex 2.3 : le garde-fou n'existait que côté purge manuelle, donc `purgeExpired`
     pouvait supprimer le blob d'une extraction en cours de lecture ;
   - sinon → `ctx.storage.delete` sur chaque id de `imageStorageIds`, puis
     `patch({ imageStorageIds: [], purgedAt: now, purgeAfter: undefined })`, rend `'purged'`.

   **Un scan par sous-transaction** (constat Codex 3.6). C'est ce qui donne au décompte des échecs une
   sémantique sûre : sans isolation, un `ctx.storage.delete` qui jette annulerait tout le lot et
   n'émettrait aucun résumé, tandis qu'un `catch` posé dans le même contexte pourrait committer un
   scan à demi purgé — blobs partiellement supprimés mais `purgedAt` écrit. Les guidelines du dépôt
   (`:99`) garantissent exactement la propriété nécessaire : les écritures d'un appel imbriqué qui jette
   sont annulées indépendamment, et l'appelant continue. Un scan est donc soit entièrement purgé, soit
   intact.

   Effacer `purgeAfter` fait sortir la ligne de la plage d'index pour toujours. **La ligne du scan est
   conservée** — elle porte `lastAttempt` (la télémétrie de T11) et elle est la cible de
   `recipes.scanId` ; la supprimer laisserait les brouillons pointer dans le vide.

8. **Purge automatique** — `internalMutation purgeExpired` :

   ```ts
   const expired = await ctx.db
     .query('scans')
     .withIndex('by_purge_after', (q) =>
       q.gte('purgeAfter', 0).lt('purgeAfter', now),
     )
     .take(PURGE_BATCH)
   ```

   **La borne basse `gte(0)` n'est pas décorative** : dans l'ordre des valeurs Convex un champ absent
   trie avant tous les nombres, donc un `lt('purgeAfter', now)` seul ramasserait toutes les lignes
   sans `purgeAfter` — c'est-à-dire tous les scans antérieurs au point 3 — et les purgerait au
   premier passage. Le backfill du point 5 et cette borne sont deux garde-fous et on garde les deux.

   Chaque ligne passe par `purgeOneScan` en `ctx.runMutation`, dans un `try/catch` qui compte les
   échecs sans arrêter le lot. **Sur échec, la transaction appelante reporte elle-même le
   `purgeAfter` de ce scan de `PURGE_FAILURE_BACKOFF_MS`** — les écritures de l'appel imbriqué ont été
   annulées, celles de l'appelant sont intactes (guidelines `:99`). C'est le correctif du constat
   Codex 4.2 : sans ce report, cent échéances en échec ne quittaient jamais la tranche échue,
   `purgeExpired` refusait de se réenchaîner, et **chaque cron hebdomadaire aurait relu éternellement
   les mêmes cent lignes en laissant tout ce qui est derrière elles impurgé**. Avec le report, un
   échec libère la place au tour suivant et se retente le lendemain.

   Se réenchaîne si le lot est plein **et** qu'au moins une ligne a quitté la tranche échue (purgée ou
   reportée pour échec). Un lot entièrement reporté pour bail vivant ne se réenchaîne pas — sinon un
   bail vivant produirait une boucle serrée.

9. **Journal d'exécution** (constat Codex 1.10) — la purge est la seule opération irréversible du
   système : chaque passage émet une ligne `console.log` structurée (identifiant de lot, examiné,
   purgé, reporté, en échec, réenchaînement). Idem pour l'audit et le backfill.

10. **Purge manuelle** — `mutation purgeScanImages({ adminToken, scanId })` dans `convex/admin.ts`,
    sous `requireAdmin`, déléguant à `purgeOneScan`. Rend le résultat (`purged` / `deferred` /
    `already_purged`) pour que l'écran puisse le dire.

    Autorisée sur `pending`, `done` et `failed` ; refusée sur bail vivant (report). Sur un scan
    `pending` ou à bail expiré, **la mutation le passe elle-même en `failed` avec
    `error: 'Photo purgée'`** : c'était l'objection du constat Codex 2.6 — laisser `reserve` le
    découvrir plus tard transformait le scan en échec artificiel à retardement, sans explication
    entre-temps.

    Rejeté : restreindre aux statuts terminaux. Purger un `pending` est le cas d'usage le plus utile —
    « j'ai photographié la mauvaise page, tue-le avant qu'il coûte un appel modèle ».
    Rejeté aussi : un garde-fou « brouillons encore en `review` ». Rien n'écrivant `published`, il
    interdirait la purge de tout scan ayant produit des recettes. À reconsidérer après R3.

11. **`eligibility`** (`convex/extract.ts`) — un **premier** test, avant celui de cardinalité :

    ```ts
    if (scan.purgedAt !== undefined)
      return { eligible: false, error: 'Photo purgée : rescanner la page' }
    ```

    Sans lui, un scan purgé encore en `pending` tomberait sur `'Le scan doit contenir exactement une
image'`, message faux qui envoie chercher un bug de cardinalité.

12. **Tests** (`convex/retention.test.ts`, en `convex-test`) : `ceilingFor` en fonction pure, dont
    **le cas d'un scan plus vieux que le plafond, qui doit rendre `now + PURGE_GRACE_MS` et non une
    date passée** ; l'audit n'écrit rien et signale `truncated` au plafond ; le backfill ne touche que
    les lignes sans `purgeAfter` ; **une ligne sans `purgeAfter` n'est pas purgée par `purgeExpired`**
    (ce test doit échouer si `gte(0)` est retiré) ; **un scan à bail vivant et à échéance dépassée est
    reporté et son blob survit** ; **un échec de suppression laisse le scan intact, sans `purgedAt`,
    et n'interrompt pas le lot** ; `releaseIfTreated` abaisse mais ne prolonge jamais, et ne libère
    pas tant qu'une recette est en `review` ; la purge vide `imageStorageIds`, pose `purgedAt`, efface
    `purgeAfter` et conserve la ligne ; un scan purgé est inéligible avec le bon message ;
    `purgeScanImages` refuse sans jeton, reporte sur bail vivant, passe un `pending` en `failed`, est
    idempotente.

### Commit 2 — T10, surface de file

13. **`src/lib/queueStatus.ts`, fonctions pures** — toute la dérivation sort du JSX pour être
    testable sans infra React : application de l'offset d'horloge, péremption d'un bail, booléen
    « la file est à l'arrêt », choix du libellé de bouton, mise en forme d'un âge.

14. **`mutation serverTime({ adminToken })`** dans `convex/admin.ts` — rend `Date.now()`. Appelée une
    fois au montage de l'écran pour caler un offset. C'est le correctif du constat Codex 3.4 : les
    guidelines du dépôt (`:329`) **interdisent de lire l'horloge dans une query**, et l'autorisent
    explicitement dans une mutation. Comparer un `startedAt` serveur au `Date.now()` d'un navigateur
    rendrait la détection de bail périmé fausse sur un poste décalé, précisément sur le signal
    critique (constat Codex 1.7) ; l'offset résout les deux à la fois.

15. **La limitation laisse une trace durable, et `queueStatus` la lit.** `reserve` construit son
    verdict `rate_limited` **après** avoir choisi le scan (l'ordre est déjà celui du dépôt : « quota
    last, so idle presses cannot exhaust it »), donc il tient en main la ligne à annoter : il patch
    son `nextAttemptAt` à `now + limit.retryAfter`. `drain` fait de même pour toute reprise qu'il
    planifie.

    C'est le correctif du constat Codex 4.1, et il vaut mieux que ce que le round 3 avait produit :
    porter l'état du limiteur par le seul verdict de `startExtraction` le rendait **invisible après un
    rechargement de l'écran**, la file s'affichant « à l'arrêt » alors qu'une reprise était programmée
    — précisément le critère « visible sans action de ta part » que T10 existe pour tenir. Une échéance
    stockée est un fait, pas une lecture d'horloge : elle traverse la query sans rien violer, et le
    client la compare à son horloge calée.

16. **`query queueStatus({ adminToken })`** dans `convex/admin.ts` — **sans horloge et sans argument
    de temps**, donc pleinement cachable et réactive :
    - comptes par statut sur l'index `by_status`, en **lectures bornées** `.take(CAP + 1)` avec un
      booléen `truncated`, sur l'idiome `draftsTruncated` déjà en place dans `listScans`. C'est le
      correctif du constat Codex 3.5 : les guidelines (`:331`) interdisent `.collect().length`, et
      `failed` n'est borné par rien ;
    - `oldestPendingAt` ; pour le bail en cours, son `startedAt` et son `attempts` ;
    - **le `nextAttemptAt` le plus proche** parmi les scans en attente, du point 15 ;
    - le nombre de scans au plafond de tentatives, compté à part.

    Query dédiée et non dérivée de `listScans` : `listScans` prend 100 scans par création
    décroissante, donc des compteurs dérivés de là sous-comptent silencieusement dès le 101ᵉ scan, et
    c'est la query chère (une lecture de brouillons par scan).

17. **`startExtraction` rend un verdict, nommé pour ce qu'il est** — retour discriminé
    `{ status: 'scheduled' | 'already_running' | 'no_work' | 'rate_limited', retryAt? }`.

    **`scheduled` et non `started`** (constats Codex 1.3 et 1.4) : la mutation planifie `drain` et
    rend la main avant qu'il tourne, donc elle ne peut pas affirmer qu'une extraction a démarré. Ce
    n'est pas une course dangereuse — `reserve` est le point d'exclusion atomique et un second `drain`
    sortira en `lease_held` — mais c'était un verdict mensonger. On n'ajoute **pas** d'état durable
    `scheduled/running` : il dupliquerait à un second endroit ce que `reserve` fait déjà atomiquement.

    **Le verdict rend une échéance absolue, jamais un délai relatif** (constats Codex 1.4 et 3.7) :
    `rateLimiter.check` reste une lecture d'horloge, interdite en query, et un `retryAfter` relatif se
    périmerait sur place dans une souscription qui ne se rejoue pas par passage du temps. Ici la
    mutation dispose légalement de `Date.now()` et rend `retryAt`. Ce verdict est le chemin **rapide**
    — on apprend qu'on est limité à l'instant où on appuie ; la trace durable du point 15 est le
    chemin **fiable**, celui qui survit à un rechargement. Le `scheduler.runAfter(0, drain)` n'est
    posé que dans le cas `scheduled`.

18. **`src/routes/admin.tsx`** — le fichier **reste plat** (le passage à `src/routes/admin/route.tsx`
    est un changement de routage TanStack avec des conséquences de layout ; le décider sans les
    besoins réels de l'écran de correction serait deviner — c'est à T8). Le bloc de file part dans un
    composant ordinaire, pas une route, que T8 déplacera où il voudra.

    - **Une horloge locale, calée sur le serveur.** Les queries Convex se rejouent sur **écriture** ;
      un bail devient périmé par le seul passage du temps. Une souscription ne se rejoue donc pas au
      franchissement du seuil, et un scan bloqué resterait affiché « en cours » indéfiniment — ce qui
      tue le critère « visible sans action de ta part ». Un `setInterval` de 15 s fait avancer un
      `now` d'état, corrigé de l'offset du point 14 ; péremption du bail, franchissement de
      `nextAttemptAt` et booléen « file à l'arrêt » se calculent avec. **Le booléen exclut le cas d'un
      `nextAttemptAt` encore à venir** : une file dont la reprise est programmée n'est pas à l'arrêt,
      et l'écran affiche l'échéance au lieu d'inviter à appuyer pour rien.
      **La query expose les faits sans horloge, la mutation rend un verdict daté, le composant tient
      l'horloge.**
    - **Un seul bouton**, libellé dérivé : « Démarrer l'extraction » s'il y a du `pending` sans bail
      vivant, « Relancer la file » si un bail est périmé, désactivé avec « Rien à extraire » si la
      file est vide, désactivé avec le délai restant tant que `nextAttemptAt` ou `retryAt` n'est pas
      franchi. Le remède est le même appel dans les trois premiers cas ; deux boutons feraient croire
      à deux actions.
    - **`attempts`/`MAX_ATTEMPTS` sur chaque ligne de scan**, et les scans au plafond comptés à part.
      Sans ça on appuie sur « Relancer » en boucle sur un scan qui ne repartira jamais — exactement le
      bouton inutile que T10 existe pour supprimer.
    - **Bouton « Purger la photo » par scan**, affiché si `purgedAt === undefined` et si le bail n'est
      pas vivant, derrière un `window.confirm`. Le résultat du point 10 s'affiche, y compris
      `deferred`. Un scan purgé s'affiche comme tel, pour que l'impossibilité de le relancer soit
      lisible.
    - **Anti-slop appliqué** : les compteurs sont des lignes de texte. Pas de tuile, pas de pastille,
      pas de carte, pas d'ombre, pas de pictogramme, rien de centré.

19. **`DESIGN.md`** — une phrase : les interdits du système de design s'appliquent à `/admin`, les
    obligations (Fraunces, échelle fluide, encres de type) non. Sinon T8 et T14 reposeront la
    question.

20. **Tests** — `src/lib/queueStatus.test.ts` sur les fonctions pures, y compris le cas d'un client à
    l'horloge décalée (offset appliqué), le franchissement de `nextAttemptAt` et le fait qu'une file
    dont la reprise est programmée **n'est pas** déclarée à l'arrêt ; `convex/admin.test.ts` étendu sur
    `queueStatus` (refus sans jeton, comptes justes, `truncated` au plafond, `oldestPendingAt`,
    `nextAttemptAt`), sur les quatre verdicts de `startExtraction`, et sur le fait que
    **`reserve` inscrit `nextAttemptAt` quand le limiteur refuse**.
    **Le câblage JSX reste non testé** : il n'y a pas d'infra React et en monter une dans une tâche
    d'une heure est la dérive qui la transforme en quatre. Dit dans la PR, pas maquillé, posé en R8.

21. **Documentation** — cocher T7 et T10 dans le fichier de tâches et dans `docs/SUIVI.md` ;
    **réécrire R4** en y versant tout le fil « propriété du blob » (voir décision nº7) ; ajouter
    **R7 — pas de remise à zéro d'un scan mort** et **R8 — le câblage de l'écran d'admin n'est
    couvert par aucun test**.

### Commit 3 — activation du cron

22. **`convex/crons.ts`** — `cronJobs()` + **deux entrées `crons.cron` nommées** (constat Codex 3.7 :
    une entrée n'accepte qu'une seule `FunctionReference`, et le plan prétendait qu'une seule en
    appelait deux) :

    - `'purge des photos expirées'` — `'0 4 * * 1'`, lundi 04:00 UTC → `internal.retention.purgeExpired` ;
    - `'balayage des tickets'` — `'30 4 * * 1'` → `internal.extract.sweepTickets`.

    Les helpers `weekly`/`daily`/`hourly` sont interdits par les guidelines du dépôt (`:374`).
    L'appel à `sweepTickets` depuis `drain` sur `no_work` **reste** : l'opération est idempotente et
    `drain` demeure le chemin rapide quand on travaille.

    **Ce fichier est seul dans son commit** (constat Codex 2.5) : la procédure de déploiement exige de
    livrer la rétention _puis_ de vérifier le backfill _avant_ qu'un cron puisse tourner.

### Ordre de déploiement, imposé

1. déployer le **commit 1** — aucun cron n'existe encore ;
2. `auditPurgeAfter` sur l'environnement visé ; lire compte, échéance minimale et `truncated` ;
   vérifier qu'aucune échéance n'est dans le passé ;
3. `backfillPurgeAfter`, puis relancer `auditPurgeAfter` pour confirmer qu'il ne reste rien ;
4. déployer le **commit 3**.

Le `max` du point 3 rend cet ordre survivable même s'il n'est pas respecté — c'est la ceinture, la
procédure est les bretelles.

## Décisions et arbitrages verrouillés

1. **Le déclencheur de la tâche était inatteignable ; on ajoute un plafond absolu.** **Coût assumé** :
   au plafond, une photo peut partir alors que des brouillons sont encore en `review`. D'où 90 jours.
2. **Un cron, en contradiction assumée avec « cron de surveillance de la file : non retenu ».** Ce
   qui a été refusé, c'est un cron qui _surveille la file_ — il remplacerait le jugement de
   l'opérateur. Un cron qui _ramasse les ordures_ ne décide de rien, et c'est la seule option qui
   purge même si on n'ouvre plus jamais `/admin`.
3. **Hebdomadaire, pas quotidien.** Choix de Florian. **La latence du cron s'ajoute à la rétention** :
   libération anticipée effective entre 7 et 14 jours, plafond entre 90 et 97.
4. **`purgeAfter` toujours posé, jamais dans le passé, la libération abaisse, le bail vivant
   reporte.** Contrepartie : impose l'audit, le backfill, la borne `gte(0)`, le `max` de grâce et le
   report.
5. **La libération anticipée n'est branchée sur rien dans cette PR.** Révision de la décision du
   round 1 du grill, sur objection de Codex.
6. **Un seul chemin de suppression de blob, isolé en sous-transaction par scan.** Un garde-fou qui
   n'existe que sur un des deux appelants n'est pas un garde-fou ; et un décompte d'échecs sans
   isolation transactionnelle ne veut rien dire.
7. **Tout le fil « propriété exclusive du blob » sort de cette PR et part en R4.** Trois rounds de
   revue l'ont vu grossir sans converger : index `by_storage_id`, puis conservation perpétuelle des
   tickets `ok` pour leur donner une durée de vie, puis backfill d'appartenance pour les scans dont le
   ticket avait déjà été balayé, puis index séparé pour ne pas affamer le balayage des autres issues.
   Le signal est clair : ce n'est pas bon marché, et ça n'appartient pas à une tâche d'une heure. Le
   risque couvert reste théorique — aucun chemin **accidentel** n'existe (`createScan` est idempotent
   sur un même ticket, et le client emploie toujours un `storageId` fraîchement créé), et les seuls
   autres écrivains de blobs sont gardés par déploiement. Sort avec lui la suppression du blob d'un
   ticket `too_large`, qui reposait dessus. **T14 devra trancher**, quand `recipes.imageStorageId`
   aura un écrivain de production.
8. **La ligne du scan survit à la purge.** Elle porte la télémétrie de T11 et la cible de
   `recipes.scanId`.
9. **L'horloge ne franchit la frontière qu'en échéance absolue, et jamais depuis une query.**
   Interdit par les guidelines du dépôt, et de toute façon faux : une souscription réactive ne se
   rejoue pas par passage du temps. D'où `serverTime` en mutation, `queueStatus` sans horloge, et
   toute attente exprimée en échéance.
10. **Ce qui doit être visible sans action doit être écrit en base.** Un verdict de mutation ne
    survit pas à un rechargement de l'écran : la limitation est donc **stockée** en
    `scans.nextAttemptAt` par `reserve`, et le verdict de `startExtraction` n'en est plus que le
    raccourci immédiat. C'est la leçon générale du constat Codex 4.1, et elle vaut pour tout signal
    que T10 prétend rendre visible.
11. **Un échec de purge doit libérer sa place**, par report avec backoff, sinon un lot en échec
    reprend éternellement les mêmes lignes et bloque tout ce qui est derrière.
12. **Toute lecture de comptage est bornée**, avec un `+ 1` pour distinguer « pile au plafond » de
    « tronqué », sur l'idiome `draftsTruncated` du dépôt.
13. **Le verdict s'appelle `scheduled`, pas `started`.** Aucun état d'exclusion durable ajouté :
    `reserve` reste le seul point atomique. `nextAttemptAt` n'est pas un verrou, c'est une annonce.
14. **Purge manuelle autorisée sur `pending`**, avec transition immédiate en `failed`. Reportée sur
    bail vivant. Pas de garde-fou « brouillons en `review` » tant que R3 n'existe pas.
15. **`admin.tsx` reste plat.** L'éclatement en répertoire appartient à T8.
16. **Pas d'infra de test React dans cette PR.** Le câblage JSX reste non testé, c'est écrit, c'est
    R8.
17. **Pas de remise à zéro d'un scan mort**, mais la mort est rendue lisible.

## Risques et questions encore ouvertes

- **L'ordre des valeurs Convex pour un champ absent dans un index** est le fondement de la borne
  `gte('purgeAfter', 0)`. La conclusion — se protéger dans les deux sens — tient même si l'ordre est
  autre, mais **le test de non-régression du point 12 doit échouer si la borne est retirée**. À
  vérifier en exécution, pas en lecture.
- **Deux scans peuvent en théorie partager un blob** et la purge du premier casserait le second.
  Aucun chemin accidentel connu ; décision nº7, suivi en R4, à trancher en T14.
- **`auditPurgeAfter` plafonne à 1000 lignes.** Au-delà il le dit, mais il ne compte plus juste. La
  vraie garantie reste le `max` du point 3.
- **R5 non levé** : l'effet de `convex/convex.config.ts` sur le déploiement reste à vérifier avant
  T12, et cette PR ajoute un second fichier Convex de premier niveau (`crons.ts`).
- **`releaseIfTreated` est du code sans appelant** jusqu'à T8/R3. Testé, mais mort en production d'ici
  là. C'est le prix de la décision nº5.
- **Le report sur bail vivant peut se répéter** si un bail ne retombe jamais (bug de `drain`). Le
  journal du point 9 le rendrait visible ; rien ne l'alerte activement.
- **Un stockage en panne fait échouer les purges en silence relatif** : chaque échec est reporté d'un
  jour et compté dans les logs, mais aucune alerte n'existe. Cohérent avec le reste du projet, qui n'a
  pas de surveillance. Le report empêche le blocage, il ne signale pas la panne.
- **`nextAttemptAt` est une annonce, pas une garantie.** Si le `scheduler.runAfter` correspondant est
  perdu (redéploiement, renommage de fonction), l'écran affichera une reprise qui ne viendra pas,
  jusqu'à ce qu'on appuie sur le bouton. Le bouton reste donc le remède universel — ce qui est le
  comportement voulu de T10.
- **Le câblage de l'écran n'est pas testé** (R8).

## Hors périmètre

Publication d'un brouillon (R3, à T8) · scan multi-images (T8) · écran de correction (T8) ·
propriété exclusive des blobs, registre d'appartenance et suppression du blob d'un ticket
`too_large` (R4, à trancher en T14) · balayage de `_storage` (R4) · remise à zéro d'un scan au
plafond de tentatives (R7) · éclatement de `src/routes/admin/` en répertoire (T8) · jsdom + RTL et
test de composant du bloc de file (R8) · durcissement de l'appel OpenRouter et journalisation par
tentative (T11) · notification hors navigateur d'un scan bloqué · purge globale en un clic ·
`@convex-dev/aggregate` pour des compteurs exacts non bornés.
