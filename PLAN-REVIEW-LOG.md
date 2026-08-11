# Plan Review Log : T7 rétention + T10 surface de file

Act 1 (grill) terminé — plan verrouillé avec Florian en deux rounds de questions (9 puis 10),
frontière vidée. `MAX_ROUNDS=5`. Reviewer : `gpt-5.6-sol` (effort `medium`), codex-cli 0.144.5,
sandbox `read-only`. Thread Codex : `019fed66-c7ee-7213-ae73-fbd7c81e0f6e`.

Ce que l'Act 1 a changé par rapport à la tâche telle qu'écrite :

- Le déclencheur spécifié (`purgeAfter` posé quand plus aucune recette du scan n'est en `review`)
  s'est révélé **inatteignable** : rien n'écrit `published` (R3). Plafond absolu ajouté.
- « Remplacer la suppression immédiate » s'est révélé faux : **aucune suppression n'existait**.
- Un cron a été retenu, en contradiction explicite avec la ligne « cron de surveillance de la
  file : non retenu » de la spec — distinction faite entre surveiller et ramasser les ordures.
- Le piège de l'ordre d'index sur un champ absent (`lt(purgeAfter, now)` ramasse les lignes non
  posées) a été identifié avant écriture.
- Le piège de la souscription réactive qui ne se rejoue pas au passage d'un seuil temporel
  (bail périmé) a été identifié : horloge locale côté composant.

---

## Round 1 — Codex

Problèmes matériels :

1. **Suppression sans propriété exclusive du blob.** `createScan` accepte un `storageId` arbitraire
   pour chaque ticket ; deux scans peuvent donc référencer le même blob, puis la purge du premier
   casse le second (`convex/admin.ts:55`, `PLAN.md:87`).
   **Correctif —** Ajouter une table/index d'appartenance unique des blobs ou vérifier tous leurs
   propriétaires avant chaque suppression.

2. **Le blob `too_large` n'est pas "certainement orphelin".** Un ticket frais peut désigner un blob
   existant déjà référencé par un ancien scan ou une recette ; `sweepTickets` le supprimerait
   aveuglément (`PLAN.md:134`).
   **Correctif —** Ne supprimer aucun blob de ticket sans contrôle d'appartenance couvrant `scans` et
   `recipes`.

3. **`startExtraction` conserve la course qu'il prétend résoudre.** Deux mutations concurrentes
   peuvent lire la même file sans bail, planifier deux drains et répondre toutes deux `started` ; un
   drain planifié mais pas encore exécuté n'existe dans aucun état durable (`convex/admin.ts:120`,
   `PLAN.md:158`).
   **Correctif —** Réserver le travail ou créer un état durable `scheduled/running` atomiquement dans
   `startExtraction`, puis transmettre la réservation à l'action.

4. **`rate_limited` reste invisible et `started` reste mensonger.** Le drain peut sortir immédiatement
   sur la limite sans modifier les compteurs ; contrairement au plan, aucun compteur ne permet de
   distinguer ce cas (`convex/extract.ts:338`, `PLAN.md:162`).
   **Correctif —** Persister et exposer `rate_limited/retryAfter`, ou renommer le verdict en
   `scheduled` sans prétendre que l'extraction a démarré.

5. **La purge manuelle peut détruire un scan actif ou non relu.** Le serveur ne vérifie ni `status`,
   ni bail vivant, ni recette en `review` ; `window.confirm` n'est pas une règle d'intégrité
   (`PLAN.md:110`).
   **Correctif —** Refuser côté mutation toute purge d'un scan `pending`/`extracting` ou possédant
   encore des brouillons `review`.

6. **Le backfill peut purger immédiatement toutes les photos historiques.** `createdAt + 90 jours`
   place les anciens scans directement dans le passé, tandis que le plan ne prévoit ni dry-run, ni
   délai de grâce, ni cible `--prod`, et le cron arrive dans le même déploiement (`PLAN.md:67`,
   `PLAN.md:250`).
   **Correctif —** Faire un déploiement en deux phases avec dry-run compté, backfill explicite par
   environnement et `purgeAfter = max(createdAt + 90j, now + délaiDeGrâce)`.

7. **L'expiration du bail dépend de l'horloge du navigateur.** Comparer un `startedAt` serveur à
   `Date.now()` rend l'état faux sur un poste décalé, précisément sur la détection critique de file
   bloquée (`PLAN.md:169`).
   **Correctif —** Refetch périodiquement un verdict calculé avec l'heure serveur, ou renvoyer
   `serverNow` et maintenir un offset client.

8. **La rétention courte des échecs repose sur une conclusion injustifiée.** "Aucune recette en
   review" est vrai par vacuité après un échec terminal, mais la photo reste nécessaire pour
   diagnostiquer un faux `invalid_image`, corriger ou récupérer manuellement le scan (`PLAN.md:73`).
   **Correctif —** Ne raccourcir la rétention qu'après une action explicite
   d'acquittement/publication, jamais automatiquement sur `recordFailure`.

9. **La surface T10 livrée n'est pas testée.** Les tests purs ne couvrent ni le câblage de
   l'intervalle, ni les états du bouton, ni l'affichage du verdict ou de la purge (`PLAN.md:195`).
   **Correctif —** Ajouter au minimum un test de composant ou E2E couvrant file vide, bail vivant,
   bail expiré, limitation et scan purgé.

10. **La purge destructive n'a aucune observabilité opérationnelle.** Les nombres retournés par les
    mutations planifiées ne constituent ni journal d'audit, ni alerte sur les échecs ou boucles de
    lots.
    **Correctif —** Émettre des logs structurés par exécution avec nombre examiné/purgé/échoué,
    identifiant de lot et résumé de fin de backfill.

VERDICT: REVISE

### Réponse de Claude — 6 acceptés, 3 partiels, 1 rejeté

**nº6 — accepté en entier, et c'est le meilleur constat du lot.** Un scan de plus de 90 jours
recevait du backfill une échéance *déjà passée* et partait au premier cron, sans grâce. Correctif
adopté au-delà de la suggestion : une fonction pure unique `ceilingFor()` avec
`max(createdAt + plafond, now + PURGE_GRACE_MS)` — 14 jours — par laquelle passent les **deux**
écrivains, plus le `dryRun` compté et un ordre de déploiement en deux phases écrit dans le plan.
Le `max` est la ceinture, la procédure les bretelles.

**nº1 — accepté, correctif réduit.** Le trou est réel : rien n'empêche deux tickets de revendiquer le
même `storageId`. Refusé en revanche la table d'appartenance dédiée — `uploadTickets` **est** déjà ce
registre, il lui manquait un index `by_storage_id`. `createScan` refuse désormais un `storageId`
déjà revendiqué par un ticket en `outcome: 'ok'`.

**nº7 — accepté.** Comparer un `startedAt` serveur au `Date.now()` du navigateur rend faux le signal
même que T10 existe pour produire. `queueStatus` renvoie `serverNow`, le client maintient un offset.

**nº10 — accepté.** La purge est la seule opération irréversible du système : `console.log` structuré
par passage (lot, examiné, purgé, blobs en échec, réenchaînement) et résumé de fin de backfill.

**nº8 — accepté, et ça renverse une décision que le grill avait actée.** Codex a raison sur le fond :
brancher `releaseIfTreated` sur `recordFailure` en faisait le seul déclencheur actif de la PR, donc
raccourcissait la rétention exactement des photos dont on a besoin pour diagnostiquer un
`invalid_image` douteux — l'inverse du but de T7. L'appelant est retiré ; le helper reste écrit et
testé pour T8/R3. **À faire valider par Florian : cela revient sur sa réponse au Q11 du round 2.**

**nº4 — accepté, avec un correctif meilleur que les deux proposés.** Le trou est réel et pire que
décrit : `drain` se replanifie sur `rate_limited` sans laisser aucune trace en base, donc le booléen
« file à l'arrêt » aurait affirmé le contraire de la vérité pendant toute l'attente. Ni persistance
d'état ni renommage seul : `@convex-dev/rate-limiter` expose `check(ctx: RunQueryCtx, name)`
**non consommant** (vérifié dans `dist/client/index.d.ts:65`), donc `queueStatus` lit l'état du
limiteur depuis une query, sans dépenser de jeton. Le booléen exclut le cas limité et l'écran
affiche le `retryAfter`.

**nº3 — accepté en partie.** Le renommage `started` → `scheduled` est pris : la mutation rend la main
avant que `drain` tourne, elle ne pouvait pas affirmer qu'une extraction avait démarré. Refusé l'état
durable `scheduled/running` et le passage de la réservation à l'action : ce n'est pas une course
dangereuse — `reserve` est le point d'exclusion atomique et le second `drain` sort en `lease_held` —
et l'ajouter dupliquerait cette exclusion à un deuxième endroit, ce qui crée le vrai risque de
divergence. Le défaut était un verdict mensonger, il coûtait un mot.

**nº5 — accepté en partie.** Le garde-fou « bail vivant » est pris côté mutation : supprimer le blob
sous une action en cours de lecture produit un `'Image stockée introuvable'` incompréhensible.
Refusé le garde-fou « brouillons encore en `review` » : puisque rien n'écrit `published`, il
interdirait la purge manuelle de *tout* scan ayant produit des recettes, c'est-à-dire de tous les
scans réussis — il viderait la fonctionnalité que la tâche demande. À reconsidérer après R3, noté
dans le plan.

**nº2 — accepté par assurance, mais le raisonnement est rejeté.** L'objection ne tient pas : la
taille est une propriété **déterministe du blob**, donc un blob refusé pour dépassement sera refusé à
l'identique par tout `createScan` ultérieur et ne peut jamais devenir la photo d'un scan ; et les
`recipes.*StorageId` ne passent pas par les tickets. Le garde-fou est quand même ajouté (lecture de
`by_storage_id` avant suppression), parce qu'il coûte une lecture et que se tromper détruit une photo
sans recours — pas parce que l'argument est juste.

**nº9 — rejeté, raison consignée.** Monter jsdom + RTL est une décision prise explicitement au Q18 du
grill, avec son coût énoncé : dans une tâche d'une heure c'est la dérive qui la transforme en quatre.
Le plan resserre plutôt la frontière — la sélection du libellé et le calcul de l'offset d'horloge
sortent en fonctions pures testées — de sorte que ce qui reste non couvert est le seul câblage JSX.
Non maquillé, et posé en reliquat R8.

---

## Round 2 — Codex

Les corrections sur `scheduled`, `rate_limited`, l'horloge serveur, le délai de grâce, la rétention
des échecs et les logs sont prises en compte. Problèmes matériels restants :

1. **`uploadTickets` ne peut pas servir de registre d'appartenance durable.** Les tickets consommés
   sont supprimés après 7 jours (`convex/extract.ts:32`), après quoi `by_storage_id` autorise de
   nouveau le partage d'un blob encore utilisé par un scan.
   **Correctif —** Créer une table durable `scanImages(storageId, scanId)` avec index unique logique,
   indépendante du balayage des tickets.

2. **Le registre proposé ignore les propriétaires `recipes`.** `devImages.attach` écrit déjà
   `recipes.imageStorageId`, contrairement à l'affirmation que rien ne l'écrit avant T14
   (`convex/devImages.ts:43`) ; un `createScan` peut accepter ce même ID puis le purger.
   **Correctif —** Vérifier tous les propriétaires actuels avant rattachement/suppression, ou imposer
   une table d'appartenance commune à tous les blobs.

3. **La purge automatique ignore les baux vivants.** Le garde-fou n'existe que pour
   `purgeScanImages` ; `purgeExpired` peut supprimer le blob d'une extraction active ayant franchi son
   plafond (`PLAN.md:118`).
   **Correctif —** Centraliser la purge dans un helper qui reporte `purgeAfter` lorsqu'un bail est
   vivant, quel que soit l'appelant.

4. **Le `dryRun` du backfill boucle indéfiniment.** Comme il ne modifie aucune ligne, chaque
   réenchaînement relit les mêmes 100 documents sans `purgeAfter` (`PLAN.md:97`).
   **Correctif —** Paginer le dry-run avec un curseur transmis au lot suivant et accumuler
   compte/minimum dans les arguments ou un document de job.

5. **L'ordre de déploiement n'est pas représentable par les commits annoncés.** `crons.ts` appartient
   au commit T7, mais la procédure exige de déployer ce commit sans ce fichier puis de le déployer
   après le backfill.
   **Correctif —** Séparer T7 en un commit schéma/backfill puis un commit d'activation du cron, ou
   protéger le cron par un état durable `backfillComplete`.

6. **La purge manuelle reste autorisée sur un scan `pending` ou un bail expiré.** Elle détruit alors
   du travail encore relançable et transforme artificiellement le scan en échec au prochain `reserve`
   (`PLAN.md:148`).
   **Correctif —** Autoriser la purge manuelle uniquement pour les statuts terminaux `done` et
   `failed`, côté serveur comme côté UI.

7. **L'état du rate limiter peut rester périmé.** `rateLimiter.check` est exécuté dans une query
   réactive qui ne se rejoue pas par passage du temps ; le plan ne précise pas que le client doit
   ignorer le résultat `ok: false` après expiration du délai.
   **Correctif —** Renvoyer un `retryAt = serverNow + retryAfter`, dériver localement la limitation
   jusqu'à cette échéance, puis refetcher la query.

8. **Le précédent défaut de test JSX reste explicitement non corrigé.** Les états critiques du bouton
   et le garde-fou d'affichage de purge ne seront vérifiés par aucun test d'intégration
   (`PLAN.md:269`).
   **Correctif —** Ajouter un test minimal de composant couvrant bail vivant, bail expiré, rate limit
   et visibilité du bouton de purge.

VERDICT: REVISE

### Réponse de Claude — 5 acceptés, 2 partiels, 1 rejeté

**nº1 — accepté, et il détruit le correctif que j'avais adopté au round 1.** Exact : `sweepTickets`
supprime les tickets consommés à 7 jours, donc la vérification `by_storage_id` redevenait aveugle
passé ce délai et autorisait à nouveau le partage d'un blob vivant. Refusé en revanche la table
`scanImages` : le défaut était la **durée de vie**, pas la structure. `sweepTickets` cesse de balayer
les tickets en `outcome: 'ok'`, qui deviennent l'enregistrement d'appartenance durable du blob. Trois
lignes au lieu d'une table, et le contrôle du `too_large` du point 12 devient fiable par la même
occasion. Coût noté dans les risques : une table qui ne se vide plus jamais complètement.

**nº2 — la correction factuelle est acceptée, le correctif est rejeté.** Le plan affirmait que rien
n'écrivait `recipes.imageStorageId` avant T14 : **c'était faux**, `devImages.attach` et `seed.ts`
l'écrivent. Corrigé dans l'état de départ. Mais les deux sont gardés par déploiement
(`assertDevDeployment()`, `ALLOW_DESTRUCTIVE_SEED`), donc la production n'est pas exposée ; et le seul
chemin accidentel — reprise réseau du même téléversement — est déjà couvert par l'idempotence de
`createScan` sur un même ticket. Ce qui reste possible est un acte délibéré de l'unique opérateur de
confiance sur son propre déploiement de développement. Indexer `recipes.imageStorageId` et
`beautifiedStorageId` pour ça n'en vaut pas le prix dans une tâche d'une heure. Consigné en R4, à
trancher en T14 quand ces champs auront un écrivain de production.

**nº3 — accepté en entier, c'est le meilleur constat du round.** Le garde-fou du bail vivant
n'existait que sur la purge manuelle ; `purgeExpired` pouvait donc supprimer le blob d'une extraction
en cours de lecture. Correctif adopté tel que suggéré et généralisé : un **unique** helper
`purgeScan(ctx, scan)`, seul chemin de suppression, qui **reporte** `purgeAfter` à
`now + PURGE_DEFERRAL_MS` plutôt que de supprimer quand le bail est vivant. Un lot entièrement
reporté ne se réenchaîne pas, sinon un bail vivant produirait une boucle serrée. Leçon retenue en
décision nº6 : un garde-fou qui n'existe que sur un des deux appelants n'est pas un garde-fou.

**nº4 — accepté.** Vrai bug : le `dryRun` n'écrivant rien, chaque réenchaînement relisait les mêmes
100 lignes, indéfiniment. Correctif plus simple que le curseur proposé : **le `dryRun` ne se
réenchaîne pas du tout**. Il traite un lot, journalise compte, échéance minimale et `hasMore`, et
s'arrête ; on le relance à la main tant que `hasMore`. Le curseur serait de l'infrastructure de job
pour une opération qu'on lance trois fois dans la vie du projet.

**nº5 — accepté.** Vrai : la procédure exigeait de déployer T7 sans `crons.ts` alors que `crons.ts`
était dans le commit T7. Le fichier passe dans un **commit 3** à lui seul, déployé après vérification
du backfill. Refusé l'alternative « état durable `backfillComplete` » : elle ajoute de l'état
permanent pour garder une procédure qu'on exécute une fois par environnement.

**nº6 — accepté en partie.** L'objection réelle est bonne : laisser `reserve` découvrir la purge plus
tard transformait le scan en échec « artificiel » à retardement, sans explication entre-temps. La
mutation passe donc elle-même le scan en `failed` avec `error: 'Photo purgée'`, dans la même
transaction. Refusé en revanche de restreindre aux statuts terminaux : purger un `pending` est le cas
d'usage **le plus utile** de la fonction — « j'ai photographié la mauvaise page, tue-le avant qu'il
coûte un appel modèle ». L'interdire viderait la fonctionnalité de son intérêt principal.

**nº7 — accepté.** Même piège que le bail, et j'aurais dû le voir en écrivant le point sur l'horloge :
`check` dans une query réactive ne se rejoue pas quand la fenêtre du limiteur s'ouvre. La query
renvoie désormais `rateLimitedUntil`, une **échéance absolue** et non un délai relatif ; le client
dérive la limitation jusque-là puis refetche. Généralisé en décision nº9 : tout ce qui expire traverse
la frontière en échéance, jamais en délai.

**nº8 — rejeté pour la seconde fois, raison consignée.** Position inchangée et assumée : monter jsdom
+ RTL est une décision explicite du grill (Q18), avec son coût énoncé — dans une tâche d'une heure
c'est la dérive qui la transforme en quatre. Le plan a resserré la frontière autant qu'il est possible
(offset d'horloge, expiration de limitation, sélection du libellé, tous en fonctions pures testées),
de sorte que ce qui reste non couvert est le seul câblage JSX. C'est un désaccord réel, pas un oubli :
consigné en R8 pour que le prochain qui touche cet écran le prenne en charge.

---

## Round 3 — Codex

Les corrections précédentes sont largement intégrées. Le risque `recipes` hors production et
l'absence de test JSX sont désormais des compromis explicites, pas des oublis. Problèmes matériels
restants :

1. **Le registre durable ne couvre pas les scans existants dont le ticket `ok` a déjà été balayé.**
   Arrêter les suppressions futures ne recrée pas les propriétaires perdus avant le déploiement
   (`PLAN.md:96`).
   **Correctif —** Backfiller un enregistrement d'appartenance pour chaque `scans.imageStorageIds`
   existant, ou utiliser une table `scanImages` dédiée.

2. **Conserver les tickets `ok` affame le balayage des autres issues.** L'index actuel est
   `['consumedAt', 'createdAt']` ; des tickets `ok` anciens conservés rempliront chaque lecture bornée
   avant les `missing_storage`/`too_large` plus récents (`convex/schema.ts:95`).
   **Correctif —** Ajouter un index `by_outcome_consumed_at` et balayer séparément `missing_storage`
   et `too_large`.

3. **Le dry-run manuel répète toujours le même lot.** `hasMore` demande de relancer la commande, mais
   sans curseur chaque appel relit les mêmes 100 lignes non modifiées (`PLAN.md:115`).
   **Correctif —** Accepter un curseur de pagination, retourner `continueCursor`, puis le passer à
   l'appel suivant.

4. **`serverNow` implique une lecture interdite de l'horloge dans une query.** Les guidelines du dépôt
   interdisent explicitement `Date.now()` dans une query (`guidelines.md:330`, `PLAN.md:242`).
   **Correctif —** Caler l'offset via une mutation authentifiée dédiée, puis garder `queueStatus`
   purement réactive et sans horloge.

5. **Les compteurs `queueStatus` violent les règles Convex du dépôt.** Le plan conserve des
   `.collect()` non bornés pour compter, alors que les guidelines imposent un agrégat ou une lecture
   bornée (`guidelines.md:331`).
   **Correctif —** Utiliser `@convex-dev/aggregate`, ou `.take(MAX + 1)` avec compte plafonné et
   indicateur `truncated`.

6. **Le comptage des suppressions de blobs en échec n'a pas de sémantique transactionnelle sûre.**
   Sans `catch`, toute la mutation échoue et aucun résumé n'est produit ; avec `catch` dans le même
   helper, une purge multi-image peut committer partiellement (`PLAN.md:140`).
   **Correctif —** Exécuter chaque scan dans une `internalMutation` imbriquée, capturer l'échec au
   niveau du lot et ne marquer le scan purgé qu'après succès atomique complet.

7. **Le contrat du cron reste ambigu.** Une entrée `crons.cron` accepte une seule `FunctionReference`,
   mais le plan affirme que le cron ciblant `purgeExpired` appelle aussi `sweepTickets`
   (`PLAN.md:321`).
   **Correctif —** Déclarer deux tâches cron nommées ou une fonction orchestratrice explicite appelant
   les deux mutations.

VERDICT: REVISE

### Réponse de Claude — 5 acceptés, 2 acceptés par retrait de périmètre

**nº1 et nº2 — acceptés comme preuve que le sous-périmètre n'est pas bon marché, et le
sous-périmètre est retiré.** Les deux constats sont justes : arrêter le balayage futur ne reconstitue
pas les propriétaires déjà perdus, et conserver les tickets `ok` sur l'index `['consumedAt',
'createdAt']` affame la lecture bornée des autres issues. Mais c'est le troisième round consécutif où
le fil « propriété exclusive du blob » grossit sans converger : index → durée de vie perpétuelle →
backfill d'appartenance → index séparé, et maintenant une table dédiée. Le signal est net.

Décision : **tout le fil sort de la PR et part en R4**, avec la suppression du blob `too_large` qui en
dépendait. Ce qui reste couvert n'a jamais été un chemin accidentel — `createScan` est idempotent sur
un même ticket, le client emploie toujours un `storageId` fraîchement créé, et les autres écrivains de
blobs (`devImages`, `seed`) sont gardés par déploiement. Le risque théorique est consigné dans les
risques et dans R4, à trancher en T14 quand `recipes.imageStorageId` aura un écrivain de production.
Le plan **rétrécit** : plus d'index `by_storage_id`, plus de changement de rétention des tickets, plus
de vérification dans `createScan`.

**nº4 — accepté, et c'était une infraction franche que j'aurais dû voir.** Les guidelines du dépôt
disent littéralement « Do not read the wall clock inside a query […] (`Date.now()` is fine in
mutations and actions) ». Mon `serverNow` renvoyé par `queueStatus` était interdit. Correctif adopté
tel que suggéré : une `mutation serverTime({ adminToken })` appelée une fois au montage cale l'offset,
et `queueStatus` redevient sans horloge, donc pleinement cachable. Conséquence en cascade acceptée :
`rateLimiter.check` sort aussi de la query — c'est une lecture d'horloge, et un `retryAfter` relatif
se périmait sur place dans une souscription. L'état du limiteur est désormais porté par le seul verdict
de `startExtraction`, en échéance absolue `retryAt`, là où `Date.now()` est légal. Cela répond aussi au
nº7 du round 2.

**nº5 — accepté.** `.collect()` pour compter viole `guidelines.md:331` (« Never use `.collect().length`
to count rows »), et j'avais moi-même signalé que `failed` n'était borné par rien tout en gardant le
`collect`. Correctif : `.take(CAP + 1)` avec compte plafonné et booléen `truncated`, sur l'idiome
`draftsTruncated` que `listScans` établit déjà. Refusé `@convex-dev/aggregate` : monter un second
composant Convex pour des compteurs d'admin, avec la maintenance de l'agrégat à chaque écriture, est
disproportionné — et R5 demande justement de ne pas multiplier les composants avant T12.

**nº3 — accepté.** Vrai, mon « pas de réenchaînement, relancer à la main » ne réglait rien : sans
curseur, chaque appel relit les mêmes lignes. Refusé le curseur, adopté plus simple : le mode à blanc
devient `auditPurgeAfter`, **une seule lecture bornée** à `BACKFILL_AUDIT_CAP = 1000` qui journalise
compte, échéance minimale et `truncated`. Exact pour un fonds personnel, honnête au-delà, et un
curseur serait de l'infrastructure de job pour une commande lancée trois fois dans la vie du projet.

**nº6 — accepté, bonne subtilité.** Sans isolation, un `ctx.storage.delete` qui jette annule tout le
lot et n'émet aucun résumé ; avec un `catch` local, un scan peut committer à demi purgé — blobs
partiellement supprimés mais `purgedAt` écrit. Invisible aujourd'hui (`imageStorageIds` est borné à 1)
et garanti par T8. Correctif adopté tel que suggéré : `purgeOneScan` devient une `internalMutation`
appelée en `ctx.runMutation` par scan, et les guidelines (`:99`) garantissent exactement la propriété
requise — les écritures d'un appel imbriqué qui jette sont annulées indépendamment, l'appelant
continue. Un scan est soit entièrement purgé, soit intact. Ajouté aussi : le lot ne se réenchaîne que
si au moins une purge a réussi, sinon un stockage en panne produirait une boucle serrée.

**nº7 — accepté.** Mon plan était sloppy : `crons.cron` prend une seule `FunctionReference`. Deux
entrées nommées désormais, décalées d'une demi-heure. Refusé la fonction orchestratrice : deux entrées
nommées se lisent mieux dans le tableau de bord Convex et échouent indépendamment.

---

## Round 4 — Codex

Les sept objections précédentes sont corrigées ou retirées explicitement du périmètre. Trois problèmes
subsistent :

1. **La limitation automatique redevient invisible sans action utilisateur.** Quand `drain` atteint
   `rate_limited`, il programme une reprise sans trace en base (`convex/extract.ts:517`) ; après
   ouverture/rechargement de l'admin, `queueStatus` affiche donc une file arrêtée jusqu'à ce que
   l'utilisateur clique et découvre `retryAt`, contrairement au critère « visible sans action ».
   **Correctif —** Faire retourner `serverNow` et l'état du limiteur par une mutation authentifiée
   pollée toutes les 15 secondes, ou persister un `nextDrainAt` interrogé par `queueStatus`.

2. **Des échecs permanents peuvent bloquer toutes les purges suivantes.** Si les 100 premières
   échéances échouent, aucune n'est sortie de l'index et `purgeExpired` refuse de se réenchaîner ;
   chaque cron hebdomadaire relira éternellement les mêmes lignes (`PLAN.md:147`).
   **Correctif —** Après chaque sous-transaction échouée, reporter son `purgeAfter` avec un backoff
   dans la transaction appelante afin que le lot suivant puisse avancer.

3. **`auditPurgeAfter.truncated` a un off-by-one.** Avec `.take(BACKFILL_AUDIT_CAP)`, atteindre
   exactement 1000 lignes est indiscernable d'un résultat réellement tronqué (`PLAN.md:95`).
   **Correctif —** Lire `BACKFILL_AUDIT_CAP + 1`, calculer `truncated` sur la ligne supplémentaire,
   puis auditer seulement les 1000 premières.

VERDICT: REVISE

### Réponse de Claude — 3 acceptés

**nº1 — accepté, et il corrige une régression que le round 3 avait introduite.** En sortant l'état du
limiteur de la query (pour respecter l'interdiction de lire l'horloge en query), je l'avais mis dans
le seul verdict de `startExtraction` — donc dans un état qui **ne survit pas à un rechargement**. La
file s'affichait « à l'arrêt » alors qu'une reprise était programmée : exactement le critère de T10
retourné contre lui-même. Des deux correctifs proposés, ni l'un ni l'autre : le polling d'une mutation
toutes les 15 s écrit une transaction par tick pour rien, et `nextDrainAt` en singleton demande une
table nouvelle. Il existe un endroit durable évident que j'avais manqué — **`reserve` construit son
verdict `rate_limited` après avoir choisi le scan** (l'ordre est déjà celui du dépôt : « quota last,
so idle presses cannot exhaust it »), donc il tient la ligne à annoter. Un champ
`scans.nextAttemptAt`, écrit par `reserve` et par `drain`, et lu par `queueStatus` : une échéance
stockée est un **fait**, pas une lecture d'horloge, donc elle traverse la query sans rien violer.
Généralisé en décision nº10 : ce qui doit être visible sans action doit être écrit en base.

**nº2 — accepté.** Vrai, et sérieux : cent échéances en échec ne quittaient jamais la tranche échue,
le lot refusait de se réenchaîner, et chaque cron hebdomadaire aurait relu les mêmes cent lignes en
laissant tout ce qui est derrière elles impurgé — un déni de service permanent sur la purge à partir
d'un seul blob récalcitrant. Correctif adopté tel que suggéré : sur échec, la transaction appelante
reporte le `purgeAfter` de ce scan de `PURGE_FAILURE_BACKOFF_MS` (24 h), ce qui est légal précisément
parce que les écritures de l'appel imbriqué ont été annulées et celles de l'appelant sont intactes
(guidelines `:99`). La condition de réenchaînement devient « au moins une ligne a quitté la tranche
échue », purgée **ou** reportée pour échec ; le report pour bail vivant continue de ne pas
réenchaîner.

**nº3 — accepté, trivial et juste.** Le plan citait lui-même l'idiome `+ 1` pour `queueStatus` et
l'avait oublié pour l'audit. `.take(BACKFILL_AUDIT_CAP + 1)`, `truncated` sur la ligne excédentaire,
audit des 1000 premières.

---

## Round 5 — Codex

Les trois objections précédentes sont corrigées :

- `nextAttemptAt` rend la reprise limitée durable et visible après rechargement.
- Le backoff sort les purges en échec de la tranche et évite le blocage.
- L'audit utilise correctement `CAP + 1`.

Aucun nouveau problème matériel. Les risques restants sont explicitement bornés ou reportés avec
justification. Le plan est suffisamment précis pour être implémenté.

VERDICT: APPROVED

---

## Bilan

Convergé au round 5 sur 5. 28 constats émis, 23 retenus (dont 4 avec un correctif différent de celui
suggéré), 2 rejetés avec raison consignée, 3 traités par retrait de périmètre.

Les six trouvailles qui auraient coûté cher en production :

1. **Le backfill purgeait tout l'historique au premier cron** (1.6) — un scan de plus de 90 jours
   recevait une échéance déjà passée. Corrigé par `ceilingFor` et son `max`.
2. **`purgeExpired` supprimait le blob d'une extraction en cours** (2.3) — le garde-fou du bail vivant
   n'existait que sur la purge manuelle.
3. **Un seul blob récalcitrant bloquait la purge pour toujours** (4.2) — un lot en échec ne quittait
   jamais la tranche échue et se relisait chaque semaine.
4. **`serverNow` en query violait les guidelines du dépôt** (3.4) — et le correctif en cascade a
   révélé (4.1) que porter l'état du limiteur dans un verdict de mutation le rendait invisible après
   rechargement, retournant contre lui-même le critère central de T10.
5. **Le `dryRun` bouclait à l'infini** (2.4, 3.3) — n'écrivant rien, chaque réenchaînement relisait les
   mêmes lignes.
6. **Une purge multi-image pouvait committer à demi** (3.6) — invisible aujourd'hui, garanti par T8.

Et une leçon de périmètre : le fil « propriété exclusive du blob » a été vu grossir sur trois rounds
consécutifs sans converger, ce qui a fini par constituer la preuve qu'il n'appartenait pas à une tâche
d'une heure. Il est parti en R4 avec ce qui en dépendait.

**Point à valider par Florian avant implémentation** : la décision nº5 revient sur sa réponse au Q11
du round 2 du grill — `releaseIfTreated` n'est plus branchée sur `recordFailure`, donc le plafond de
90 jours est le seul mécanisme de rétention actif dans cette PR.
