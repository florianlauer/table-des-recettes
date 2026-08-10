# Journal de revue du plan : ingestion P1

Acte 1 (grill) terminé — plan verrouillé avec Florian le 2026-08-10. `MAX_ROUNDS=5`.

Sept questions posées, sept décisions verrouillées :

1. Pas de dérivation Zod→Convex — tuple unique + test de dérive.
2. `ingredientsInferred` par recette, `.optional()` côté Zod et requis côté modèle, schéma 2, prompt
   v3, rejeu des 7 pages à 0,063 USD.
3. Une pression du bouton vide toute la file par auto-replanification ; `@convex-dev/workpool`
   refusé ; image en data URI comme au spike.
4. Jeton d'admin jamais en variable de build — `sessionStorage` + argument explicite ; plafond dur
   chez OpenRouter + `@convex-dev/rate-limiter` côté application.
5. Le garde-fou de format et la compression sont la même opération ; chiffres du spike à l'identique
   (2000×2000, JPEG 80) ; orientation EXIF avant le canvas ; deux plafonds en octets.
6. Rejeu des 101 fixtures — trois invariants plus une mesure à plancher sur le taux de recalcul.
7. Surface d'administration minimale dans le périmètre, pour que le plan ait un critère d'acceptation
   qui ne soit pas un test unitaire.

## Round 1 — Codex (gpt-5.6-sol, `model_reasoning_effort = medium`, read-only)

1. **La sérialisation annoncée n'existe pas.** Deux clics concurrents peuvent lancer deux actions ;
   chaque réservation atomique prendra un scan différent, donc deux appels OpenRouter seront facturés
   en parallèle malgré l'affirmation « un scan à la fois » (PLAN.md:204).
   Fix : utiliser `@convex-dev/workpool` avec parallélisme 1, ou une mutation de lease globale qui
   refuse toute réservation tant qu'un scan non expiré est `extracting`.
2. **Le rate limiter est cité sans politique exécutable.** Aucun nom de limite, quota, période, burst,
   clé ni emplacement de consommation n'est défini ; son installation ne garantit ni sérialisation ni
   maîtrise des coûts (PLAN.md:182).
   Fix : spécifier la configuration exacte, consommer le quota atomiquement avant la réservation et
   tester dépassement, concurrence et `retryAfter`.
3. **`ingredientsInferred` n'est pas réellement obligatoire.** Le plan reconnaît que `strict: true`
   n'est pas contraignant, mais garde le champ optionnel dans le validateur défensif ; une réponse qui
   l'omet sera donc acceptée (PLAN.md:93, PLAN.md:218).
   Fix : valider les nouvelles réponses avec un schéma v2 où le champ est requis, et réserver un
   parseur v1 distinct au rejeu des anciennes fixtures.
4. **Le nouveau signal est perdu avant la base.** Le plan dit que l'écran de correction aura besoin de
   `ingredientsInferred`, mais ne prévoit ni son passage dans `normalizeExtraction()`, ni son champ
   dans `recipes`, ni son écriture lors de la finalisation (recipe-schema.ts:121, schema.ts:37).
   Fix : ajouter explicitement le champ au type domaine, au schéma Convex, à la mutation de
   finalisation et à la query de correction.
5. **La machine d'états d'échec est incomplète.** Refus, troncature, JSON invalide, timeout et
   exception sont « traités comme des échecs », mais aucune mutation ne définit `extracting → failed`,
   l'écriture de `error`, la poursuite de la file ou le comportement au plafond d'essais.
   Fix : définir une finalisation d'échec clôturée par `attemptId`, toujours poursuivre la file, et
   convertir en `failed` tout scan ayant épuisé ses tentatives.
6. **La reprise par expiration peut doubler la facture.** Un worker lent peut perdre son `attemptId`
   au profit d'un second worker alors que son appel OpenRouter continue ; l'idempotence protège
   uniquement les écritures, pas la dépense.
   Fix : fixer `LEASE_MS > REQUEST_TIMEOUT_MS + marge maximale de retry`, renouveler le lease entre
   retries et tester le chevauchement ancien/nouvel attempt.
7. **L'auto-planification duplique potentiellement les workers.** Chaque action concurrente peut
   programmer sa propre continuation, et le plan ne clôture pas les tâches déjà planifiées.
   Fix : faire porter la continuation par une seule lease de worker ou dédupliquer les exécutions avec
   un document singleton/version de génération.
8. **La frontière d'upload n'est pas conçue complètement.** Le plan ne décrit ni la mutation
   authentifiée générant l'URL d'upload, ni la validation des métadonnées de stockage, ni la
   suppression d'un blob lorsque `createScan` refuse sa taille ou échoue.
   Fix : authentifier `generateUploadUrl`, vérifier côté Convex taille et MIME via les métadonnées,
   puis supprimer immédiatement tout objet rejeté ou orphelin.
9. **Le plafond de 25 Mo ne protège pas d'une bombe de décompression.** `createImageBitmap()` peut
   allouer l'image pleine résolution avant le redimensionnement ; un fichier compact mais gigantesque
   peut tuer l'onglet.
   Fix : imposer une limite de dimensions/pixels avant décodage complet, ou utiliser un décodeur qui
   redimensionne pendant le décodage avec une limite mémoire documentée.
10. **Le test de scaling accepte des résultats numériquement faux.** « Seule la plage numérique
    change » autorise une régression remplaçant `2` par `999`, tandis qu'un plancher choisi après
    mesure peut figer un mauvais comportement (PLAN.md:108).
    Fix : vérifier que la valeur rendue égale précisément
    `formatQuantity(scaleQuantity(quantity, factor, Boolean(unit)))`, avec préfixe et suffixe
    inchangés.
11. **Le rejeu du prompt vérifie surtout la stabilité, pas la justesse.** Deux sorties identiques
    peuvent omettre ou halluciner les mêmes ingrédients ; comparer seulement segmentation et comptes
    ne valide pas la nouvelle règle d'inférence (PLAN.md:124).
    Fix : ajouter des attentes humaines exactes pour la page E et vérifier sur les autres pages
    l'identité des lignes imprimées, pas seulement leur nombre.
12. **L'authentification des continuations est contradictoire.** Le plan exige `adminToken` sur chaque
    action, mais une action auto-planifiée ne devrait ni transporter le secret dans ses arguments
    programmés ni être publique.
    Fix : exposer une mutation/action publique authentifiée qui démarre une `internalAction` sans
    jeton ; toutes les continuations et mutations de worker restent internes.
13. **L'observabilité minimale est insuffisante pour P1.** Reporter toute trace d'appel à T11 laisse
    impossible de distinguer timeout, refus, fournisseur inattendu, validation réparée et coût inconnu
    lors du premier vrai pipeline (PLAN.md:220).
    Fix : stocker dès P1 au minimum `attemptId`, catégorie d'échec, modèle/provider servi, durée et
    usage/coût disponible, sans réponse brute ni secret.

VERDICT: REVISE

### Réponse de Claude — round 1

**Les 13 constats sont acceptés.** Un seul remède diverge.

Le plus grave est le **3**, et il retourne mon propre argument contre moi. J'avais justifié
`ingredientsInferred` en `.optional()` par le fait qu'`enforceStrictObjects()` le rend obligatoire
dans le JSON schema. Mais `spike/RESULTS.md:106` — que le plan cite lui-même — établit que
`strict: true` **n'est pas contraignant** sur OpenRouter : deux providers du même modèle ont rendu
`"6 à 8 personnes"` dans un champ déclaré `number`. Donc un modèle peut omettre le champ, et mon
validateur défensif l'aurait accepté sans rien dire. C'était un échec muet déguisé en optimisation,
dans un projet dont l'ADR 0001 existe précisément pour ça. Remplacé par **deux schémas** : `v2` requis
pour les réponses vivantes, `v1` conservé pour le seul rejeu des fixtures archivées.

Le **4** est le corollaire que j'avais manqué : un signal qui n'atteint pas la base est décoratif. Le
champ traverse maintenant `DomainExtraction`, `convex/schema.ts`, la mutation de finalisation et la
query admin.

Le **1** est un vrai mensonge du plan : « jamais deux appels en parallèle » était faux, deux clics
réservant deux scans distincts. **J'accepte le constat, je refuse le remède `workpool`** — pour la
raison déjà écrite (il suppose l'idempotence au lieu de la fournir, et ne remplacerait que le
déclenchement). Je prends la seconde branche de son propre fix : un **lease global**, la réservation
refusant tant qu'un scan `extracting` non expiré existe. Un balayage de l'index `by_status` suffit,
sans document singleton — ce qui absorbe aussi le **7**, puisqu'un seul worker peut détenir le lease
et donc porter une continuation.

Le **12** est une faille que j'ai créée moi-même à la question 4 : un jeton dans les arguments d'une
tâche planifiée est un secret persisté dans le journal du scheduler. Corrigé — point d'entrée public
authentifié, puis `internalAction`, et plus aucun jeton au-delà de la frontière.

Le **10** est strictement meilleur que mon invariant : `formatQuantity(scaleQuantity(...))` est une
assertion exacte qui n'est pas un instantané. Le **6** transforme mon « délai de grâce arbitraire »
en contrainte calculable. Le **9** m'oblige à admettre que « le décodage *est* le garde-fou » n'était
vrai qu'à moitié : le sniff d'en-tête donne le format, les dimensions et le plafond de pixels avant
tout décodage, et c'est le même code qui produit le refus HEIC nommé. Les **2**, **5**, **8**, **11**
et **13** sont des trous de conception que je remplis sans réserve.

## Round 2 — Codex

Les corrections précédentes sur les schémas versionnés, `ingredientsInferred`, la machine d'états, le
lease, les continuations internes, le test sémantique, le scaling et l'observabilité sont désormais
solides. Il reste des problèmes matériels.

1. **Le nettoyage d'un upload rejeté sera annulé.** `createScan` appelle `ctx.storage.delete()` puis
   lève une exception ; la transaction Convex rollbacke donc les suppressions avec le reste
   (PLAN.md:260).
   Fix : après suppression, retourner un résultat `{ ok: false, error }` sans lever, afin que la
   transaction soit commitée.
2. **Le quota `scanCreation` facture deux tokens par scan.** Il est consommé par `generateUploadUrl`
   puis par `createScan`, donc le quota annoncé de 30 scans/h n'en autorise réellement que 15, et
   seulement 5 par burst (PLAN.md:279).
   Fix : consommer le quota uniquement lors de `generateUploadUrl`, ou doubler explicitement quota et
   burst.
3. **Un refus de quota après upload crée un orphelin.** Puisque `createScan` consomme aussi
   `scanCreation`, il peut être refusé après que le blob a été stocké, sans passer par le nettoyage des
   métadonnées invalides.
   Fix : ne limiter que la génération d'URL ; une URL déjà accordée doit pouvoir être finalisée sans
   nouvelle consommation.
4. **Les workers sans travail épuisent le quota d'extraction.** `reserve` consomme la limite avant de
   vérifier un lease vivant ou l'absence de scan ; les doubles clics et continuations concurrentes
   peuvent brûler 60 unités sans aucun appel utile (PLAN.md:282, PLAN.md:312).
   Fix : vérifier d'abord lease et travail disponible, puis consommer le quota dans la même transaction
   juste avant le changement `pending → extracting`.
5. **La file ne reprend pas après un rate-limit.** `drain` s'arrête sur `rate_limited` ; mémoriser
   `retryAfter` ne vide pas la file et aucun appelant direct ne peut recevoir le résultat d'une action
   planifiée.
   Fix : programmer `internal.extract.drain` avec `runAfter(retryAfter, …)` au lieu d'arrêter
   définitivement la boucle.
6. **La validation serveur du format repose sur un MIME contrôlé par le client.** Un HEIC ou fichier
   arbitraire téléversé avec `Content-Type: image/jpeg` passe `createScan` puis provoque un appel
   OpenRouter invalide et facturé.
   Fix : renifler les octets magiques dans l'action avant tout appel facturé et enregistrer
   `invalid_image` en cas de divergence.
7. **WebP est reconnu sans dimensions exploitables.** L'étage 1 reconnaît WebP, mais ne sait lire les
   dimensions que de JPEG et PNG ; l'étage 2 exige pourtant de connaître l'axe long et le nombre de
   pixels (PLAN.md:200).
   Fix : parser les dimensions `VP8`/`VP8L`/`VP8X`, ou refuser explicitement WebP avant décodage.
8. **Les blobs abandonnés restent une fuite cumulative non bornée.** Le rate-limit borne le débit, pas
   le stockage total ; T7 centré sur `purgeAfter` des scans ne supprimera pas automatiquement les
   objets sans scan (PLAN.md:269).
   Fix : inclure dès P1 un sweep borné des objets `_storage` anciens non référencés, ou créer un ticket
   d'upload expirant avec nettoyage planifié.

VERDICT: REVISE

### Réponse de Claude — round 2

**Les 8 constats sont acceptés, sans divergence de remède cette fois.**

Le **4** est une erreur que j'avais écrite noir sur blanc dans l'ordre des opérations : consommer le
quota *avant* de vérifier qu'il existe du travail transforme un double-clic en gaspillage de 60 unités
pour zéro appel utile. L'ordre correct est lease, puis travail disponible, puis quota, puis bascule —
tout dans la même transaction.

Le **6** est plus grave que sa formulation ne le laisse croite : `contentType` dans les métadonnées
`_storage` est **ce que le client a déclaré au téléversement**, donc ma « vérification serveur du
format » n'en était pas une. Un HEIC étiqueté `image/jpeg` traversait `createScan` et arrivait facturé
chez OpenRouter. Corrigé par un reniflement d'octets magiques **côté serveur, avant l'appel facturé**.
Effet de bord heureux : le sniff devient une fonction pure de `src/lib/`, partagée par le navigateur et
l'action, donc écrite et testée une fois.

Le **1** est une propriété de Convex que je connaissais et n'ai pas appliquée : une mutation est une
transaction, donc lever après `ctx.storage.delete()` annule la suppression avec le reste. Le nettoyage
doit être commité, donc le refus est une **valeur de retour**, pas une exception.

Les **2** et **3** sont le même défaut : consommer le quota deux fois par scan divise le quota réel par
deux **et** ouvre une fenêtre où le refus arrive après le stockage du blob. Une seule consommation, à
la génération d'URL ; une URL accordée doit pouvoir être finalisée.

Le **5** est un cul-de-sac que j'avais rendu invisible en écrivant « enregistre le `retryAfter` » — sans
dire qui le lit. Personne : une action planifiée n'a pas d'appelant. `runAfter(retryAfter, …)`.

Le **7** est tranché par le refus plutôt que par le parseur : la source est un téléphone, le pipeline
se standardise sur JPEG, et reconnaître un format dont on ne sait pas lire les dimensions était une
demi-mesure. Formats acceptés : **JPEG et PNG**, rien d'autre.

Le **8** m'oblige à admettre que « la purge est T7 » était un renvoi vers un propriétaire qui n'existe
pas : T7 porte sur `purgeAfter` des scans, pas sur des objets que plus aucun scan ne référence. Un
sweep borné entre en P1, déclenché en fin de cycle de vidage — le même bouton qui vide la file
réclame les orphelins, sans introduire de cron.

## Round 3 — Codex

Les huit objections précédentes sont corrigées. La nouvelle réclamation des orphelins introduit
toutefois des risques de suppression de données.

1. **`ctx.db.system.get(storageId)` utilise la mauvaise signature Convex.** L'API actuelle exige
   `ctx.db.system.get("_storage", storageId)` (PLAN.md:269, guidelines.md:451).
   Fix : utiliser explicitement `ctx.db.system.get("_storage", storageId)` et traiter le retour `null`.
2. **`sweepOrphans` peut supprimer les images légitimes des recettes.** Il protège seulement les IDs
   référencés par `scans`, alors que `recipes.imageStorageId` et `recipes.beautifiedStorageId`
   référencent aussi `_storage` (PLAN.md:294, schema.ts:50).
   Fix : considérer toutes les tables et tous les champs propriétaires avant suppression, ou utiliser
   une table d'assets centralisant chaque référence.
3. **La recherche « aucun scan ne référence cet ID » n'est pas bornable avec le schéma actuel.**
   `imageStorageIds` est un tableau sans index inversé ; vérifier chaque blob impose de parcourir
   potentiellement tous les scans, malgré la mutation annoncée comme bornée.
   Fix : créer une table `uploadedAssets` indexée par `storageId`, avec état `uploaded | attached`,
   `scanId` optionnel et expiration.
4. **`.take(n)` relira toujours le même préfixe de `_storage`.** Si les premiers objets sont tous
   référencés, les orphelins plus récents ne seront jamais examinés (PLAN.md:293).
   Fix : paginer avec un curseur persistant et replanifier les lots jusqu'à `isDone`.
5. **Le nettoyage d'un lot invalide peut supprimer un blob déjà utilisé.** `createScan` accepte des IDs
   fournis par le client puis supprime « tous les blobs fournis » sans vérifier qu'ils ne sont pas déjà
   attachés à un autre scan (PLAN.md:267).
   Fix : revendiquer atomiquement chaque `storageId` via la table d'assets et ne supprimer que les
   objets encore détenus par l'upload courant.
6. **La cardinalité de `storageIds` reste ouverte alors que P1 ne gère qu'une image.** Un tableau vide
   crée un scan inexploitable ; des doublons ou plusieurs IDs contournent les hypothèses de coût et de
   traitement.
   Fix : imposer exactement un `storageId` unique dans P1, puis élargir explicitement le contrat avec
   T8.

VERDICT: REVISE

### Réponse de Claude — round 3

**1, 5 et 6 acceptés. 2, 3 et 4 sont exacts mais je retire le sweep au lieu de l'agrandir** — et c'est
le premier désaccord de remède de cette revue.

Le **1** est vérifié contre la source : `guidelines.md:451` donne
`ctx.db.system.get("_storage", args.fileId)` avec un retour `FileMetadata | null`. Corrigé, `null`
traité.

Le **5** était une **primitive de suppression offerte à l'appelant** : `createScan` recevait des
`storageId` du client et supprimait « tous les blobs fournis » en cas de refus. Il suffisait de glisser
l'identifiant de la photo d'une recette existante dans un lot par ailleurs invalide pour la faire
supprimer — alors que `tasks.md:167` pose que l'originale « est stockée définitivement et n'est jamais
purgée ». Corrigé par un **ticket d'upload à usage unique** : `generateUploadUrl` insère le ticket,
`createScan` doit le présenter, et le ticket est consommé atomiquement en se liant au `storageId`. Un
appelant ne peut pas fabriquer de ticket, donc un `storageId` présenté avec un ticket vivant est par
construction un blob que ce même appelant vient de téléverser. C'est la seule situation où supprimer
est sûr.

Le **6** est accepté tel quel : **exactement un `storageId`** en P1. `imageStorageIds` reste un tableau
— c'est le contrat de T8 — mais P1 écrit un tableau à un élément et refuse toute autre cardinalité.

**Sur 2, 3 et 4 : les trois constats sont justes et le sweep est indéfendable.** Il aurait supprimé
`recipes.imageStorageId` et `recipes.beautifiedStorageId`, sa recherche d'appartenance n'était pas
bornable faute d'index inversé sur un tableau, et son `.take(n)` sans curseur relisait le même préfixe.
Je ne conteste rien de tout ça.

Mais son remède — la table `uploadedAssets` — ne résout pas le problème qu'il prétend résoudre, et j'ai
trouvé pourquoi en essayant de l'écrire. **L'orphelin qu'on cherche à réclamer est exactement celui
dont le serveur n'apprend jamais le `storageId`** : le navigateur téléverse, puis l'onglet se ferme
avant `createScan`. Aucune table d'assets ne peut contenir une ligne pour un identifiant qui ne lui a
jamais été communiqué. Le seul moyen de retrouver ce blob est d'énumérer `_storage` — précisément
l'opération que les points 2, 3 et 4 démontrent dangereuse et non bornable.

On ne peut donc pas à la fois refuser d'énumérer `_storage` et réclamer les orphelins muets. Il faut
choisir, et j'avais choisi la mauvaise branche au round 2 en acceptant son point 8 sans en mesurer la
conséquence.

**Le sweep sort du plan.** L'arithmétique de la fuite : environ 600 Ko par upload abandonné, ce qui
suppose que l'onglet meure entre deux appels adjacents, pour un seul administrateur domestique. Ce
n'est pas une fuite « non bornée » à l'échelle où ce projet vit — c'est quelques mégaoctets par an
contre un palier gratuit qui en offre mille. YAGNI, que `CLAUDE.md` demande explicitement.

Ce qui reste du sweep, parce que c'est gratuit et sans risque : une purge bornée des **tickets** non
consommés et périmés. Elle est indexée, ne touche que des lignes, et **ne supprime aucun blob**.

La réclamation réelle des blobs orphelins est renvoyée à **T7**, où la machinerie de purge a son
propriétaire légitime, où un curseur persistant sur `_storage` peut être écrit correctement, et où
`recipes.imageStorageId` et `beautifiedStorageId` seront tous deux connus comme propriétaires — ce qui
est la condition pour qu'une énumération soit sûre. Noté dans « Out of scope » avec sa raison, pas tu.

## Round 4 — Codex

La suppression du sweep global est correcte. Le risque résiduel d'orphelins jamais signalés est
désormais explicite, chiffré et acceptable pour P1. Quatre problèmes restent autour du ticket.

1. **Le ticket n'est pas lié à l'URL d'upload ni au `storageId` produit.** Le client reçoit séparément
   `{ uploadUrl, ticketId }`, puis peut présenter n'importe quel `storageId` existant avec ce ticket ;
   l'affirmation « par construction » est fausse (PLAN.md:268, PLAN.md:282).
   Fix : puisque P1 accepte les orphelins, ne jamais supprimer automatiquement un `storageId` fourni par
   le client ; une suppression sûre exigerait un upload médié par le serveur qui appelle lui-même
   `ctx.storage.store()`.
2. **Un ticket refusé pour dépassement reste réutilisable.** Le plan ne consomme le ticket que dans le
   chemin valide, mais le chemin surdimensionné supprime le blob ; un ticket unique devient donc
   potentiellement un oracle de suppression répétable (PLAN.md:272).
   Fix : consommer irréversiblement le ticket lors de toute tentative terminale de `createScan`, succès
   ou refus.
3. **`createScan` n'est pas idempotent après perte de réponse réseau.** Le scan peut être créé et le
   ticket consommé, puis un retry client reçoit seulement « déjà consommé » alors que `scanId` est
   stocké précisément pour permettre la récupération.
   Fix : si le ticket consommé porte le même `storageId`, retourner son `scanId` ; refuser uniquement un
   `storageId` différent.
4. **`invalid_image` est retraité comme une erreur transitoire.** La machine générique remet toute
   erreur sous le plafond en `pending` ; le même fichier invalide sera donc reniflé et réservé plusieurs
   fois sans possibilité de réussir (PLAN.md:394, PLAN.md:402).
   Fix : classer les erreurs en retryables et terminales ; `invalid_image` passe directement à `failed`.

VERDICT: REVISE

### Réponse de Claude — round 4

**Les 4 sont acceptés.**

Le **1** tue une affirmation que j'avais écrite en toutes lettres. `ctx.storage.generateUploadUrl()` ne
rend rien qui corrèle l'URL délivrée au `storageId` que le téléversement produira : le serveur apprend
le `storageId` par la bouche du client. Un ticket prouve donc « cet appelant avait droit à un
téléversement », jamais « ce `storageId` est celui qu'il a téléversé ». Mon « par construction » était
un raisonnement circulaire.

Conséquence prise telle quelle : **P1 ne supprime plus aucun blob.** C'est cohérent avec la position
déjà arrêtée au round 3 — les orphelins sont acceptés et chiffrés — et ça retire le seul chemin de
suppression du plan, donc la seule primitive dangereuse. Le **2** disparaît avec lui : il n'y a plus
d'oracle parce qu'il n'y a plus de suppression.

**Le ticket reste, avec une raison d'être honnête.** Il ne prouve rien sur la provenance d'un blob. Il
fait deux choses réelles : il lie une création de scan à une consommation de quota `scanCreation`, et il
sert de **jeton d'idempotence** — ce qui est exactement ce que le **3** réclame. Sa description dans le
plan est réécrite pour dire ça, plutôt que de prétendre à une garantie qu'il n'apporte pas. Un ticket
gardé pour une fonction qu'il ne remplit pas serait pire que pas de ticket.

Le **3** est accepté tel quel : ticket consommé portant le **même** `storageId` → on rend son `scanId` ;
seul un `storageId` différent est refusé. Et le ticket est consommé sur **toute** issue terminale, refus
compris.

Le **4** est le meilleur de ce round. `invalid_image` ne peut pas réussir à la reprise : les octets sont
les mêmes. Ma machine d'états générique aurait renifflé et réservé le même fichier jusqu'au plafond
d'`attempts`, en tenant le lease à chaque fois. La règle de classement est maintenant écrite :
**une catégorie est terminale si et seulement si une reprise sur des octets identiques ne peut pas
changer l'issue.** `invalid_image` est la seule qui la satisfait — le spike a montré que quatre modèles
sur huit rendent une extraction différente à chaque appel, donc tout ce qui vient du modèle est
retryable.

## Round 5 — Codex

Les objections matérielles précédentes sont traitées. Le plan est suffisamment précis et sûr pour
implémentation.

Restent trois corrections non bloquantes :

1. **Le retry d'un ticket consommé après refus n'a pas de `scanId`.** La branche « même `storageId` →
   retourner `scanId` » ne couvre que les succès.
   Fix : stocker `outcome`/`error` sur le ticket et rejouer le même résultat terminal.
2. **Les tickets consommés ne sont jamais purgés.** `sweepTickets` cible uniquement les tickets non
   consommés.
   Fix : supprimer aussi les tickets consommés après une durée d'idempotence suffisante.
3. **Un paragraphe mentionne encore `ctx.storage.delete()` alors que P1 ne supprime plus aucun blob.**
   Cela peut induire l'implémenteur en erreur.
   Fix : remplacer ce paragraphe par la seule règle utile : les refus sont des valeurs afin de conserver
   la consommation terminale du ticket.

Ces points n'affectent ni le chemin nominal, ni la sécurité des données, ni la maîtrise des appels
facturés.

VERDICT: APPROVED

### Réponse de Claude — round 5

**Les trois sont appliquées bien qu'aucune ne bloque**, la 3 en particulier : un paragraphe qui parle de
supprimer un blob dans un plan qui n'en supprime aucun est le genre de résidu qui se retrouve dans le
code.

Le **1** ajoute `outcome` et `error` au ticket : sans eux, seuls les succès étaient rejouables, et une
reprise après un refus recevait « ticket déjà consommé » au lieu du motif du refus. Le **2** ajoute la
seconde branche de purge, avec une fenêtre d'idempotence plus longue que le délai des tickets non
consommés — c'est elle qui borne la durée pendant laquelle une reprise réseau peut encore rejouer son
issue, et sans elle la table croît indéfiniment.

## Convergence

**APPROVED au round 5 sur 5.** 31 objections au total : 13, 8, 6, 4, puis 3 non bloquantes. Un seul
désaccord de remède, au round 3 — diagnostic accepté, table `uploadedAssets` refusée, sweep retiré
plutôt qu'agrandi.
