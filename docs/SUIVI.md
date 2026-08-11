# Suivi d'avancement

État du projet au **2026-08-11**, `main` à `e6e435f`. Ce fichier dit **où on en est** ; il ne
remplace pas le contenu des tâches, qui reste dans
[`specs/2026-08-08-table-des-recettes-tasks.md`](./superpowers/specs/2026-08-08-table-des-recettes-tasks.md).

Statuts : ✅ fait · ⬜ à faire · ⛔ bloqué.

À mettre à jour à chaque PR mergée, en même temps que la case du fichier de tâches.

---

## Vue d'ensemble

| #       | Titre                                    | P   | Statut | Livré par                   | Preuve                                                    |
| ------- | ---------------------------------------- | --- | ------ | --------------------------- | --------------------------------------------------------- |
| **T1**  | Spike extraction vision multi-recettes   | P1  | ✅     | PR #1 + rejeu v3 dans PR #5 | `spike/RESULTS.md`                                        |
| **T13** | Spike embellissement d'image             | P1  | ✅     | PR #3                       | `spike13/RESULTS.md`                                      |
| —       | Socle et vitrine publique                | P1  | ✅     | PR #2                       | `src/routes/index.tsx`, `recette.$slug.tsx`               |
| **T2**  | Schéma Zod source unique + pont Convex   | P1  | ✅     | PR #5                       | `src/lib/recipe-schema.ts`, `convex/schema.ts`            |
| **T3**  | Finalisation atomique avec `attemptId`   | P1  | ✅     | PR #5                       | `convex/extract.ts`, `convex/extract.test.ts`             |
| **T4**  | `requireAdmin` mutations/actions/queries | P1  | ✅     | PR #5                       | `convex/auth.ts`, `convex/rateLimits.ts`                  |
| **T5**  | Garde-fou format image + plafond octets  | P1  | ✅     | PR #5                       | `src/lib/compress.ts`, `src/lib/imageHeader.ts`           |
| **T6**  | `raw` canonique + structure optionnelle  | P1  | ✅     | PR #2 (`scale.ts`) + PR #5  | `src/lib/scale.ts`, `spike/replay-fixtures.ts`            |
| **T15** | Contrôles GitHub Actions sur les PR      | P3  | ✅     | PR #4                       | `.github/workflows/ci.yml`                                |
| **T12** | Câbler Convex ↔ Vercel                   | P3  | ✅     | PR #7                       | `vercel.json`, `.github/workflows/preview.yml`            |
| **T7**  | Rétention `purgeAfter`                   | P2  | ✅     | PR #8                       | `convex/retention.ts`, `convex/retention.test.ts`         |
| **T8**  | Scan multi-images + écran de correction  | P2  | ✅     | PR #11                      | `convex/recipeAdmin.ts`, `src/routes/admin_.scan.$id.tsx` |
| **T9**  | Export automatique versionné dans git    | P2  | ✅     | PR #9                       | `convex/export.ts`, `scripts/restore.ts`                  |
| **T10** | Compteurs de file + bouton relancer      | P2  | ✅     | PR #8                       | `convex/admin.ts`, `src/lib/queueStatus.ts`               |
| **T11** | Durcissement de l'appel OpenRouter       | P2  | ✅     | PR #10                      | `convex/schema.ts`, `src/lib/attemptStats.ts`             |
| **T14** | Photo du plat : upload, embellissement   | P2  | ⬜     | —                           | prompt et modèle figés par T13, prêts à reprendre         |

**Reste à faire : 1 tâche, ~5 h humaines estimées** (T14).

---

## Ce qui tourne aujourd'hui

- **Vitrine publique** — index une colonne groupé par lettre, fiche recette, recalcul de portions,
  recherche tolérante. Lit des recettes publiées.
- **Pipeline d'ingestion** — `/admin` : jeton en `sessionStorage`, sélection de fichier passant par
  `compress.ts`, création de scan, compteurs de file, lancement ou relance avec verdict réel et
  purge manuelle. Un scan traverse compression → stockage → appel OpenRouter → brouillons en base,
  avec `lastAttempt` qui raconte l'appel ; sa photo suit une échéance de rétention et une purge
  hebdomadaire.
- **Journal des tentatives d'extraction** — une ligne par tentative dans `extractionAttempts`,
  estampillée du modèle, du provider servi, de la version de prompt et de schéma, du coût, de la
  latence et du nombre de réparations. Survit à la purge du scan. `/admin` en rend l'agrégat sous le
  bloc de file, groupé par modèle et version : taux d'échec, échecs par nature, coût moyen et total,
  latence moyenne, volume de correction.
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
correction `/admin/scan/$id` répare ce que le modèle a mal segmenté, et la publication fige le slug
et arme la rétention. **R3 est clos.**

---

## Prochain pas

**T14**, seule tâche restante, et elle ne dépend plus de rien.

- **T14 · photo du plat** (5 h) — débloquée : T4 et T5 sont faits, le prompt et le modèle sont figés
  par T13. Elle écrit dans `src/routes/admin_.scan.$id.tsx` (l'illustration se pose depuis l'écran
  de correction) et devra trancher la propriété des blobs décrite en R4.

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

  T14 devra trancher cette propriété quand `recipes.imageStorageId` aura un écrivain de production.
  Tout balayage de `_storage` reste hors périmètre tant que la liste complète des propriétaires n'est
  pas garantie.

- **R5 · Repli d'embellissement disponible et chiffré.** `PROMPT_V3` (`spike13/prompt.ts`) supprime
  l'inclinaison partout (7 franchissements sur 8 contre 5) au prix de +23 % de latence. À activer si
  des cadres inclinés apparaissent en usage réel — aucune mesure à refaire.

- **R6 · Pas de remise à zéro d'un scan mort.** Un scan au plafond de tentatives reste terminal ;
  l'administration rend cette limite visible mais ne permet pas de la contourner.

- **R7 · Câblage de l'administration non testé.** Les règles de dérivation de la file sont testées
  dans `src/lib/queueStatus.test.ts`, mais aucun test de composant ne couvre le JSX de `/admin` faute
  d'infrastructure React dédiée.

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

---

## Dépense des spikes

| Banc                        | Dépensé   | Plafond   |
| --------------------------- | --------- | --------- |
| `spike/` — extraction       | 0,472 USD | 5,00 USD  |
| `spike13/` — embellissement | 2,292 USD | 10,00 USD |

Coûts unitaires retenus, à reprendre en T14 : **0,0049 USD / 7,1 s** par extraction (prompt v4,
mesuré sur 14 appels au rejeu de T11), **0,03944 USD / 9,1 s** par embellissement. Ce sont les
chiffres que le bloc « Tentatives d'extraction » de `/admin` sert à confronter à l'usage réel.

---

## Non retenu

Inchangé, voir la section correspondante du fichier de tâches : cron de surveillance de la file,
conversion HEIC dans le navigateur, fusion de recettes entre plusieurs scans, pagination de la
vitrine, recadrage d'une photo de plat dans le scan, galerie multi-photos, génération d'une photo
quand aucune n'existe, test d'intégration bout en bout du pipeline.
