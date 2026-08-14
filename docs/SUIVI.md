# Suivi d'avancement

État du projet au **2026-08-12**, `main` à `d4c7a1f`. Ce fichier dit **où on en est** ; il ne
remplace pas le contenu des tâches, qui reste dans
[`specs/2026-08-08-table-des-recettes-tasks.md`](./superpowers/specs/2026-08-08-table-des-recettes-tasks.md).

Statuts : ✅ fait · ⬜ à faire · ⛔ bloqué.

À mettre à jour à chaque PR mergée, en même temps que la case du fichier de tâches.

---

## Vue d'ensemble

| #       | Titre                                    | P   | Statut | Livré par                   | Preuve                                                           |
| ------- | ---------------------------------------- | --- | ------ | --------------------------- | ---------------------------------------------------------------- |
| **T1**  | Spike extraction vision multi-recettes   | P1  | ✅     | PR #1 + rejeu v3 dans PR #5 | `spike/RESULTS.md`                                               |
| **T13** | Spike embellissement d'image             | P1  | ✅     | PR #3                       | `spike13/RESULTS.md`                                             |
| —       | Socle et vitrine publique                | P1  | ✅     | PR #2                       | `src/routes/index.tsx`, `recette.$slug.tsx`                      |
| **T2**  | Schéma Zod source unique + pont Convex   | P1  | ✅     | PR #5                       | `src/lib/recipe-schema.ts`, `convex/schema.ts`                   |
| **T3**  | Finalisation atomique avec `attemptId`   | P1  | ✅     | PR #5                       | `convex/extract.ts`, `convex/extract.test.ts`                    |
| **T4**  | `requireAdmin` mutations/actions/queries | P1  | ✅     | PR #5                       | `convex/auth.ts`, `convex/rateLimits.ts`                         |
| **T5**  | Garde-fou format image + plafond octets  | P1  | ✅     | PR #5                       | `src/lib/compress.ts`, `src/lib/imageHeader.ts`                  |
| **T6**  | `raw` canonique + structure optionnelle  | P1  | ✅     | PR #2 (`scale.ts`) + PR #5  | `src/lib/scale.ts`, `spike/replay-fixtures.ts`                   |
| **T15** | Contrôles GitHub Actions sur les PR      | P3  | ✅     | PR #4                       | `.github/workflows/ci.yml`                                       |
| **T12** | Câbler Convex ↔ Vercel                   | P3  | ✅     | PR #7                       | `vercel.json`, `.github/workflows/preview.yml`                   |
| **T7**  | Rétention `purgeAfter`                   | P2  | ✅     | PR #8                       | `convex/retention.ts`, `convex/retention.test.ts`                |
| **T8**  | Scan multi-images + écran de correction  | P2  | ✅     | PR #11                      | `convex/recipeAdmin.ts`, `src/routes/admin_.scan.$id.tsx`        |
| **T9**  | Export automatique versionné dans git    | P2  | ✅     | PR #9                       | `convex/export.ts`, `scripts/restore.ts`                         |
| **T10** | Compteurs de file + bouton relancer      | P2  | ✅     | PR #8                       | `convex/admin.ts`, `src/lib/queueStatus.ts`                      |
| **T11** | Durcissement de l'appel OpenRouter       | P2  | ✅     | PR #10                      | `convex/schema.ts`, `src/lib/attemptStats.ts`                    |
| **T14** | Photo du plat : upload, embellissement   | P2  | ✅     | PR #13                      | `convex/illustrations.ts`, `src/routes/admin_.illustrations.tsx` |

**Aucune tâche restante.** Les quinze tâches du plan sont livrées.

---

## Ce qui tourne aujourd'hui

- **Vitrine publique** — index une colonne groupé par lettre, fiche recette, recalcul de portions,
  recherche tolérante. Lit des recettes publiées. La ligne de filtres compte par type via le
  composant `@convex-dev/aggregate` — douze petits agrégats, un par couple (statut, type) — au lieu de
  lire toute la table à chaque affichage de la page d'accueil. La recherche, elle, continue de compter
  ses propres résultats : un agrégat ne sait pas quelles lignes une requête touche.
- **Pipeline d'ingestion** — `/admin` : jeton en `localStorage`, sélection de fichier passant par
  `compress.ts`, création de scan, compteurs de file, lancement ou relance avec verdict réel et
  purge manuelle. Un scan traverse compression → stockage → appel OpenRouter → brouillons en base,
  avec `lastAttempt` qui raconte l'appel ; sa photo suit une échéance de rétention et une purge
  hebdomadaire.
- **Journal des tentatives d'extraction** — une ligne par tentative dans `extractionAttempts`,
  estampillée du modèle, du provider servi, de la version de prompt et de schéma, du coût, de la
  latence et du nombre de réparations. Survit à la purge du scan. `/admin` en rend l'agrégat sous le
  bloc de file, groupé par modèle et version : taux d'échec, échecs par nature, coût moyen et total,
  latence moyenne, volume de correction.
- **Photos de plat** — `/admin/illustrations`, liste de travail pensée pour le mobile : poser une
  photo sur une recette **longtemps après** son ingestion, sans repasser par le scan dont elle vient.
  L'écran dit le cadrage au moment de la prise, parce que c'est la conclusion la plus
  contre-intuitive de T13 : plan large avec le texte imprimé autour, **4 franchissements sur 4**,
  contre 1 sur 4 pour un gros plan détouré.

  **Cinq sections, rangées par étape de travail et non par « a-t-elle un blob ».** Deux ouvertes —
  ce qui attend un arbitrage, puis **ce qui attend un embellissement** — et trois repliées : sans
  photo, sans photo dans la source, terminées. Le rangement vient d'un `illustrationStage`
  dénormalisé, avec `beautifyStatus` en deuxième clé d'index : chaque recette est dans **exactement
  une** section. Une photo posée et pas encore embellie était auparavant classée « déjà illustrée »,
  derrière une case à cocher — l'étape principale du flux rangée sous « c'est fini ».

  Une recette dont la source n'a pas de photo se **marque**, et quitte la file de travail pour sa
  propre section repliée. Marque réversible d'un clic, effacée dès qu'une photo est posée, et sans
  aucun effet sur la vitrine : une ligne sans photo y est déjà normale et complète.

  Les quatre sections d'étape se lisent par lots de jour, ordonnés par `illustrationUpdatedAt` —
  « quand le travail photo de cette recette a bougé », et non la date de scan. Sans ce champ, une
  recette ingérée en mars puis photographiée aujourd'hui se rangeait au fond d'une section plafonnée,
  c'est-à-dire nulle part. Toute écriture de `imageStorageId`, `beautifiedStorageId`,
  `beautifiedAccepted`, `noPhotoAvailable` ou `beautifyStatus` le remet à jour ; un test d'inventaire
  énumère les exports de `illustrations.ts` et `beautify.ts` et casse quand une fonction apparaît
  sans être classée, parce que le compilateur peut prouver qu'un appel au helper est complet, jamais
  qu'un appel qui devrait y passer y passe.

  **Le remplissage de ces clés est une migration du composant `@convex-dev/migrations`, lancée par le
  déploiement lui-même** — `vercel.json` en production, le workflow d'aperçu juste après son import de
  données. Pas de bouton « Lancer la migration » : le flux principal de l'écran ne peut pas dépendre
  de quelqu'un qui se souvient d'appuyer. Rejouer la série est sans effet quand elle est terminée, et
  reprend au curseur quand elle a été interrompue, donc chaque déploiement peut l'appeler. À la main :
  `npm run migrate` (dev) ou `npm run migrate:prod`. Tant qu'elle n'est pas finie, les quatre sections
  d'étape ne sont **pas lues** plutôt que servies partielles — une file partielle demande à
  l'opérateur de se souvenir d'une bannière en lisant des lignes, et il conclura qu'un lot est fini.
  L'arbitrage, qui lit `by_beautify_status`, reste entier pendant toute la migration.

  `convex/migrations.ts` est le seul domicile des backfills, quelle que soit la table parcourue, ce
  qui fait de `runAll` la liste lisible de ce qu'un déploiement exécute : les clés d'étape,
  l'échéance de purge des scans, les rendus d'affichage manquants, l'agrégat de comptage. Deux
  d'entre eux étaient des mécaniques maison — une boucle paginée dans `retention.ts` et une action
  `deriveMissing` qu'un humain relançait jusqu'à ce qu'elle annonce zéro.

  Les dérivations d'image passent par un `Workpool` borné à `RENDITION_PARALLELISM = 4` au lieu de
  `scheduler.runAfter(0, …)`. Le backfill traverse tout le corpus : sans borne, il démarrait autant
  d'actions Node chargeant `sharp` qu'il y a de photos.

  La table `migrations` maison a disparu du schéma, mais Convex ne valide que les tables
  **déclarées** : sa ligne de production a survécu au retrait, orpheline et invisible aux requêtes
  typées. Elle ne se supprime que du tableau de bord, et seulement une fois le schéma **déployé**
  débarrassé de sa déclaration — vider ses lignes ne suffit pas, et pendant que l'ancien code tournait
  encore, il les réécrivait.

  Ce retrait a coûté deux déploiements de production échoués, pour une raison qui n'a rien à voir avec
  le code : `convex deploy` exécute `checkForLargeIndexDeletion`, un contrôle réservé à la production —
  `convex dev`, `convex run`, le codegen et les **previews** passent tous `'no verification'`. Dès
  qu'un index disparaît du diff, le contrôle compte les documents des tables concernées avec
  `_system/cli/tableSize`, ce qui exige `deployment:data:view` ; le seuil d'alerte est de **1**
  document, et sans terminal interactif il faut alors `--allow-deleting-large-indexes`. La clé de
  déploiement de Vercel, scopée `deployment:deploy` comme la documentation le recommande pour une CI,
  échouait donc sur `data:view`, puis — une fois ce mur passé — sur
  `deployment:functions:runInternalMutations`, réclamé par le `runAll` de la seconde moitié du
  `buildCommand`.

  Les droits d'une clé ne s'éditent pas : elle se remplace. `CONVEX_DEPLOY_KEY` (Production) porte
  désormais une clé mintée en CLI (`npx convex deployment token create`), qui reçoit le jeu large et
  passe les deux étapes. Conséquence à retenir : **une PR qui supprime un index ne se voit pas en
  CI** — previews vertes, production en échec.

- **Embellissement et arbitrage** — une génération se lance à la main, jamais automatiquement : on ne
  paie pas un rendu sur chaque photo posée. Le candidat se compare à l'originale **empilé**, pleine
  largeur, puis s'accepte, se rejette ou se régénère. Un embellissement publié se dépublie sans
  perdre le rendu payé. Journal `beautifyAttempts` : une ligne par appel terminé, son coût, sa
  latence, sa nature d'échec **et ce que l'humain en a décidé** — c'est la seule métrique qui dise si
  le modèle sert à quelque chose. L'agrégat est sous la liste de travail.
- **Deux bancs de spike** — `spike/` (extraction) et `spike13/` (embellissement), hors réseau en CI.
- **CI** — sept contrôles sur chaque PR, dont le build, aucun ne dépense d'argent.
- **Sauvegarde** — miroir versionné des recettes dans `backup/`, une par fichier JSON, actualisé
  chaque dimanche à 03 h UTC et commité sur `main`. La restauration a son script et ses tests. Un
  export vide refuse de tourner, pour ne pas effacer le miroir.
- **Déploiement** — production sur https://table-des-recettes.vercel.app, backend Convex
  `fleet-bat-50` (région US East). `vercel.json` porte le build ; poser le label `preview` sur une
  PR crée un backend Convex jetable avec une copie de la base de production et publie un frontend
  derrière la protection de déploiement Vercel.

La chaîne est complète de bout en bout : un scan porte une à quatre pages lues ensemble, l'écran de
correction `/admin/scan/$id` répare ce que le modèle a mal segmenté, la publication fige le slug et
arme la rétention, et la photo du plat se pose plus tard depuis le téléphone. **R3 est clos.**

---

## Prochain pas

**Aucune tâche restante.** Ce qui vient ensuite ne sort plus du plan mais de l'usage : les reliquats
ci-dessous, et ce que le premier vrai lot de recettes fera apparaître.

Les deux premières recettes réelles ont d'ailleurs déjà fait apparaître quelque chose, et le prompt
d'embellissement est passé à **`v4`** : les photos sont prises à travers une pochette plastique dont
`v2` ne parlait pas, et un gros plan sans texte imprimé ne laissait à `v2` aucune instruction active,
donc plus de raison de refaire la photographie. Mesuré sur 16 cellules — voir la campagne du
2026-08-12 dans `spike13/RESULTS.md`. **Le cadrage large reste le levier principal** : c'est encore
lui que la liste de travail conseille au moment de photographier.

Deux chiffres sont à confronter au réel dès les premières dizaines de photos, et l'administration
est faite pour ça : le **taux d'acceptation** des embellissements, sous la liste de travail, et le
**coût par appel**, à comparer aux 0,03944 USD mesurés par T13. T13 a mesuré qu'une photo sur quatre
rend un verdict différent d'une passe à l'autre : un taux de rejet élevé ne condamne donc pas le
modèle, c'est ce qui justifie le bouton « régénérer ».

Le conflit de version de prompt entre T8 et T11 est résolu : `PROMPT_VERSION` vaut **`v5`** et le
prompt porte les deux instructions — les pages d'une même source lues ensemble (T8) et les
contraintes sur la liste reconstituée (T11).

---

## Reliquats — hors périmètre des tâches restantes

Ce sont des choses connues, mesurées et non faites. Elles n'ont pas de tâche à elles.

- **R1 · Prompt v4 — fait en T11 le 2026-08-11.** v4 interdit les durées, les températures et les
  fractions d'un ingrédient déjà listé dans une liste reconstituée, et impose de n'en omettre aucun.
  Rejeu de contrôle exécuté : 14 appels, 0,0689 USD, comparaison conforme sur les sept pages. Le
  rejeu a révélé que v3 **perdait aussi `40 g de farine`** sur la page E, ce qui n'était pas relevé ;
  v4 la rend. Détail dans `spike/RESULTS.md` § « Rejeu sous prompt v4 ».

- ~~**R2 · Instabilité des étiquettes de section sur la page B.**~~ **Sans objet.** Cette entrée
  décrivait la réserve 1 du spike, mesurée sous prompt **v2**. Elle ne s'est jamais reproduite
  depuis : `Pour la pâte :` est écarté dans les quatre passes v2 archivées, les deux passes v3 et les
  deux passes v4. Le comparateur v4 en fait désormais une divergence fatale sur **toutes** les pages,
  donc un retour serait signalé au prochain rejeu plutôt que redécouvert à l'œil. Aucun prompt à
  réviser, aucun rejeu à payer.

- ~~**R3 · Publication d'un brouillon.**~~ **Clos par T8** : `publishRecipe`, `unpublishRecipe` et
  `publishScan` écrivent `slug`, `publishedAt` et `status`, et le slug n'est jamais recalculé.

- **R4 · Propriété et blobs orphelins.** Deux scans peuvent théoriquement partager un blob : aucun
  chemin accidentel connu ne le fait, mais une purge ne peut pas prouver l'exclusivité. Un index
  `by_storage_id` sur les tickets ne suffit pas, car les tickets consommés disparaissent après sept
  jours ; un registre durable demanderait une table `scanImages`, un backfill pour l'historique et
  un index distinct pour ne pas affamer le balayage des autres tickets.

  **Amendé par T8 :** un refus postérieur au téléversement (plafond d'images, taille agrégée, scan
  publié ou purgé) **supprime désormais le blob**, et `detachImage` aussi. Ce que T7 avait exclu — la
  suppression du blob d'un ticket `too_large` — devenait intenable dès lors que T8 ajoutait cinq
  nouvelles causes de refus : chaque refus aurait laissé son orphelin de 600 Ko, exactement la dette
  que ce reliquat décrit. Le compromis est explicite : on accepte le risque théorique de supprimer un
  blob partagé, dont la conséquence est une image manquante sur l'autre scan, plutôt que la certitude
  d'accumuler des orphelins. Produire ce partage exige qu'un porteur du jeton réutilise
  délibérément un `storageId` avec un ticket neuf.

  **Amendé par T14**, qui a donné à `recipes.imageStorageId` son écrivain de production et tranché
  dans le même sens : un remplacement supprime l'ancienne originale, un détachement supprime
  l'originale et son candidat, et un candidat non adopté meurt dans la transaction qui refuse de
  l'adopter. Trois règles ont été ajoutées pour que ce nettoyage ne se retourne pas contre lui-même.
  **Un remplacement est refusé tant qu'un embellissement est publié** — sans quoi la vitrine
  afficherait le rendu d'une image qui n'existe plus. **L'idempotence précède la destruction** :
  le ticket porte le couple `(recipeId, storageId)` qu'il a consommé et `finalizeBeautify` reconnaît
  son propre rejeu, faute de quoi une seconde exécution supprimerait ce que la première venait
  d'attacher. Et `deleteStoredBlob` vérifie l'existence avant d'effacer, pour que tout rejeu reste
  sans effet plutôt que fatal.

  Ce qui reste ouvert est le partage théorique lui-même : rien ne prouve l'exclusivité d'un blob.
  Tout balayage de `_storage` reste hors périmètre tant que la liste complète des propriétaires n'est
  pas garantie.

- **R5 · Repli d'embellissement disponible et chiffré.** `PROMPT_V3` (`spike13/prompt.ts`) supprime
  l'inclinaison partout (7 franchissements sur 8 contre 5) au prix de +23 % de latence. À activer si
  des cadres inclinés apparaissent en usage réel — aucune mesure à refaire. Il n'a pas été rejoué
  contre `v4`, qui n'existait pas quand il a été mesuré : son compromis reste chiffré contre `v2`.

- **R6 · Pas de remise à zéro d'un scan mort.** Un scan au plafond de tentatives reste terminal ;
  l'administration rend cette limite visible mais ne permet pas de la contourner.

- **R7 · Câblage de l'administration non testé.** Les règles de dérivation de la file sont testées
  dans `src/lib/queueStatus.test.ts`, la matrice de transitions telle que l'écran la lit dans
  `src/lib/illustrationWork.test.ts`, et le rapport de publication dans
  `src/routes/-scanCorrection.test.ts` — mais aucun test de composant ne couvre le JSX de `/admin`
  faute d'infrastructure React dédiée. C'est ce qui oblige toute logique arbitrable à sortir en
  fonction pure : c'est le seul endroit où elle est vérifiée.

- ~~**R8 · `npm run build` absent du CI.**~~ **Clos.** Le build est le septième contrôle. C'est le
  seul qui assemble le bundle du navigateur, donc le seul capable d'attraper un module serveur qui
  passe côté client — les six autres étaient au vert pendant que le bundle embarquait le module
  d'extraction, prompt OpenRouter compris. Aucun secret à ajouter : `VITE_CONVEX_URL` est lu au
  moment de servir une requête, pas de bâtir le bundle.

- **R9 · Créer une recette hors de tout scan.** L'écran de correction ne sait ajouter une recette
  qu'à un scan existant, ce qui couvre le faux négatif du modèle. Saisir au clavier une page
  illisible sans passer par une photo demande une route de création sans parent et un point d'entrée
  pour la lancer : c'est un flux distinct, écarté du périmètre de T8 et bloquant pour personne.
  `recipes.scanId` est déjà optionnel, et toutes les mutations traitent le cas.

- **R10 · Le plafond dur de la file des photos.** `ILLUSTRATION_WORK_MAX = 500` reste arbitraire. « Afficher 50 de plus » le relève
  par paliers, le serveur écrête, et au plafond l'écran **dit** qu'il est plafonné plutôt que d'offrir
  un bouton inerte. Il dépasse le corpus entier aujourd'hui, donc le mur est théorique. Seuil de
  réexamen explicite : le jour où une section rapporte une troncature à 500, la pagination à curseur
  devient le lot suivant — un compteur exact au-delà demanderait un agrégat par étape de travail.
  `@convex-dev/aggregate` est désormais monté pour les comptes de la vitrine : ajouter des espaces de
  noms par `illustrationStage` serait la suite, pas une installation.

---

## Dépense des spikes

| Banc                        | Dépensé   | Plafond   |
| --------------------------- | --------- | --------- |
| `spike/` — extraction       | 0,472 USD | 5,00 USD  |
| `spike13/` — embellissement | 3,509 USD | 10,00 USD |

Coûts unitaires retenus : **0,0049 USD / 7,1 s** par extraction (prompt v4, mesuré sur 14 appels au
rejeu de T11), **0,03944 USD** par embellissement — soit **7,7×** une extraction. La latence, elle, a
changé avec le prompt : 9,1 s sous `v2`, **9,4 à 26,4 s sous `v4`**, qui demande un re-rendu au lieu
d'une retouche. Ce sont les
chiffres que les deux blocs d'agrégat de l'administration servent à confronter à l'usage réel :
« Tentatives d'extraction » sur `/admin`, « Générations d'images » sur `/admin/illustrations`.

Rien ne borne la dépense **en amont**, et T14 ne prétend pas le contraire : le seau `beautify`
(40 générations par heure) borne les **appels**, jamais les dollars, puisque le prix d'une réponse
n'est connu qu'une fois facturée. Un appel facturé bien au-dessus de la mesure est signalé dans
l'agrégat, et un appel dont le prix n'est pas rapporté y est compté à part — sans quoi le total se
lirait comme exact alors qu'il n'est qu'un plancher. Un budget durable à réservation transactionnelle
serait le seul vrai garde-fou : non construit, faute d'un incident qui en fixe le seuil.

---

## Non retenu

Inchangé, voir la section correspondante du fichier de tâches : cron de surveillance de la file,
conversion HEIC dans le navigateur, fusion de recettes entre plusieurs scans, pagination de la
vitrine, recadrage d'une photo de plat dans le scan, galerie multi-photos, génération d'une photo
quand aucune n'existe, test d'intégration bout en bout du pipeline.
