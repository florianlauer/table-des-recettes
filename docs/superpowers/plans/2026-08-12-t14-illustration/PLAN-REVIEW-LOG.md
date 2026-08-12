# Plan Review Log: T14 — photo du plat, embellissement, arbitrage

Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.

Trois tours de questions, quinze décisions arrêtées. Deux d'entre elles ont déplacé le plan par
rapport à la recommandation initiale :

- **Q1** — la réponse n'était pas un choix mais une exigence (« scanner en lot sur l'ordi, repasser
  sur mobile plus tard »), qui a disqualifié l'écran de correction comme point d'entrée et fait
  naître la liste de travail `/admin/illustrations`.
- **Q8** — la réponse initiale (« focus sur le plat, pas le texte ») contredisait la mesure centrale
  de T13. Distinguer _d'où vient la photo_ de _comment elle est cadrée_ a réconcilié la contrainte
  réelle de l'utilisateur avec ce qui fait fonctionner le modèle.

## Round 1 — Codex

Problèmes matériels :

1. `beautifyAttempts` réutilise `attemptFields`, mais les erreurs T13 sont `truncation`/`no_image`, absentes de `FAILURE_KINDS` (`truncated` existe) : l’écriture échouera au runtime ([PLAN.md:46](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:46), [failureKinds.ts:3](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/src/lib/failureKinds.ts:3), [openrouter.ts:35](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/spike13/openrouter.ts:35)).
   Fix: définir une taxonomie Convex explicite pour l’embellissement ou une conversion exhaustive vers `FAILURE_KINDS`, testée pour chaque résultat T13.

2. `summarizeAttempts` ne peut pas être réutilisé « tel quel » : il exige `schemaVersion`, absent de `beautifyAttempts`, et ne calcule pas le taux d’acceptation humaine ([PLAN.md:118](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:118), [attemptStats.ts:17](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/src/lib/attemptStats.ts:17)).
   Fix: créer un agrégateur `summarizeBeautifyAttempts` avec identité `{model,promptVersion}` et métriques acceptation/rejet/échec.

3. Aucune clé efficace ne relie l’arbitrage à sa tentative : la table n’a que `by_created_at`, alors qu’acceptation et rejet doivent retrouver « la ligne correspondante » ([PLAN.md:46](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:46), [PLAN.md:93](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:93)).
   Fix: ajouter un index unique logique `by_attempt_id`, conserver l’`attemptId` actif jusqu’à l’arbitrage et tester l’absence/doublon.

4. Les tickets ne portent pas leur `purpose`; un ticket obtenu via le seau `scanCreation` pourra donc être consommé par `attachIllustration`, contournant les quotas séparés ([PLAN.md:58](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:58), [schema.ts:111](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/convex/schema.ts:111)).
   Fix: stocker `purpose` dans `uploadTickets` et faire refuser atomiquement toute consommation par un endpoint d’un autre usage.

5. Course critique : une originale peut être remplacée ou détachée pendant `render`; le résultat produit depuis l’ancienne image sera ensuite attaché à la nouvelle recette puisque `finalizeBeautify` ne compare que l’`attemptId`.
   Fix: enregistrer `sourceStorageId` dans la tentative et exiger `(attemptId, sourceStorageId, status)` au finalize, tout remplacement invalidant explicitement la tentative.

6. Le candidat est stocké avant `finalizeBeautify`; si le finalize est périmé ou rejette, le nouveau blob devient orphelin ([PLAN.md:82](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:82), [PLAN.md:86](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:86)).
   Fix: faire retourner un résultat structuré au finalize et supprimer systématiquement le blob nouvellement stocké lorsqu’il n’est pas adopté.

7. Conserver l’ancienne originale d’un embellissement accepté sans enregistrer sa référence produit volontairement un blob sans propriétaire après remplacement ([PLAN.md:66](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:66)).
   Fix: ajouter `beautifiedSourceStorageId` comme propriété durable, ou interdire le remplacement tant que l’embellissement accepté n’a pas été rejeté.

8. « Débit d’un » est faux : une limite de 40/h n’empêche pas 40 actions simultanées sur 40 recettes; l’interface ne constitue pas un verrou distribué.
   Fix: utiliser un workpool à concurrence bornée ou un lease global transactionnel avec expiration.

9. Le plan retire `BudgetCounter` mais présente 40 × coût moyen comme plafond : le rate limit borne les appels, pas les dollars, et le prix/coût réel peut dépasser la mesure T13.
   Fix: ajouter un coût maximal par appel et un coupe-circuit durable fondé sur le coût journalisé, avec alerte si `usage.cost` manque.

10. Une action tuée avant sa mutation d’échec laisse définitivement la recette en `generating`; la surveillance est explicitement hors périmètre ([PLAN.md:89](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:89), [PLAN.md:172](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:172)).
    Fix: stocker `beautifyStartedAt` et prévoir une récupération manuelle ou un lease expirant qui transforme les générations abandonnées en `failed`.

11. La machine d’états est incomplète : `requestBeautify` ne refuse que `generating`, donc elle peut écraser un candidat `review` ou accepté; remplacement et détachement ne définissent pas non plus le sort de toutes les tentatives.
    Fix: documenter et appliquer une matrice de transitions CAS exhaustive pour `idle`, `generating`, `review`, `failed` et `accepted`.

12. La liste requiert « review d’abord, puis sans photo », mais seul `by_image` est prévu; aucun index `beautifyStatus`, plafond ou pagination n’est défini ([PLAN.md:51](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:51), [PLAN.md:106](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:106)).
    Fix: définir les requêtes, indexes et limites exacts — notamment `by_beautify_status` — avec pagination ou bornes de troncature visibles.

13. Le plan laisse `q.eq('imageStorageId', undefined)` comme pari à trancher pendant l’implémentation, alors que ce choix peut imposer une modification de schéma et le maintien transactionnel d’un champ dénormalisé.
    Fix: valider ce comportement avant approbation et figer l’un des deux schémas dans le plan.

14. La preuve omet précisément les chemins dangereux : ticket de mauvais usage/rejoué, concurrence remplacement-finalize, nettoyage après finalize périmé, double arbitrage, génération bloquée, transitions invalides et rafale concurrente ([PLAN.md:123](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:123)).
    Fix: ajouter ces scénarios aux tests Convex, plus un happy path complet upload → génération → acceptation/rejet.

VERDICT: REVISE

### Claude's response

**Accepté (12 sur 14).**

- **1 — taxonomie d'échec.** Vérifié : `FAILURE_KINDS` vaut `refusal, truncated, invalid_json,
invalid_schema, timeout, transport, no_recipes, invalid_image`. `no_image` en est absent,
  `truncation` diffère de `truncated`, et trois membres sont propres à l'extraction. Je ne convertis
  pas vers `FAILURE_KINDS` comme Codex le proposait en premier choix : je pose
  `BEAUTIFY_FAILURE_KINDS`, source unique sur le modèle exact de l'existante, plus une conversion
  testée depuis les `DecodeFailure` du banc.
- **2 — agrégateur.** Vérifié : `attemptSummary` exige bien `schemaVersion`, qui n'existe pas ici, et
  ne mesure aucune acceptation. `summarizeBeautifyAttempts` distinct, identité `{model,
promptVersion}`, métriques acceptés / rejetés / en attente.
- **3 — index d'arbitrage.** `by_attempt_id` ajouté, `beautifyAttemptId` conservé jusqu'à
  l'arbitrage.
- **4 — usage du ticket.** Constat juste et c'est le plus sérieux du lot : deux seaux sans marquage
  du ticket ne sont qu'une décoration. `purpose` porté par le ticket, consommation croisée refusée,
  champ optionnel pour les tickets existants traités comme `scan`.
- **5 — course remplacement/finalisation.** `sourceStorageId` journalisé, exigé au finalize, et tout
  remplacement efface `beautifyAttemptId`.
- **6 — orphelin après finalisation périmée.** Résultat structuré, suppression systématique du blob
  non adopté.
- **7 — originale sans propriétaire.** Je retiens la **seconde** branche du correctif : interdire le
  remplacement tant qu'un embellissement accepté n'a pas été rejeté. Un champ
  `beautifiedSourceStorageId` durable serait plus permissif, mais ajoute un propriétaire de blob à
  suivre là où R4 dit déjà qu'on ne sait pas prouver l'exclusivité.
- **10 — génération abandonnée.** `beautifyStartedAt` plus un abandon manuel au-delà d'un plafond de
  bail. Manuel et non un cron : le projet refuse la surveillance automatique depuis T10.
- **11 — machine d'états.** Matrice complète des transitions écrite dans le plan et testée transition
  par transition. La version précédente pouvait écraser un candidat en attente.
- **12 — requêtes de la liste.** `by_beautify_status` et `by_illustration`, deux requêtes bornées sur
  la convention `take(CAP + 1)` de `listScans`, chacune rapportant sa troncature.
- **13 — le pari sur l'index.** Codex a raison sur la forme : un plan ne parie pas. Les guidelines
  Convex disent « `undefined` is not a valid Convex value ». Je fige donc `hasIllustration`,
  dénormalisé, indexé, maintenu par un point d'écriture unique — même discipline que `searchText`,
  qui est le précédent du dépôt — avec une invariance testée après chaque mutation.
- **14 — preuve.** Les huit scénarios nommés sont ajoutés, plus un chemin nominal complet.

**Rejeté (2 sur 14), avec raison.**

- **8 — workpool ou bail global.** Le constat est juste, la correction est disproportionnée. « Débit
  d'un » décrivait l'usage, pas une garantie : je corrige l'affirmation dans le plan au lieu de
  construire le verrou. L'opérateur est unique et déclenche à la main ; la matrice de transitions
  empêche déjà deux générations sur la même recette. Un verrou distribué pour empêcher un seul
  humain de lancer quarante générations simultanées est de la machinerie pour un débit d'un — la
  raison même pour laquelle ce plan refuse déjà la file.
- **9 — coupe-circuit durable sur le coût.** Accepté à moitié : je prends le plafond de coût par
  appel et le signalement d'un `usage.cost` manquant, qui sont bon marché et attrapent une dérive de
  tarif. Je refuse le coupe-circuit durable : c'est un état persistant de plus, avec sa remise à
  zéro et son écran, là où la limite de débit et l'agrégat visible sur `/admin` sont déjà le mode de
  gouvernance choisi pour l'extraction. Le noter comme reliquat vaut mieux que le construire à
  l'aveugle.

## Round 2 — Codex

La révision corrige la taxonomie, les tickets typés, les indexes, la source CAS, le nettoyage du candidat périmé et les tests. Problèmes restants :

1. `hasIllustration: v.boolean()` est obligatoire sur des recettes existantes, tandis que `beautifyStartedAt` est utilisé sans être ajouté au schéma ([PLAN.md:58](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:58), [PLAN.md:109](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:109)).  
   Fix: prévoir une migration en phases — champs optionnels, backfill de toutes les recettes, indexes staged si nécessaire, puis champs obligatoires — et couvrir tous les producteurs/restores.

2. Le « drapeau explicite » de coût absent n’existe pas dans les champs annoncés de `beautifyAttempts` ([PLAN.md:51](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:51), [PLAN.md:73](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:73)).  
   Fix: ajouter `costReported: v.boolean()` au schéma et l’intégrer aux validateurs, écritures, agrégats et tests.

3. La machine d’état se contredit : la matrice autorise `reject` après acceptation, mais le double arbitrage refuse toute tentative dont `accepted !== null`; `rejectBeautified` supprimerait le blob alors que « dépublier » doit le conserver ([PLAN.md:98](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:98), [PLAN.md:136](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:136)).  
   Fix: séparer `rejectPendingCandidate` de `unpublishAcceptedCandidate` et définir leurs préconditions et effets distincts dans la matrice.

4. Après dépublication, un candidat non affiché reste dans `beautifiedStorageId`, puis `requestBeautify` est autorisé et peut l’écraser sans suppression ([PLAN.md:101](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:101), [PLAN.md:142](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:142)).  
   Fix: refuser une nouvelle génération tant qu’un candidat conservé existe, ou supprimer explicitement l’ancien blob avant de créer la nouvelle tentative.

5. Remplacer ou détacher pendant `generating` efface seulement `beautifyAttemptId`, laissant `beautifyStatus === 'generating'` jusqu’à l’expiration manuelle du bail ([PLAN.md:90](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:90)).  
   Fix: invalider atomiquement la tentative en passant à `failed` ou `idle`, effacer `beautifyStartedAt` et enregistrer une cause d’annulation.

6. Une finalisation périmée doit être journalisée pour conserver son coût, mais `accepted: null` la ferait compter comme « en attente » alors qu’aucun arbitrage n’est possible; ne pas l’insérer sous-estimerait les coûts.  
   Fix: remplacer le booléen nullable par un résultat explicite `pending | accepted | rejected | discarded` et journaliser exactement une fois chaque appel terminé, adopté ou non.

7. Le « plafond de coût par appel » n’est pas un plafond : `usage.cost` n’est vérifié qu’après facturation; les 40 actions concurrentes restent possibles et aucun budget durable ne bloque les suivantes ([PLAN.md:73](/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/t14/PLAN.md:73)).  
   Fix: appeler cela une alerte, ou implémenter avant planification une réservation transactionnelle contre un budget horaire durable avec réconciliation du coût réel.

8. `attachIllustration` ne vérifie que 25 Mo et `decodeImageResponse` accepte tout `data:image/*` sans plafond ni validation d’en-tête; une entrée invalide peut être publiée et une sortie énorme peut épuiser la mémoire de l’action.  
   Fix: valider format, dimensions et taille de l’originale et du candidat avec `sniffImageHeader`, puis supprimer et journaliser toute sortie non conforme avant adoption.

VERDICT: REVISE

### Claude's response

**Accepté (7 sur 8).** Codex acte que le tour 1 a pris : taxonomie, tickets typés, indexes, CAS sur
la source, nettoyage du candidat périmé, tests.

- **1 — migration.** Double omission réelle. `beautifyStartedAt` était utilisé en section C sans
  jamais être déclaré, et un `hasIllustration` obligatoire aurait cassé toutes les recettes
  existantes. Les deux passent en optionnel, avec un backfill unique. J'ajoute ce que Codex ne
  demandait pas : un **compteur de recettes hors index**, affiché tant qu'il n'est pas nul — le
  piège de ce champ n'est pas l'écriture, c'est qu'une recette sans le champ est invisible à
  `q.eq(..., false)` et disparaît silencieusement de la liste de travail.
- **2 — `costReported`.** J'avais décrit le drapeau sans l'ajouter au schéma. Corrigé.
- **3 — contradiction de la machine d'états.** Constat juste et c'est ma faute : j'avais fusionné
  « rejeter » et « dépublier » dans une seule colonne, alors qu'ils n'ont pas le même effet sur le
  blob, et la règle du double arbitrage interdisait ce que la matrice autorisait. Deux mutations
  distinctes, matrice à quatre colonnes.
- **4 — candidat conservé puis écrasé.** Découle de 3. Règle uniforme ajoutée : aucun blob candidat
  ne survit à une nouvelle génération, `requestBeautify` le supprime avant de créer la tentative.
- **5 — annulation incomplète.** N'effacer que `beautifyAttemptId` laissait la recette en
  `generating` sans raison visible. Annulation atomique vers `failed`, cause explicite,
  `beautifyStartedAt` effacé.
- **6 — `outcome` à quatre valeurs.** Le meilleur constat des deux tours. Un booléen nullable
  obligeait à choisir entre sous-estimer la dépense (ne pas journaliser) et gonfler la file d'attente
  (journaliser à `null`). `pending | accepted | rejected | discarded`, une ligne par appel terminé.
- **8 — validation des octets, entrée et sortie.** Juste des deux côtés : le serveur ne doit pas
  faire confiance à la compression client, contournable par un appel direct, et `decodeImageResponse`
  accepte n'importe quel `data:image/*` sans borne. `sniffImageHeader` sur l'originale téléversée,
  plafond d'octets **avant stockage** puis `sniffImageHeader` sur le candidat décodé.

**Rejeté à moitié (1 sur 8), avec raison.**

- **7 — budget durable.** Codex a raison sur le mot et j'accepte cette part : « plafond de coût par
  appel » était un mensonge de conception, puisque le coût n'est connu qu'après facturation. Le plan
  dit maintenant **alerte**, et les Risques disent explicitement que rien ne borne la dépense en
  amont. Je maintiens le refus de la réservation transactionnelle contre un budget horaire durable,
  pour la même raison qu'au tour 1 : c'est un état persistant de plus, avec sa remise à zéro, son
  écran et son seuil — un seuil qu'aucune mesure ne fixe aujourd'hui. Nommer le trou dans les Risques
  vaut mieux que le boucher au jugé.

## Round 3 — Codex

Les objections précédentes sont largement corrigées. Problèmes matériels restants :

1. `attachIllustration` est une mutation, mais `ctx.storage.get()` n'est disponible que dans les actions : elle ne peut donc pas lire les octets nécessaires à `sniffImageHeader` (PLAN.md:101).
   Fix: valider le blob dans une action authentifiée, puis appeler une mutation interne qui consomme atomiquement le ticket et attache ou supprime le blob.

2. La matrice autorise `rejectPending` sur un candidat conservé après dépublication, mais sa tentative reste `outcome: 'accepted'`; la règle du double arbitrage interdit donc cette opération (PLAN.md:133, PLAN.md:179).
   Fix: ajouter `deleteUnpublishedCandidate`, qui supprime le blob sans modifier l'outcome historique, et réserver `rejectPendingCandidate` à `review/pending`.

3. Le nettoyage d'une finalisation périmée reste exposé à un crash entre la mutation qui journalise `discarded` et la suppression effectuée ensuite par l'action (PLAN.md:154).
   Fix: transmettre le `candidateStorageId` à `finalizeBeautify` et faire supprimer le blob par cette même mutation transactionnelle lorsqu'elle refuse l'adoption.

4. « Exactement une ligne par appel terminé » n'est pas garanti : un retry de finalisation ou d'échec peut insérer plusieurs lignes ayant le même `attemptId`; l'index ne crée aucune contrainte unique (PLAN.md:56, PLAN.md:63).
   Fix: dans chaque mutation de journalisation, lire `by_attempt_id` et rendre l'insertion idempotente dans la même transaction, avec test de replay.

5. Le backfill « unique sur tout le corpus » peut dépasser les limites transactionnelles Convex, et le compteur `total - true - false` implique lui-même un comptage non borné sans agrégat (PLAN.md:74, PLAN.md:192).
   Fix: backfiller par lots avec continuation planifiée et exposer un état de migration durable, au lieu de recompter toute la table à chaque requête.

6. Le plafond appliqué après décodage base64 arrive trop tard : `response.text()`, `JSON.parse()` et le décodage peuvent déjà épuiser la mémoire sur une réponse énorme (PLAN.md:159).
   Fix: borner le corps HTTP pendant sa lecture, vérifier la longueur encodée avant décodage, puis valider la taille réelle et l'en-tête.

7. `failureKind` n'est pas explicitement nullable alors qu'une tentative réussie en `pending` n'a aucun échec, et l'outcome des échecs techniques n'est pas défini.
   Fix: déclarer `failureKind: union(BEAUTIFY_FAILURE_KINDS, null)` et imposer l'invariant `pending|accepted|rejected ⇒ null`, `discarded technique ⇒ non-null`, testé exhaustivement.

VERDICT: REVISE

### Claude's response

Sept constats, **sept acceptés**. Aucun rejet ce round — c'est le premier où Codex ne trouve que du
vérifiable, et le n°1 est une vraie erreur d'architecture de ma part.

**1 — accepté, après vérification dans le dépôt.** `ctx.storage.get` n'apparaît qu'une fois,
`convex/extract.ts:648`, à l'intérieur de `drain`, une `internalAction`. `ctx.storage.delete`
apparaît en mutation (`convex/admin.ts:146` et `:247`, `convex/retention.ts:153`). Codex a raison
sur les deux moitiés : lire les octets impose une action, supprimer un blob n'en impose pas. La
section B est refondue en action publique (lecture + `sniffImageHeader`) suivie de
`internal.illustrations.commitIllustration`, la consommation du ticket restant dans la transaction —
sinon deux actions concurrentes consomment le même ticket.

**2 — accepté.** Ma matrice se contredisait elle-même : j'avais posé la règle du double arbitrage au
point 21 et autorisé `rejectPending` sur un candidat dont l'`outcome` est définitivement `accepted`.
Cinquième colonne, `deleteUnpublishedCandidate`, qui supprime le blob **sans toucher à l'`outcome`
historique** ; `rejectPending` réservé à `review`.

**3 — accepté, et c'est la même leçon que le n°1 vue par l'autre bout.** Puisque `ctx.storage.delete`
marche en mutation, rien ne justifiait de sortir de la transaction pour nettoyer. `finalizeBeautify`
reçoit le `candidateStorageId` et supprime elle-même quand elle refuse l'adoption. La fenêtre de
crash entre « journalisé discarded » et « blob supprimé » disparaît.

**4 — accepté.** J'avais écrit « exactement une ligne par appel terminé » comme si l'index le
garantissait. Il ne garantit rien : Convex n'a pas de contrainte unique. Lecture de `by_attempt_id`
avant insertion, dans la même transaction, et un test de rejeu.

**5 — accepté, et le constat en contient deux.** Le backfill devient une mutation par lot qui se
replanifie, avec une ligne d'état durable. Mais Codex a raison de pointer aussi le compteur : mon
« hors index = total − true − false » était le balayage non borné que le plan interdisait deux
paragraphes plus haut. Remplacé par une lecture de l'état de migration — bandeau « migration en
cours » tant que `done` est faux, et plus rien à compter une fois posé.

**6 — accepté.** Le plafond après décodage protégeait de la mauvaise chose. Trois barrières
ordonnées : corps HTTP abandonné pendant la lecture, longueur base64 vérifiée avant décodage,
`sniffImageHeader` ensuite.

**7 — accepté.** `failureKind` nullable explicite, avec la nuance que Codex n'avait pas : un
`discarded` **non technique** (l'appel a réussi, la finalisation était périmée) garde `failureKind`
nul. L'invariant est donc `pending | accepted | rejected ⇒ null` et `discarded technique ⇒ non-null`,
pas « discarded ⇒ non-null ».

## Round 4 — Codex

Les sept objections précédentes sont corrigées. Deux courses destructrices restent :

1. `commitIllustration` supprime le blob sur tout ticket refusé : lors d'un rejeu ou de deux actions concurrentes, la seconde mutation peut voir le ticket déjà consommé et supprimer l'image que la première vient d'attacher (PLAN.md:130, PLAN.md:135).
   Fix: stocker `recipeId` sur le ticket; un rejeu identique retourne le succès, un rejeu divergent refuse sans supprimer, et seuls les refus d'un ticket encore vierge peuvent supprimer le blob.

2. Un rejeu de `finalizeBeautify` après une première adoption ne satisfait plus `status === 'generating'`; la règle actuelle le traite donc comme refus périmé et supprime `candidateStorageId`, désormais référencé par la recette (PLAN.md:188, PLAN.md:193).
   Fix: avant tout nettoyage, reconnaître le rejeu exact `(attemptId, candidateStorageId)` déjà adopté et retourner `adopted`; ajouter un test vérifiant que deux finalisations ne produisent ni suppression ni changement d'outcome.

VERDICT: REVISE

### Claude's response

Deux constats, **deux acceptés** — et les deux sont des dégâts collatéraux de mes propres
corrections du round 3. En rapatriant la suppression des blobs dans la transaction (constats 3 et 1
du round précédent), j'ai rendu ces mutations idempotentes en écriture mais **destructrices au
rejeu** : la seconde exécution ne reconnaît plus l'état initial, conclut « périmé » et détruit ce que
la première vient d'attacher légitimement. Codex a trouvé la même faille dans les deux mutations que
j'avais touchées. C'est exactement le genre de régression qu'un round de plus est censé attraper.

**1 — accepté, avec la table de vérité explicitée.** Le ticket porte à sa consommation le
`(recipeId, storageId)` effectivement attaché, et la mutation distingue quatre cas au lieu de deux :
ticket vierge valide (attaché), ticket vierge refusé (**supprimé** — le blob n'appartient à
personne), rejeu exact (**succès**, rien touché), rejeu divergent (refus, **blob conservé**). Seul un
ticket encore vierge autorise une suppression. J'ajoute la nuance que le fix de Codex laissait
implicite : l'action, elle, supprime sans réserve quand sa **propre** validation échoue, puisqu'à ce
moment-là aucun ticket n'a été consommé.

**2 — accepté.** La reconnaissance du rejeu `(attemptId, candidateStorageId)` devient le **premier**
test de `finalizeBeautify`, avant les trois gardes de fraîcheur, et retourne `adopted` sans écrire
ni supprimer.

Les deux se rangent sous une seule règle, ajoutée aux décisions : **l'idempotence précède la
destruction**. Un nettoyage transactionnel est une arme braquée sur le rejeu tant qu'on n'a pas
défini ce qu'« état déjà traité » veut dire. Deux tests le fixent, un par mutation, plus la variante
divergente.

## Round 5 — Codex

Les deux courses destructrices sont corrigées, avec idempotence vérifiée avant toute suppression. Aucun nouveau problème matériel ne bloque l'implémentation; les risques résiduels sont explicitement bornés et assumés.

VERDICT: APPROVED

---

Convergé au round 5 sur 5. **31 constats** sur quatre rounds de critique (14 · 8 · 7 · 2),
**28 acceptés**, **3 rejetés avec motif** — dont le workpool durable et le disjoncteur de coût
transactionnel, machinerie disproportionnée pour un opérateur unique agissant à la main.
Aucune ligne de code écrite pendant les deux actes.
