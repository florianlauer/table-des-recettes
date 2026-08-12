# Journal de revue du plan : retours UX de l'atelier d'administration

Démarré le 2026-08-12. `MAX_ROUNDS=4`. Plan revu :
[`2026-08-12-admin-ux-design.md`](./2026-08-12-admin-ux-design.md).

Critique : Codex (`gpt-5.6-sol`, `model_reasoning_effort=medium`) en sandbox lecture seule.
Arbitre : Claude.

## Tour 1 — Codex

Verdict : `VERDICT: REVISE`. Vingt-deux constats.

1. **Contrat de `run` absent.** Les actions rendent des formes incompatibles (`ActionOutcome`, `Outcome`, chaînes de `purgeScanImages`, statuts de `startExtraction`, résultats d'upload) : `run` ne peut pas produire uniformément `{ ok, text }`. → Exiger `Promise<{ ok, text }>` et adapter au point d'appel.
2. **Double déclenchement avant re-render.** Deux clics dans le même tour appellent `run` avant que `disabled` reflète l'état React. → Registre synchrone dans un `ref`, refus atomique avant l'appel.
3. **Course entre deux exécutions de même clé.** Sans identifiant d'exécution, le `finally` d'un ancien appel supprime le pending du nouveau. → Jeton monotone par exécution, tout ce qui n'est plus courant est ignoré.
4. **Verrou de page asymétrique.** Rien ne teste « ligne en cours ⇒ geste de page verrouillé », ce qui contredit la justification de `Tout publier`. → Conflits symétriques et testés dans les deux sens.
5. **Portée des uploads indéfinie.** `upload:new` / `upload:scan` n'identifient ni scan ni recette. → Clés portant la ressource ; uploads de scan en portée page.
6. **Le parser de clés est une source de bugs.** `GestureKey = string` puis déduction de portée par convention textuelle. → Union discriminée.
7. **API de progression incohérente.** `progressView` attend un texte que ni `RunningGesture` ni `setProgress` ne transportent. → Stocker `{ fraction, text }`.
8. **Le plancher monotone n'a pas de propriétaire.** `floor` est un paramètre que personne ne détient. → Le stocker par jeton d'exécution.
9. **Entrées numériques non bornées** : temps négatif, estimation nulle ou non finie, fraction hors `[0,1]` ⇒ `aria-valuenow` et largeur invalides. → Normaliser et tester.
10. **Fenêtre de réactivation après mutation.** La promesse finit avant le re-render portant `generating` : le bouton redevient cliquable. → Tenir le verrou jusqu'à confirmation de l'état serveur.
11. **Résultat perdu quand la ligne disparaît.** Le `role="status"` local est démonté avant d'être perçu, le focus tombe sur le document. → Résultat republié au niveau section + focus déplacé.
12. **État périmé au changement de contexte.** `useGestures` n'est lié ni à `adminToken` ni au `scanId`. → Clé d'époque, complétions périmées invalidées.
13. **Répétition d'un même message live non garantie.** Deux « Fait. » identiques ne sont pas réannoncés. → Nœud remonté avec un identifiant d'annonce.
14. **Barre sans nom accessible.** → `aria-labelledby` vers le libellé du geste et le titre de la ligne.
15. **`blockedReason` non associé au bouton.** → `aria-describedby`.
16. **Les uploads échappent à `AdminButton`.** Trois `<input type="file">` sans libellé pending, sans résultat, sans style disabled ; le CSS ne cible que `button`. → `AdminFileInput` + `::file-selector-button`.
17. **Le timer fait re-rendre toute la page à 4 Hz.** → Isoler l'horloge dans les seules barres actives.
18. **Estimation par modèle dominant incorrecte.** Les journaux prennent les 200 derniers appels puis groupent par modèle ; le groupe dominant peut être un modèle retiré du service, et `OPENROUTER_MODEL` est configurable. → Estimer le modèle en service, ou pas de barre sous un échantillon minimal.
19. **Horloge serveur laissée « à confirmer ».** → Trancher son inclusion.
20. **Tests insuffisants**, et l'affirmation « aucune dépendance de rendu React » est fausse : `react-dom` est installé. → Rendu minimal, faux timers, scénario double-clic.
21. **Aucune observabilité de la qualité des estimations.** → Journaliser estimation, durée réelle, dépassement.
22. **Références partiellement inexactes** : `src/lib/beautifyStats.ts:35-53` ne documente que `BeautifySummary`, `AttemptSummary` est en `src/lib/attemptStats.ts:36-49`. → Corriger et ajouter une table exhaustive des gestes.

### Réponse de Claude

Vérifié dans le code avant d'arbitrer : `requestBeautify` **refuse** déjà une seconde génération
(`convex/illustrations.ts:230-231`), donc le point 10 ne coûte pas une double facturation — mais
l'affichage mentirait, le correctif est retenu quand même. Les points 18 et 22 sont confirmés dans le
code (`convex/admin.ts:464`, `convex/illustrations.ts:481`, `convex/extract.ts:224`,
`src/lib/attemptStats.ts:36-51`).

**Retenus, plan réécrit** : 1 (contrat `GestureResult` + quatre adaptateurs purs testés — les chaînes
sortent des `onClick`), 2 et 3 (registre synchrone en `ref`, test-et-pose atomique, jeton monotone
par exécution), 4 (table de conflit à douze cases, symétrique, testée dans les deux sens), 5 et 6
(union discriminée `page | row | isolated`, la chaîne n'est plus qu'une clé de `Record`), 7 et 8
(`{ fraction, text }` et `floor` portés par l'entrée de registre, donc nés et morts avec leur jeton),
9 (normalisation explicite, cas par cas dans les tests), 10 (`settleWhen` plafonné à 3 s), 11
(résultat republié en section + focus sur le `<h2>`), 12 (`epoch`), 13 (nœud de statut remonté par
`token`), 14 et 15 (`aria-labelledby`, `aria-describedby`), 16 (`AdminFileInput` et
`::file-selector-button`), 17 (horloge partagée consommée par `useSyncExternalStore`, seules les
barres actives se re-rendent), 18 (**`lastAttemptAt` additif dans les deux validateurs**, groupe le
plus récent et non le dominant, `MIN_ESTIMATE_SAMPLE = 3` sinon aucune barre), 19 (horloge serveur
**dans** le périmètre, extraite en `useServerClock`, repli borné), 22 (références corrigées, table
exhaustive surface → contrôle → portée → progression → résultat ajoutée).

**Retenu partiellement** : 20. `react-dom` est bien installé, donc un test de rendu figé par
`react-dom/server` est ajouté sur `AdminButton` (deux libellés, masquage, `aria-describedby`,
`aria-labelledby`). Rejeté en revanche : `@testing-library` et un scénario navigateur. Le dépôt n'a
ni l'un ni l'autre, les installer est un chantier distinct de celui-ci, et la course de double clic
est couverte par la fonction pure de test-et-pose — c'est elle qui porte la garde, pas le rendu.

**Rejeté** : 21. Instrumenter la qualité des estimations demanderait un second journal pour noter le
premier, sur un outil à opérateur unique qui affiche déjà les latences réelles à l'écran. C'est
exactement l'over-engineering que le projet proscrit. Consigné comme risque assumé : si la barre
ment, le constat viendra de l'usage.

## Tour 2 — Codex

Verdict : `VERDICT: REVISE`. Vingt constats. Télémétrie (tour 1, point 21) et limite aux tests
`react-dom/server` acceptées comme rejets légitimes, « si les primitives concurrentes et l'horloge
restent effectivement extraites en fonctions testables ».

1. **La table de conflits contredit la décision sur la capture.** `isolated → page = oui` bloque `startExtraction` pendant un envoi, alors que la décision 7 affirme le contraire. → Portée dédiée, ou corriger le texte.
2. **`settleWhen: () => boolean` capturera les données du rendu du clic** et restera faux malgré les nouveaux résultats Convex. → Évaluer depuis un `ref` synchronisé, ou exposer `gestures.settle()` depuis un `useEffect` observant l'état réactif.
3. **Le plafond de 3 s réintroduit le double déclenchement** : le bouton redevient actif sans confirmation et le clic suivant produit « Une génération est déjà en cours ». → Afficher « confirmation retardée », conserver le verrou jusqu'à l'état terminal, l'erreur ou le changement d'époque.
4. **Les exceptions ne font pas partie du contrat de `run`.** Mutations, actions, `fetch` et compression peuvent rejeter. → `run` capture `unknown`, le normalise, ne finalise que le token courant.
5. **Le changement d'époque n'évacue pas les entrées vivantes** : elles continuent de bloquer et de se rendre. → Vider synchroniquement registre et outcomes.
6. **La purge à la disparition d'une ligne peut supprimer le résultat qu'elle doit préserver** : Convex peut rafraîchir la requête avant que la mutation publie son outcome. → Marquer absente, conserver jusqu'à résolution, republier, puis purger.
7. **Le déplacement de focus peut voler le focus d'un autre travail** : les lignes sont indépendantes. → Ne déplacer que si `document.activeElement` appartenait à la ligne disparue.
8. **Les outcomes n'ont aucune politique de péremption** : messages contradictoires sous une même ligne. → Effacer ceux de la ressource au démarrage d'un geste et à une modification utilisateur.
9. **La progression de migration est impossible** : `{ started, done, migrated }` sans total (`convex/illustrations.ts:417-420`). → Compteur indéterminé sans `progressbar`, ou dénominateur serveur assumé.
10. **La progression du rescan n'est pas disponible** : `getScanForCorrection` ne retourne ni `startedAt` ni bail (`convex/admin.ts:536-605`). → Ajouter `startedAt`, ou retirer la barre.
11. **`lastAttemptAt` ne protège pas le premier appel après un changement de modèle** : le groupe le plus récent reste l'ancien. → Exposer l'identité configurée depuis le serveur, sinon masquer l'estimation.
12. **Les types de journal ne portent pas `createdAt`** (`attemptStats.ts:20-28`, `beautifyStats.ts:25-33`) : `journalStats` ne peut pas calculer `lastAttemptAt`. → L'ajouter explicitement.
13. **Le propriétaire de `floor` reste indéfini** : `progressView` le reçoit sans rendre le nouveau maximum, et le composant ne doit pas muter le registre pendant le rendu. → Rendre `nextFloor`, le persister hors rendu.
14. **`useSyncExternalStore` exige un snapshot stable et un `getServerSnapshot`** : rendre `Date.now()` boucle, et TanStack Start rend côté serveur. → Compteur de tick + `getServerSnapshot` stable.
15. **`useServerClock` peut appliquer une réponse périmée.** → Étiqueter chaque appel par son époque.
16. **`AdminButton` ne peut pas entrer tel quel dans un `<p>`** : `MigrationBanner` et l'alerte `imagesChanged` en utilisent un. → Les passer en `<div>`.
17. **La migration contredit « le résultat est la seule chose annoncée »** : `<p role="alert">` dont le compteur évolue. → Retirer `role="alert"` du statut évolutif.
18. **L'affordance du sélecteur de fichier est incomplète** : ni `:active` ni `cursor: pointer`. → Les ajouter.
19. **La resélection du même fichier n'est pas traitée** : conserver la valeur de l'input empêche `change` de repartir. → Copier les fichiers puis vider `value` avant de lancer le geste.
20. **`gestureId` n'a pas de construction injective spécifiée** : une concaténation collisionne si une valeur contient le séparateur. → Sérialisation structurelle (`JSON.stringify`) et test d'injectivité.

### Réponse de Claude

Quatre vérifications avant d'arbitrer : `migration` ne rend bien que `{ started, done, migrated }`
sans total (`convex/illustrations.ts:417-420`) ; `getScanForCorrection` n'a ni `startedAt` ni bail
(`convex/admin.ts:538-560`) ; `BEAUTIFY_MODEL` est un constant client
(`src/lib/beautifyPrompt.ts:9`) **mais** le modèle d'extraction vient de l'environnement serveur
(`OPENROUTER_MODEL`, `convex/extract.ts:224`), donc le client ne peut pas identifier seul l'identité
en service.

**Tous retenus**, sauf reformulations. Les décisions notables :

- **1** — la table de conflits est corrigée dans le bon sens : `isolated` ne croise **jamais** `page`.
  C'était le texte qui avait raison et la table qui avait tort, pas l'inverse.
- **3** — pas de libération temporisée. À 3 s l'écran dit « confirmation retardée… » et le verrou tient
  jusqu'à un état terminal, une erreur de requête ou un changement d'époque ; pour l'embellissement,
  le bail de 90 s et son bouton d'abandon sont le filet ultime. Les sorties sont portées par des
  données, plus par un minuteur.
- **9** — la barre de migration est **supprimée du plan**, pas contournée. Donner un dénominateur au
  serveur annulerait l'unique lecture de document qui justifie la migration par lots. Compteur sans
  `progressbar`.
- **10** — `startedAt` ajouté à `getScanForCorrection` : deux lignes, additif, et l'écran cesse
  d'afficher « État : extracting » sans dire depuis quand.
- **11 et 12** — remplacés par une solution qui retire un champ au lieu d'en ajouter deux : le serveur
  marque **`isCurrent`** sur le groupe dont l'identité est celle configurée. `lastAttemptAt` disparaît,
  `createdAt` n'a plus à être propagé dans les types de journal, et le premier appel après un
  changement de modèle n'a **aucun** groupe `isCurrent` — donc aucune barre, exactement le
  comportement annoncé.
- **6 et 7** — l'ordre est imposé explicitement : marquer `orphaned`, conserver l'exécution jusqu'à sa
  résolution, republier en section, purger ensuite ; et le focus ne bouge que si
  `document.activeElement` était dans la ligne disparue.
- **19** — c'est un défaut présent aujourd'hui, pas seulement dans le plan : après un échec, la même
  photo resélectionnée n'émet aucun `change` et l'écran paraît mort.

Le plan admet désormais **trois validateurs de sortie élargis** (`isCurrent` ×2, `startedAt` ×1). La
formule « aucun changement serveur » du tour 0 est retirée : c'est « aucune migration, aucun retrait ».

## Tour 3 — Codex

Verdict : `VERDICT: REVISE`. Huit constats (annoncés six).

1. **`isCurrent` ne peut pas être ajouté aux validateurs comme décrit.** `AttemptSummary` et `BeautifySummary` sont inférés des validateurs et rendus par les fonctions pures de résumé ; un `isCurrent` obligatoire les casse au typecheck, seule la requête connaissant la configuration. → Séparer un type de base du résumé wire étendu.
2. **L'identité d'extraction dite « réellement configurée » est incomplète** : ni `OPENROUTER_PROVIDER` dans les groupes, alors que le provider est configurable (`convex/extract.ts:224-225`) et peut changer fortement la latence sans changer le modèle. → Ajouter `servedProvider` à l'identité, ou documenter l'invalidité après changement de provider.
3. **La source serveur de `OPENROUTER_MODEL` n'est pas spécifiée.** → Déclarer les variables dans `defineApp({ env })` et partager l'accès.
4. **Le protocole `settle` accepte encore l'état terminal antérieur comme confirmation** : au clic, la ligne est souvent déjà `idle`, donc un effet réglant sur `idle | review | failed` finalise avant toute transition serveur. → Capturer l'état initial et ne régler que sur `generating`.
5. **Un résultat serveur refusé peut rester artificiellement pending** : aucun refus de rate limit ou de précondition ne sera suivi d'une transition réactive. → N'armer l'observation qu'après `ok === true`.
6. **L'horloge serveur manque précisément sur la nouvelle barre de rescan** : `useServerClock` n'est appliqué qu'à `/admin` et `/admin/illustrations`. → L'appliquer aussi à `admin_.scan.$id.tsx`.
7. **Le test de focus après disparition est trop tardif** : la ligne est démontée, `document.activeElement` vaut `body`. → Capturer `focusWasInside` au lancement du geste.
8. **Les tests ne couvrent pas la production de `isCurrent`**, seulement sa consommation, alors que Convex ne garantit pas statiquement la forme retournée. → Tests Convex : zéro, un, jamais plusieurs modèles marqués, y compris après changement de modèle ou de provider.

### Réponse de Claude

Vérifications : `OPENROUTER_PROVIDER` est bien exigé au même titre que le modèle
(`convex/extract.ts:224-226`) ; **les deux journaux enregistrent déjà `servedProvider`**
(`convex/beautify.ts:266`, `AttemptObservation` côté extraction) sans l'utiliser pour grouper ;
l'environnement est lu par `process.env` **injectable** (`convex/extract.ts:216`), et
`convex/convex.config.ts` ne contient qu'`app.use(rateLimiter)`.

**Retenus** : 1 (`attemptSummaryBase` / `attemptSummary`, la requête marque, la fonction pure résume),
2 (`servedProvider` **entre dans l'identité de groupe** des deux journaux — le tour 3 a raison, et le
bénéfice dépasse l'estimation : un changement de routage devient visible au lieu d'être moyenné), 4
(l'exécution capture l'état au lancement et ne se règle que sur la transition visée), 5 (l'attente
d'observation n'est armée qu'après `ok === true` ; refus et exceptions finalisent immédiatement), 6
(`useServerClock` sur les **trois** pages — la barre de relance s'appuie sur un `startedAt` serveur,
c'était le pire endroit pour l'oublier), 7 (`focusWasInside` capturé au lancement, quand
`activeElement` est encore le bouton cliqué), 8 (tests Convex sur la production de `isCurrent` ; le
commentaire de `src/lib/attemptStats.ts:33-38` dit lui-même que Convex ne vérifie pas le retour d'un
handler contre son validateur à la compilation).

**Rejeté** : 3, dans sa forme. Le fix proposé — déclarer les variables dans `defineApp({ env })` —
n'est pas le motif de ce dépôt : `convex.config.ts` n'y sert qu'à monter le composant `rateLimiter`,
et l'extraction lit `environment = process.env` **en paramètre injectable**, ce qui est exactement ce
qui la rend testable. Le besoin sous-jacent est en revanche accepté : la lecture n'était pas spécifiée.
Elle l'est maintenant, sous la forme `configuredExtractionIdentity(environment)` /
`configuredBeautifyIdentity()` dans `src/lib/currentIdentity.ts`, pur, injectable et testé.

Conséquence de 2 sur les compromis : l'ajout de `servedProvider` à la clé de groupe **fragmente les
statistiques existantes** (un journal servi par deux providers affiche deux lignes, avec des
échantillons plus petits). Consigné dans les risques, assumé.

## Tour 4 — Codex (plafond `MAX_ROUNDS` atteint)

Verdict : `VERDICT: REVISE`. Trois constats, dont deux touchant « directement la fonctionnalité
centrale ». Le rejet de forme du tour 3 est explicitement validé : « L'usage d'un helper pur à
environnement injectable est adapté au motif existant du dépôt ; `defineApp({ env })` n'est pas
requis. »

1. **L'identité d'extraction omet `promptVersion` et `schemaVersion`.** Les groupes sont séparés par quatre champs ; comparer les deux premiers laisse d'anciens groupes `isCurrent` après un changement de prompt ou de schéma, et leur estimation contamine la barre. → Comparer les quatre, avec `PROMPT_VERSION` et `RECIPE_SCHEMA_VERSION`.
2. **Le provider configuré et le provider servi ne sont pas dans le même espace de noms** : slug `google-ai-studio` demandé, `"Google AI Studio"` servi. Une égalité directe rend **tous** les groupes non courants. `normalizeProviderIdentifier()` existe déjà en `spike/openrouter.ts:295`. → Normaliser des deux côtés, avec un test `'google-ai-studio'` ↔ `'Google AI Studio'`.
3. **`focusWasInside` capturé au lancement peut encore voler le focus** : il reste vrai si l'opérateur lance A puis va travailler dans B avant la disparition de A. → Suivre `focusin`/`focusout`, ou ne déplacer le focus que si le dernier élément focalisé appartenait encore à la ligne.

### Réponse de Claude

Les trois sont retenus — aucun n'est contesté. Vérifications :
`normalizeProviderIdentifier` est bien en `spike/openrouter.ts:121-123` (minuscules,
suppression des espaces, tirets et underscores) et le harnais l'utilise exactement pour cette
comparaison (`:295-296`), parce que la requête pinne un **slug** (`convex/extract.ts:140-141`) et que
la réponse rend un **nom d'affichage** (`:172`). `PROMPT_VERSION = 'v5'`
(`src/lib/recipe-prompt.ts:3`) et `RECIPE_SCHEMA_VERSION = '2'` (`src/lib/recipe-schema.ts:5`) sont des
constants client : l'identité à quatre champs ne coûte rien.

- **1** — `configuredExtractionIdentity` rend les quatre champs, `isCurrentGroup` les compare tous.
- **2** — `normalizeProviderIdentifier` est **recopié** dans `src/lib/provider.ts` et appliqué des deux
  côtés. Recopié et non importé : `spike/` est un banc, pas du code applicatif — même convention que
  `BEAUTIFY_MODEL`, recopié de `spike13/` (`src/lib/beautifyPrompt.ts:2`). Sans cette correction la
  barre d'extraction aurait disparu en silence, ce qui est le pire mode de panne possible pour cette
  fonctionnalité : rien ne casse, rien ne s'affiche.
- **3** — remplacé par `lastFocusedRowId`, tenu par un écouteur `focusin` au niveau de la section. Ni
  le drapeau au lancement (trop tôt : l'opérateur peut partir dans B) ni `activeElement` à la
  disparition (trop tard : la ligne est démontée, `activeElement` vaut `body`) ne suffisaient.

## Résolution — plafond atteint sur `REVISE`, sans désaccord de fond

Le plafond `MAX_ROUNDS=4` est atteint alors que le dernier verdict est `REVISE`. La boucle **ne
converge donc pas formellement**, et ce journal ne prétend pas le contraire. Mais la nature de
l'impasse est particulière et vaut d'être dite : **il n'y a aucun point de désaccord ouvert**. Sur
les cinquante constats des quatre tours, un seul a été rejeté sur le fond (la télémétrie de qualité
des estimations, tour 1, point 21), un seul sur la forme (`defineApp({ env })`, tour 3, point 3 —
rejet ensuite validé par Codex lui-même), et un partiellement (`@testing-library` et test navigateur,
tour 1, point 20 — limite reconnue et consignée). Tous les autres sont intégrés au plan.

Les trois constats du tour 4 sont donc corrigés **sans avoir été re-soumis** : il ne restait plus de
tour. Ce que le plan n'a pas, c'est la confirmation d'un cinquième tour que ces trois corrections sont
bien écrites. C'est la seule chose qui manque, et c'est à l'humain de décider si elle est nécessaire.

## Tour 5 — Codex (tour accordé au-delà du plafond)

Le plafond `MAX_ROUNDS=4` avait été atteint sur `REVISE`. L'humain accorde un tour de vérification.

Avant de resoumettre, correction d'une erreur de ma part : **mon checkout local était périmé**. PR #14
est mergée en `4da32eb` (squash, d'où le `0c4d02b` local qui n'est ancêtre de rien) et PR #15
(`a8872ed`, prompt d'embellissement v4) l'est aussi. Le plan citait donc les lignes d'une base
dépassée. `main` est mis à jour, toutes les références de ligne sont revérifiées sur `a8872ed`, et le
risque « conflit de branche » est remplacé par un constat : les requêtes remontées adopteront le motif
`'skip'`, pas `enabled`.

Ce déplacement de base **démontre au passage le point 1 du tour 4** : `BEAUTIFY_PROMPT_VERSION` est
passé de `v3` à `v4` pendant cette revue. Une identité de groupe ignorant `promptVersion` estimerait
aujourd'hui la vitesse de `v4` avec les latences de `v3`.

Verdict : `VERDICT: REVISE`. **Un seul constat**, et la base confirmée exacte — « le motif `'skip'` est
présent dans les trois routes admin, `BEAUTIFY_PROMPT_VERSION` vaut bien `v4`, et les références du
plan restent matériellement exactes. Ces deux changements ne cassent pas l'approche. »

1. **Focus encore volable hors de la section.** Un écouteur `focusin` attaché à la section voit le passage de la ligne A à la ligne B, mais pas le départ vers un contrôle **extérieur** — le champ du jeton, par exemple. `lastFocusedRowId` resterait A, et la disparition de A volerait le focus depuis un champ en cours de saisie. → Écouter au niveau `document`, affecter la ligne la plus proche ou `null`.

### Réponse de Claude

Retenu tel quel. L'écouteur passe au niveau `document`, affecte `lastFocusedRowId` depuis
`closest('[data-row-id]')` et le met à `null` quand la cible n'appartient à aucune ligne gérée. Le
raisonnement est écrit dans le plan, pour que la portée de l'écouteur ne soit pas resserrée plus tard
par inadvertance.

## Tour 6 — Codex : convergence

> « Aucun défaut matériel restant. La correction du focus couvre désormais les deux transitions
> critiques : ligne A → ligne B et ligne A → contrôle extérieur. Le plan reste cohérent avec
> `a8872ed`, le motif Convex `'skip'` et `BEAUTIFY_PROMPT_VERSION = 'v4'`. Les courses, états
> périmés, identités de journal, intervalles, SSR et contraintes d'accessibilité sont suffisamment
> spécifiés pour passer à l'implémentation. »

`VERDICT: APPROVED`

**Bilan de l'argument** : 54 constats sur six tours (22 · 20 · 8 · 3 · 1 · 0), trois rejetés — la
télémétrie de qualité des estimations (over-engineering pour un outil mono-opérateur), le fix de forme
`defineApp({ env })` (rejet ensuite validé par Codex), et `@testing-library` plus un test navigateur
(limite reconnue, les courses étant portées par des fonctions pures). Tout le reste est dans le plan.
