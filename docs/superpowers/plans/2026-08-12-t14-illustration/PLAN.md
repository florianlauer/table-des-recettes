# Plan: T14 — photo du plat, embellissement, arbitrage

_Locked via grill — by Claude + florianlauer. Révisé après le tour 1 de Codex._

## Goal

Permettre de poser une photo de plat sur une recette **longtemps après** son ingestion, depuis un
téléphone, sans repasser par le scan dont elle vient — puis d'en produire un candidat embelli par
le modèle figé par T13, de le comparer à l'originale et de l'accepter, le rejeter ou le régénérer.
La vitrine n'a rien à apprendre : elle sait déjà rendre les trois cas.

## État de départ vérifié

`main` à `d4c7a1f`. Vérifié dans l'arbre, pas supposé :

- **Les six champs existent déjà** dans `convex/schema.ts:65` — `imageStorageId`,
  `beautifiedStorageId`, `beautifiedAccepted`, `beautifyStatus`
  (`idle | generating | review | failed`), `beautifyAttemptId`, `beautifyError`. Aucune migration.
- **La vitrine est complète.** `convex/recipes.ts:58` appelle `pickDisplayImage`
  (`src/lib/displayImage.ts`), qui tranche déjà candidat accepté → originale → rien.
  `src/routes/index.tsx:182` masque la photo pendant une recherche, `recette.$slug.tsx:137` la pose
  après les ingrédients, pas en ouverture. **T14 n'écrit aucune ligne côté public.**
- **Modèle et prompt figés par T13** : `BEAUTIFY_MODEL = 'google/gemini-2.5-flash-image'`
  (`spike13/models.ts:46`), `PROMPT_VERSION = 'v2'` (`spike13/prompt.ts`). **0,03944 USD**,
  **9,1 s**, mesurés sur 8 cellules.
- **L'appel est écrit et testé** dans `spike13/openrouter.ts` : `modalities: ['image', 'text']`,
  `usage: { include: true }`, décodage depuis `choices[0].message.images[0].image_url.url`.
- **`FAILURE_KINDS` ne convient pas à l'embellissement.** Il vaut `refusal`, `truncated`,
  `invalid_json`, `invalid_schema`, `timeout`, `transport`, `no_recipes`, `invalid_image`
  (`src/lib/failureKinds.ts`). `spike13` produit `refusal | truncation | no_image` : `no_image` est
  absent, `truncation` diffère de `truncated`, et trois membres n'ont aucun sens pour une image.
- **`attemptSummary` exige `schemaVersion`** (`src/lib/attemptStats.ts:30`) et ne mesure aucun taux
  d'acceptation. Il n'est **pas** réutilisable tel quel.
- **`undefined` n'est pas une valeur Convex** (`convex/_generated/ai/guidelines.md:73`). Interroger
  l'absence dans un index n'est pas un pari à tenir dans un plan.
- **`searchText` est le précédent qui gouverne la dénormalisation ici** : champ dérivé, maintenu à
  l'écriture par `withSearchText`, déclaré « the only authorised entry point ».
- `generateUploadUrl` (`convex/admin.ts:39`) consomme le seau `scanCreation` et **les tickets ne
  portent aucun usage** (`convex/schema.ts:111`).

## Approach

### A. Schéma, taxonomie et limites

1. **`BEAUTIFY_FAILURE_KINDS`** dans `src/lib/beautifyFailureKinds.ts`, sur le modèle exact de
   `FAILURE_KINDS` — source unique dont dérivent l'union TypeScript et le validateur :
   `refusal`, `truncated`, `no_image`, `timeout`, `transport`, `invalid_image`. **Ne pas réutiliser
   `FAILURE_KINDS`** : trois de ses membres sont propres à l'extraction et deux des échecs de T13
   n'y figurent pas. Une fonction de conversion depuis les `DecodeFailure` de `spike13`, avec un test
   exhaustif sur les trois cas.
2. **`beautifyAttempts`**, table neuve. Elle **ne peut pas** épandre `attemptFields` tel quel, dont
   le `failureKind` est typé sur la taxonomie d'extraction. Champs : `attemptId`, `model`,
   `servedProvider`, `latencyMs`, `costUsd`, `repairCount` (identiques à `attemptFields`),
   `failureKind` sur la nouvelle taxonomie, `recipeId: v.id('recipes')`, `promptVersion: v.string()`,
   **`sourceStorageId: v.id('_storage')`**, `costReported: v.boolean()`, `createdAt: v.number()`, et
   **`outcome: literalUnion(['pending', 'accepted', 'rejected', 'discarded'])`**. Index
   `by_created_at` **et `by_attempt_id`** — l'arbitrage doit retrouver sa ligne, et `by_created_at`
   ne le permet pas.

   `outcome` n'est **pas** un booléen nullable. Une finalisation périmée doit être journalisée pour
   que son coût soit compté — l'appel a été facturé — mais elle n'est pas « en attente », puisque
   aucun arbitrage n'est possible : elle est `discarded`. Un booléen nullable forçait à choisir entre
   sous-estimer les coûts et gonfler la file d'attente.

   **`failureKind` est explicitement nullable** — `v.union(literalUnion(BEAUTIFY_FAILURE_KINDS),
v.null())` — et l'invariant est posé et testé : `pending | accepted | rejected` ⇒ `failureKind`
   nul, un `discarded` **technique** ⇒ `failureKind` non nul. Un `discarded` peut aussi être non
   technique (l'appel a réussi, la finalisation était périmée) : dans ce cas `failureKind` reste nul
   et c'est l'`outcome` seul qui raconte.

   **Une ligne par appel terminé, et l'unicité est construite, pas espérée.** Convex n'a pas de
   contrainte unique : chaque mutation de journalisation lit d'abord `by_attempt_id` dans la même
   transaction et n'insère que si rien n'existe. Sans ça, une finalisation rejouée journalise deux
   fois le même appel et double son coût dans l'agrégat. Testé par rejeu explicite.

   `costReported` porte le drapeau : une réponse sans `usage.cost` est journalisée à `costUsd: 0`
   avec `costReported: false`, faute de quoi un coût manquant se lirait comme un appel gratuit dans
   l'agrégat.

3. **`hasIllustration: v.optional(v.boolean())`** sur `recipes`, dénormalisé et indexé
   (`.index('by_illustration', ['hasIllustration'])`), plus
   `.index('by_beautify_status', ['beautifyStatus'])`. Et **`beautifyStartedAt: v.optional(v.number())`**,
   que la section C utilise et que la version précédente de ce plan avait oublié de déclarer.

   **Optionnel, et migré par lots.** Un booléen obligatoire casserait toutes les recettes existantes ;
   le champ est donc optionnel au schéma, puis backfillé. Mais un backfill « unique sur tout le
   corpus » est une transaction non bornée — Convex la refusera passé un certain volume. La migration
   est donc **une mutation interne par lot** (curseur `paginate`, taille fixe) qui se replanifie par
   `scheduler.runAfter(0, …)` tant qu'il reste une page, et qui écrit son avancement dans une **ligne
   d'état durable** (`migrations`, clé `hasIllustration` : `cursor`, `done`). Interrompue, elle
   reprend où elle en était.

   Le piège reste : tant qu'une recette n'a pas le champ, elle est **invisible** à
   `q.eq('hasIllustration', false)`. Mais le compteur « hors index » ne se calcule **pas** par
   comptage total moins deux requêtes indexées — c'est exactement le scan non borné qu'on vient
   d'éliminer. La liste de travail lit la ligne d'état : tant que `done` est faux, elle affiche
   « migration en cours » et n'affirme rien sur l'exhaustivité ; une fois `done` vrai, l'index est
   exhaustif par construction et il n'y a plus rien hors index.

   Maintenu par **un seul point d'écriture**, `withIllustration` dans `convex/lib/recipeWrites.ts`,
   exactement comme `withSearchText` gouverne `searchText`. Un test vérifie après chaque mutation
   d'image que `hasIllustration === (imageStorageId !== undefined)`. **Ceci remplace le pari sur
   `q.eq(field, undefined)`**, que les guidelines Convex ne garantissent pas.

4. **`uploadTickets.purpose`** : `literalUnion(['scan', 'illustration'])`, écrit à l'émission du
   ticket. **`attachImage` refuse un ticket `illustration` et `attachIllustration` refuse un ticket
   `scan`** — sans quoi les deux seaux ne sont qu'une décoration, un ticket obtenu sur le quota de
   scan servant à illustrer. Les tickets existants n'ont pas le champ : il est optionnel au schéma,
   et un ticket sans `purpose` est traité comme `scan`.
5. **Seau `beautify`** : fenêtre fixe, **40/h**. **Seau `illustrationUpload`** distinct de
   `scanCreation`. `generateUploadUrl` prend un argument `purpose` qui choisit le seau **et** marque
   le ticket.
6. **Alerte de coût — et le mot est choisi.** Une réponse dont `usage.cost` dépasse un multiple du
   coût mesuré (0,03944 USD) est journalisée et signalée à l'écran. **Ce n'est pas un plafond** : le
   coût n'est connu qu'après facturation, donc rien n'est empêché, seulement rendu visible. Appeler
   ça un plafond serait un mensonge de conception. Le vrai garde-fou en amont reste la limite de
   débit, qui borne les **appels**.

### B. Poser la photo

7. **`attachIllustration` est une action, pas une mutation** — et c'est une correction de fond. La
   validation d'en-tête exige de lire les octets, donc `ctx.storage.get`, qui **n'existe que dans une
   action** : `convex/extract.ts:648` est le seul appel du dépôt et il est bien dans une action. Un
   `sniffImageHeader` dans une mutation était irréalisable.

   Le geste se coupe donc en deux, dans `convex/illustrations.ts` :

   - **`attachIllustration`** (action publique, authentifiée) : lit le blob, vérifie
     `MAX_INPUT_BYTES` puis **valide l'en-tête par `sniffImageHeader`** — le serveur ne fait pas
     confiance à la compression client, contournable par un appel direct. Une originale illisible
     publiée sur la vitrine serait un cadre cassé, pas une erreur signalée.
   - **`internal.illustrations.commitIllustration`** (mutation interne) : **consomme le ticket
     atomiquement** — c'est elle qui vérifie le `purpose` et la validité du ticket, dans la même
     transaction que l'écriture, sinon deux actions concurrentes consomment le même ticket. Elle
     écrit `imageStorageId` **et** `hasIllustration` par `withIllustration`.

   L'ordre importe : la validation est faite **avant** que le ticket soit consommé, mais c'est la
   mutation qui arbitre.

   **Et un refus ne supprime pas toujours.** « Ticket déjà consommé ⇒ supprime le blob » est une
   course destructrice : un rejeu, ou une seconde action concurrente, voit le ticket consommé par la
   première et supprime l'image que celle-ci vient d'attacher. Le ticket porte donc, à sa
   consommation, **le `recipeId` et le `storageId` effectivement attachés**, et la mutation
   distingue trois cas :

   | ticket                                                      | verdict                  | blob         |
   | ----------------------------------------------------------- | ------------------------ | ------------ |
   | vierge, valide                                              | attaché                  | conservé     |
   | vierge, refusé (mauvais `purpose`, expiré, recette absente) | refus                    | **supprimé** |
   | déjà consommé, même `(recipeId, storageId)`                 | **succès** — rejeu exact | conservé     |
   | déjà consommé, `(recipeId, storageId)` différents           | refus                    | **conservé** |

   Seul un ticket **encore vierge** autorise une suppression. Un rejeu identique est un succès, pas
   un refus — l'appelant a le droit de réessayer. Un rejeu divergent refuse sans rien détruire :
   le blob qu'il désigne n'est pas le sien. `ctx.storage.delete` est bien disponible en mutation
   (`convex/admin.ts:146`) ; c'est le _droit_ de supprimer qui est conditionné, pas la capacité.
   L'action, elle, supprime sans réserve quand **sa propre** validation échoue : à ce moment-là
   aucun ticket n'a été consommé et le blob n'appartient à personne.

8. **Remplacer ou détacher une originale est refusé tant qu'un embellissement est accepté**
   (`beautifiedAccepted === true`). Il faut le rejeter d'abord. C'est plus simple qu'un
   `beautifiedSourceStorageId` durable, et ça évite le blob sans propriétaire que produisait la
   version précédente de ce plan — qui conservait l'ancienne originale sans que rien ne la désigne.
9. Hors ce cas, un remplacement supprime l'ancienne originale, et un détachement supprime
   l'originale et tout candidat pendant.
10. **Tout remplacement ou détachement annule la tentative en cours, complètement et dans la même
    transaction** : `beautifyAttemptId` effacé, `beautifyStartedAt` effacé, `beautifyStatus` ramené
    à `failed` avec une cause explicite (« génération annulée : l'image source a été remplacée »).
    N'effacer que l'identifiant, comme le faisait la version précédente, laissait la recette en
    `generating` jusqu'à une expiration de bail manuelle — bloquée sans raison visible.

### C. Embellir

11. **Matrice de transitions, appliquée et testée**, plutôt qu'un refus unique sur `generating` :

    **Cinq gestes, pas quatre.** « Rejeter » et « dépublier » ne sont pas la même opération : le
    premier supprime le blob candidat, le second le conserve pour que la vitrine puisse retomber sur
    l'originale sans perdre un rendu déjà payé. Et **un candidat conservé après dépublication ne se
    « rejette » pas** : sa tentative porte `outcome: 'accepted'`, définitivement — la règle du double
    arbitrage interdit de la réécrire. Le supprimer est un geste de ménage, pas un arbitrage, et il
    lui faut son propre nom.

    | état de départ                                | `requestBeautify`                                    | `acceptPending` | `rejectPending` | `unpublishAccepted` | `deleteUnpublishedCandidate` |
    | --------------------------------------------- | ---------------------------------------------------- | --------------- | --------------- | ------------------- | ---------------------------- |
    | `idle`, sans image                            | refusé                                               | refusé          | refusé          | refusé              | refusé                       |
    | `idle`, avec image, aucun candidat            | **autorisé**                                         | refusé          | refusé          | refusé              | refusé                       |
    | `idle`, candidat conservé après dépublication | **autorisé** — supprime d'abord le candidat conservé | refusé          | refusé          | refusé              | **autorisé**                 |
    | `idle`, embellissement accepté                | refusé — dépublier d'abord                           | refusé          | refusé          | **autorisé**        | refusé                       |
    | `generating`                                  | refusé                                               | refusé          | refusé          | refusé              | refusé                       |
    | `review`                                      | refusé — arbitrer d'abord                            | **autorisé**    | **autorisé**    | refusé              | refusé                       |
    | `failed`                                      | **autorisé**                                         | refusé          | refusé          | refusé              | refusé                       |

    `rejectPending` est **réservé à `review`** : c'est le seul état où une tentative est encore
    `pending`, donc le seul où un arbitrage est encore à rendre. `deleteUnpublishedCandidate`
    supprime le blob **sans toucher à l'`outcome` historique**, qui reste `accepted` : la recette a
    bien eu un embellissement adopté un jour, et le journal de coûts le dit toujours.

    **Aucun blob candidat ne survit à une nouvelle génération** : `requestBeautify` supprime tout
    candidat présent avant de créer la tentative. Sans cette règle, le candidat conservé par une
    dépublication était silencieusement écrasé par le suivant — un orphelin par régénération.

12. **`requestBeautify`** pose `beautifyStatus: 'generating'`, un `beautifyAttemptId` neuf et
    **`beautifyStartedAt`**, puis `scheduler.runAfter(0, internal.beautify.render, …)` en portant
    **`sourceStorageId`** — l'image effectivement lue.
13. **`convex/beautify.ts`** (action interne) : porte `decodeImageResponse` et l'appel de
    `spike13/openrouter.ts`, sans `BudgetCounter` ni `readFile` — le blob vient de
    `ctx.storage.get`. Plafond de requête aligné sur la durée maximale d'une action Convex, pas sur
    les 300 s du banc, qui bornaient des modèles écartés depuis.
14. **`finalizeBeautify`** exige **les trois** : `beautifyStatus === 'generating'`, `beautifyAttemptId`
    identique, **et `recipe.imageStorageId === sourceStorageId`**. L'identifiant seul survit à
    l'écriture — c'est la faille que T8 a dû corriger sur `finalize` — et sans la troisième
    condition, un candidat produit depuis une image remplacée entre-temps serait attaché à la
    nouvelle.

    **Mais le rejeu se reconnaît avant tout nettoyage.** Une seconde finalisation de la même
    tentative ne satisfait plus `status === 'generating'` — la première l'a fait passer à `review` —
    et la règle ci-dessus la lirait comme périmée, donc supprimerait un `candidateStorageId` que la
    recette référence désormais. Le premier test de la mutation est donc : si
    `beautifyAttemptId` **et** `beautifiedStorageId` correspondent tous deux à l'appel, elle retourne
    **`adopted`** sans rien écrire ni supprimer. Les trois conditions ne s'appliquent qu'ensuite.
    C'est le même principe qu'au point 7 : **l'idempotence précède la destruction**, sans quoi tout
    nettoyage transactionnel devient une arme braquée sur le rejeu.

15. **Le blob candidat est supprimé dans la transaction qui refuse de l'adopter**, pas après.
    `finalizeBeautify` reçoit le `candidateStorageId` en argument : quand elle refuse l'adoption, la
    **même mutation** journalise `outcome: 'discarded'` et appelle `ctx.storage.delete`. Faire
    supprimer l'action après coup, comme le prévoyait la version précédente, ouvrait une fenêtre de
    crash entre le journal et la suppression — un orphelin invisible, puisque le journal disait déjà
    « écarté ». `ctx.storage.delete` est disponible en mutation (`convex/admin.ts:146`,
    `convex/retention.ts:153`) : rien n'oblige à sortir de la transaction. La tentative est
    journalisée quoi qu'il arrive — l'appel a été facturé, son coût doit être compté.
    15 bis. **La sortie du modèle est bornée pendant sa lecture, pas après.** Plafonner après décodage
    base64 arrive trop tard : `response.text()` puis `JSON.parse` ont déjà tout chargé, et une
    réponse énorme épuise la mémoire de l'action avant qu'un seul contrôle ne s'exécute. Trois
    barrières, dans cet ordre : **(a)** le corps HTTP est lu en flux et abandonné dès qu'il dépasse
    le plafond ; **(b)** la longueur de la chaîne base64 est vérifiée **avant** décodage (la taille
    décodée s'en déduit : `≈ 3/4`) ; **(c)** `sniffImageHeader` sur les octets obtenus, puisqu'une
    réponse mal formée deviendrait un candidat illisible. `decodeImageResponse` accepte aujourd'hui
    n'importe quel `data:image/*` sans aucune borne. Toute sortie non conforme est supprimée et
    journalisée — `truncated` si elle a dépassé le plafond, `invalid_image` si l'en-tête est refusé,
    `no_image` s'il n'y avait pas d'image du tout.
16. **Génération abandonnée** : une action tuée avant sa mutation d'échec laisse la recette en
    `generating` pour toujours. `beautifyStartedAt` rend l'abandon visible, et l'écran offre
    **« abandonner cette génération »** qui bascule en `failed` au-delà d'un plafond de bail.
    Manuel et non un cron, cohérent avec le refus de surveillance automatique du projet.
17. **Échec** : `beautifyStatus: 'failed'`, `beautifyError` renseigné, ligne journalisée avec son
    `failureKind`. **Aucune reprise automatique.**

### D. Arbitrer

18. **`acceptBeautified`** (depuis `review`) : `beautifiedAccepted: true`, `beautifyStatus: 'idle'`,
    la ligne trouvée par `by_attempt_id` passe à `outcome: 'accepted'`. `beautifyAttemptId` est
    **conservé jusqu'à l'arbitrage** — c'est lui qui relie la recette à sa tentative.
19. **`rejectPendingCandidate`** (depuis `review`) : supprime le blob candidat, efface
    `beautifiedStorageId`, repasse à `idle`, marque la tentative `outcome: 'rejected'`. L'originale
    est intacte.
20. **`unpublishAcceptedCandidate`** (depuis un embellissement accepté) : `beautifiedAccepted: false`
    **sans supprimer le blob**, la vitrine retombant sur l'originale sans perdre le rendu payé.
    L'`outcome` de la tentative reste `accepted` : il enregistre ce que l'humain a jugé du rendu, pas
    ce qui est publié aujourd'hui.
21. **Un double arbitrage est refusé** : une tentative dont l'`outcome` n'est plus `pending` ne peut
    plus être arbitrée. C'est ce qui rendait la matrice précédente contradictoire — « rejeter après
    acceptation » y était autorisé alors que cette règle l'interdisait.
22. **Régénérer** = supprimer le candidat courant puis `requestBeautify`, dans une seule mutation.

### E. L'écran

23. **`/admin/illustrations`** (`src/routes/admin_.illustrations.tsx`, un-nested comme
    `admin_.scan.$id.tsx`), liste de travail conçue pour le mobile.
24. **Requêtes et bornes explicites**, sur la convention déjà en place dans `listScans`
    (`take(CAP + 1)` et drapeau de troncature visible) : les candidats en attente par
    `by_beautify_status`, les recettes sans photo par `by_illustration`. Deux requêtes bornées,
    chacune rapportant sa troncature — **pas de balayage non borné**. Plus un bandeau
    **« migration en cours »** tant que la ligne d'état du backfill n'est pas `done` — une lecture de
    document unique, et non un comptage total de la table, qui serait précisément le balayage non
    borné qu'on prétend interdire.
25. **Ordre** : candidats en attente d'arbitrage en tête — travail déjà payé — puis les recettes sans
    photo, les plus récentes d'abord. Brouillons et publiées ensemble. Une bascule affiche celles
    qui ont déjà une illustration, sans quoi on ne peut jamais en remplacer une.
26. **Comparaison empilée** : originale au-dessus, candidat en dessous, pleine largeur. Côte à côte
    sur un téléphone rend illisible la trame d'impression, qui est ce qu'il faut juger.
27. **Le cadrage est dit à l'écran, au moment de la prise** : « photographie la page telle quelle, en
    gardant le texte imprimé autour du plat ». Conclusion la plus contre-intuitive de T13, et l'écran
    est le seul endroit où elle peut agir.
28. Formulaire **contrôlé et sans état local**, comme `RecipeForm` après la revue de T8.
29. **`summarizeBeautifyAttempts`**, agrégateur distinct : identité `{model, promptVersion}` — sans
    `schemaVersion`, qui n'existe pas ici — et métriques propres : les quatre `outcome`
    (**en attente, acceptés, rejetés, abandonnés**), taux d'échec technique, coût total et moyen,
    latence moyenne, et **le nombre d'appels sans coût rapporté** (`costReported: false`), sans quoi
    le coût total se lirait comme exact alors qu'il est un plancher.

### F. Preuve

30. Tests Convex sur les chemins dangereux, nommément : ticket d'un usage consommé par l'autre
    endpoint ; ticket rejoué ; remplacement de l'originale pendant une génération — qui doit laisser
    la recette en `failed` avec sa cause, **pas** en `generating` — puis finalisation périmée ;
    suppression du blob non adopté **avec sa ligne journalisée en `discarded`** ; double arbitrage ;
    génération abandonnée puis abandonnée à la main ; chaque transition interdite de la matrice ;
    refus de remplacement et de détachement sous embellissement accepté ; **dépublication qui
    conserve le blob, puis régénération qui le supprime** ; **suppression d'un candidat dépublié qui
    laisse l'`outcome` à `accepted`** ; **`rejectPending` refusé hors de `review`** ; cohérence de
    `hasIllustration` après chaque mutation ; **backfill repris après interruption**, qui doit finir
    le corpus sans réécrire les lignes déjà migrées ; et **journalisation rejouée**, où deux
    finalisations du même `attemptId` ne produisent qu'une ligne et un seul coût. Et les deux rejeux
    destructeurs, nommément : **`commitIllustration` rejouée à l'identique**, qui doit retourner un
    succès sans supprimer l'image déjà attachée, et la variante **divergente**, qui doit refuser
    sans rien supprimer ; **`finalizeBeautify` rejouée après adoption**, qui doit retourner `adopted`
    sans supprimer le candidat ni changer l'`outcome`.
31. **Un chemin nominal complet** : téléversement → génération → acceptation, puis le même jusqu'au
    rejet.
32. Test de l'appel avec `fetch` simulé : `modalities` présent, décodage du data-URI, les trois
    échecs convertis vers la nouvelle taxonomie, le cas `usage.cost` absent (`costReported: false`),
    **un corps HTTP dépassant le plafond, abandonné pendant la lecture** (et non après décodage),
    **une chaîne base64 trop longue refusée avant décodage** et **une sortie dont l'en-tête ne passe
    pas `sniffImageHeader`** — toutes supprimées avant adoption. Plus l'invariant de `failureKind` :
    exhaustif sur les quatre `outcome`.
33. **Aucun test ne dépense d'argent.** Les sept contrôles du CI restent gratuits.

## Key decisions & tradeoffs

| #   | Décision                                                                                                | Pourquoi, et ce qu'on refuse                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | La photo se pose depuis une **liste de travail**, pas depuis l'écran de correction                      | Le geste réel est « scanner en lot sur l'ordi, repasser sur mobile plus tard ». L'écran de correction est indexé par scan, souvent purgé à ce moment-là                                                                                                                                                                                                                          |
| Q2  | **Photo dédiée**, téléversée à part                                                                     | La photo du plat est parfois sur une autre page. Refusé : promouvoir une page de scan par défaut, elle est purgée                                                                                                                                                                                                                                                                |
| Q8  | **Cadrage large, texte imprimé conservé**                                                               | T13 : plan large **4/4**, gros plan détouré **1/4**. « Le modèle restaure quand il doit détourer »                                                                                                                                                                                                                                                                               |
| Q3  | La **première** génération est déclenchée à la main                                                     | Sinon on paie un embellissement sur chaque photo posée, y compris celles qu'on aurait gardées telles quelles                                                                                                                                                                                                                                                                     |
| Q4  | Action planifiée directe, **pas de file**                                                               | La file d'extraction sérialise trente scans lâchés d'un coup ; ici le débit est d'un, à la main                                                                                                                                                                                                                                                                                  |
| Q5  | **Suppression immédiate** des blobs non adoptés ; remplacement **interdit** sous embellissement accepté | Tranche R4 dans le sens de T8 : plutôt le risque théorique d'un blob partagé que la certitude d'orphelins                                                                                                                                                                                                                                                                        |
| Q6  | Une recette **en brouillon** peut porter une photo                                                      | `pickDisplayImage` ne lit jamais `status`                                                                                                                                                                                                                                                                                                                                        |
| Q9  | Seau `beautify`, **40/h**, plus une **alerte** de coût par appel — pas un plafond                       | Un embellissement coûte **7,7×** une extraction. Le coût n'étant connu qu'après facturation, seule la limite de débit borne quelque chose en amont                                                                                                                                                                                                                               |
| Q10 | Table **`beautifyAttempts` distincte**, et **taxonomie d'échec distincte**                              | `extractionAttempts.scanId` est obligatoire ; `FAILURE_KINDS` ne couvre ni `no_image` ni les besoins d'une image                                                                                                                                                                                                                                                                 |
| Q11 | Comparaison **empilée**                                                                                 | Côte à côte sur un téléphone rend illisible ce qu'il faut juger                                                                                                                                                                                                                                                                                                                  |
| Q13 | Candidats en attente en tête, puis sans-photo, plus récentes d'abord                                    | Un candidat non arbitré est du travail déjà payé                                                                                                                                                                                                                                                                                                                                 |
| Q14 | Second bloc de coût, par un agrégateur **propre**                                                       | `attemptSummary` exige `schemaVersion` et ignore l'acceptation humaine                                                                                                                                                                                                                                                                                                           |
| Q15 | Seaux séparés, **et `purpose` porté par le ticket**                                                     | Deux seaux sans marquage du ticket ne sont qu'une décoration                                                                                                                                                                                                                                                                                                                     |
| —   | `hasIllustration` **dénormalisé, optionnel, indexé, backfillé par lots**                                | `undefined` n'est pas une valeur Convex. Même discipline que `searchText` : un seul point d'écriture, une invariance testée. Optionnel parce qu'un booléen obligatoire casserait les recettes existantes ; migré page par page avec un état durable, parce qu'une transaction sur tout le corpus dépasserait les limites Convex                                                  |
| —   | `outcome` à quatre valeurs plutôt qu'un booléen nullable                                                | Une finalisation périmée doit compter son coût sans se lire comme « en attente ». Le nullable forçait à choisir entre sous-estimer la dépense et gonfler la file                                                                                                                                                                                                                 |
| —   | **Rejeter**, **dépublier** et **supprimer un candidat dépublié** sont trois mutations distinctes        | Le premier supprime le blob et arbitre, le deuxième conserve le blob sans réécrire l'arbitrage, le troisième fait le ménage sur une tentative déjà arbitrée. Les fusionner rendait la matrice contradictoire avec la règle du double arbitrage                                                                                                                                   |
| —   | `attachIllustration` est une **action** suivie d'une **mutation interne**                               | `ctx.storage.get` n'existe qu'en action (`convex/extract.ts:648` est le seul appel du dépôt) : valider un en-tête depuis une mutation était irréalisable. La consommation du ticket reste dans la transaction, sinon deux actions concurrentes consomment le même                                                                                                                |
| —   | L'unicité du journal est **construite**, pas espérée                                                    | Convex n'a pas de contrainte unique : chaque journalisation lit `by_attempt_id` dans sa propre transaction avant d'insérer. Sans ça, une finalisation rejouée double le coût de l'appel dans l'agrégat                                                                                                                                                                           |
| —   | **L'idempotence précède la destruction** — dans les deux mutations qui suppriment un blob               | Un nettoyage transactionnel est une arme braquée sur le rejeu : la seconde exécution ne reconnaît plus l'état initial et détruit ce que la première a légitimement attaché. Le ticket porte donc `(recipeId, storageId)` et `finalizeBeautify` reconnaît `(attemptId, candidateStorageId)` **avant** d'appliquer ses gardes. Seul un état encore vierge autorise une suppression |

## Risks / open questions

- **La concurrence n'est bornée que par la limite de débit.** La matrice de transitions empêche deux
  générations sur **la même** recette ; rien n'empêche quarante générations sur quarante recettes
  différentes. C'est assumé : l'opérateur est unique et agit à la main, et un verrou distribué serait
  de la machinerie pour un débit d'un.
- **Rien ne borne la dépense en amont, et le plan ne prétend pas le contraire.** La limite de débit
  borne les **appels** ; le coût réel n'est connu qu'après facturation. L'alerte par appel et
  l'agrégat visible sur `/admin` rendent une dérive lisible, ils ne l'empêchent pas. Un budget
  durable avec réservation transactionnelle serait le seul vrai garde-fou — noté comme reliquat,
  pas construit ici, faute d'un incident qui en fixe le seuil.
- **Le backfill de `hasIllustration` est le seul moment fragile de la migration.** Tant qu'il n'est
  pas complet, des recettes sont invisibles à la liste de travail. D'où l'état durable et le bandeau
  « migration en cours » : l'écran n'affirme l'exhaustivité qu'une fois `done` posé. Il reste qu'une
  migration bloquée en plein corpus se voit mais ne se répare pas toute seule — la relance est
  manuelle, cohérente avec le refus de surveillance automatique du projet.
- **Les photos de plat en pleine page, sans texte autour.** Rien à détourer ⇒ embellissement faible
  par nature ; la sortie est de garder l'originale, pas de recadrer. Non mesuré sur le corpus réel :
  T13 n'a testé que quatre plats.
- **Une photo sur quatre rend un verdict différent d'une passe à l'autre** (T13). C'est ce qui
  justifie « régénérer », et ce qui fait qu'un taux de rejet élevé ne condamnera pas le modèle.
- **Aucun test de composant** ne couvrira l'écran (R7). La logique arbitrable doit sortir en
  fonctions pures testables, comme `publicationReport`.

## Out of scope

- **R9** — créer une recette hors de tout scan.
- Toute modification de la vitrine : elle est déjà complète.
- Recadrage, rotation ou retouche avant l'appel — T13 a montré que le recadrage nuit.
- Galerie multi-photos, génération d'une photo quand aucune n'existe, agrandissement en vitrine :
  « non retenus » dans `SUIVI.md`.
- Reprise automatique après échec, cron de rattrapage, workpool à concurrence bornée.
- Balayage de `_storage` à la recherche d'orphelins (R4).
