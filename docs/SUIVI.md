# Suivi d'avancement

État du projet au **2026-08-11**, `main` à `9ab14ff`. Ce fichier dit **où on en est** ; il ne
remplace pas le contenu des tâches, qui reste dans
[`specs/2026-08-08-table-des-recettes-tasks.md`](./superpowers/specs/2026-08-08-table-des-recettes-tasks.md).

Statuts : ✅ fait · ⬜ à faire · ⛔ bloqué.

À mettre à jour à chaque PR mergée, en même temps que la case du fichier de tâches.

---

## Vue d'ensemble

| #       | Titre                                    | P   | Statut | Livré par                   | Preuve                                            |
| ------- | ---------------------------------------- | --- | ------ | --------------------------- | ------------------------------------------------- |
| **T1**  | Spike extraction vision multi-recettes   | P1  | ✅     | PR #1 + rejeu v3 dans PR #5 | `spike/RESULTS.md`                                |
| **T13** | Spike embellissement d'image             | P1  | ✅     | PR #3                       | `spike13/RESULTS.md`                              |
| —       | Socle et vitrine publique                | P1  | ✅     | PR #2                       | `src/routes/index.tsx`, `recette.$slug.tsx`       |
| **T2**  | Schéma Zod source unique + pont Convex   | P1  | ✅     | PR #5                       | `src/lib/recipe-schema.ts`, `convex/schema.ts`    |
| **T3**  | Finalisation atomique avec `attemptId`   | P1  | ✅     | PR #5                       | `convex/extract.ts`, `convex/extract.test.ts`     |
| **T4**  | `requireAdmin` mutations/actions/queries | P1  | ✅     | PR #5                       | `convex/auth.ts`, `convex/rateLimits.ts`          |
| **T5**  | Garde-fou format image + plafond octets  | P1  | ✅     | PR #5                       | `src/lib/compress.ts`, `src/lib/imageHeader.ts`   |
| **T6**  | `raw` canonique + structure optionnelle  | P1  | ✅     | PR #2 (`scale.ts`) + PR #5  | `src/lib/scale.ts`, `spike/replay-fixtures.ts`    |
| **T15** | Contrôles GitHub Actions sur les PR      | P3  | ✅     | PR #4                       | `.github/workflows/ci.yml`                        |
| **T12** | Câbler Convex ↔ Vercel                   | P3  | ✅     | PR #7                       | `vercel.json`, `.github/workflows/preview.yml`    |
| **T7**  | Rétention `purgeAfter`                   | P2  | ✅     | PR #8                       | `convex/retention.ts`, `convex/retention.test.ts` |
| **T8**  | Scan multi-images + écran de correction  | P2  | ⬜     | —                           | `imageStorageIds` borné à 1 à l'entrée            |
| **T9**  | Export automatique versionné dans git    | P2  | ✅     | PR #9                       | `convex/export.ts`, `scripts/backup.ts`           |
| **T10** | Compteurs de file + bouton relancer      | P2  | ✅     | PR #8                       | `convex/admin.ts`, `src/lib/queueStatus.ts`       |
| **T11** | Durcissement de l'appel OpenRouter       | P2  | ✅     | PR #10                      | `convex/schema.ts`, `src/lib/attemptStats.ts`     |
| **T14** | Photo du plat : upload, embellissement   | P2  | ⬜     | —                           | prompt et modèle figés par T13, prêts à reprendre |

**Reste à faire : 2 tâches, ~9 h humaines estimées** (T8 4 h · T14 5 h).

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
- **CI** — six contrôles sur chaque PR, aucun ne dépense d'argent.
- **Sauvegarde** — miroir versionné des recettes dans `backup/`, une par fichier JSON, actualisé
  chaque dimanche à 03 h UTC et commité sur `main`. La restauration a son script et ses tests. Un
  export vide refuse de tourner, pour ne pas effacer le miroir.
- **Déploiement** — production sur https://table-des-recettes.vercel.app, backend Convex
  `fleet-bat-50` (région US East). `vercel.json` porte le build ; poser le label `preview` sur une
  PR crée un backend Convex jetable avec une copie de la base de production et publie un frontend
  derrière la protection de déploiement Vercel.

Ce qui **n'existe pas encore** : la publication d'un brouillon. Aucune écriture de `slug`,
`publishedAt` ni `status: 'published'` n'est implémentée — voir le reliquat R3.

---

## Prochain pas

**T8**, maintenant que T7 et T10 rendent la surface d'administration exploitable au quotidien.

### Chemin principal

1. **T8 · scan multi-images + écran de correction** (4 h) — la grosse pièce. **Y rattacher R3, la
   publication d'un brouillon** : aucune tâche ne la porte, la vitrine reste vide sans elle, et
   l'écran de correction est le seul endroit naturel pour le geste « publier ». C'est aussi T8 qui
   éclatera `src/routes/admin.tsx` en répertoire — T10 a délibérément laissé le fichier plat, le bloc
   de file étant un composant ordinaire déplaçable où l'écran de correction en aura besoin.

### En parallèle, à n'importe quel moment

T14 ne dépend pas du chemin principal.

- **T14 · photo du plat** (5 h) — débloquée : T4 et T5 sont faits, le prompt et le modèle sont figés
  par T13. Seule contrainte : elle finit dans `src/routes/admin/`, donc **pas en même temps que T8
  par la même personne**.

### Le piège d'ordre restant

- **T8 et T14 en même temps** : collision sur `src/routes/admin/`.

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

- **R3 · Publication d'un brouillon.** Aucune tâche ne la porte explicitement. La vitrine lit
  `status: 'published'`, l'ingestion écrit des brouillons, et rien ne fait le pont. À rattacher à
  T8 (écran de correction) au moment de la planifier, sinon la chaîne reste coupée au milieu.

- **R4 · Propriété et blobs orphelins.** Deux scans peuvent théoriquement partager un blob : aucun
  chemin accidentel connu ne le fait, mais une purge ne peut pas prouver l'exclusivité. Un index
  `by_storage_id` sur les tickets ne suffit pas, car les tickets consommés disparaissent après sept
  jours ; un registre durable demanderait une table `scanImages`, un backfill pour l'historique et
  un index distinct pour ne pas affamer le balayage des autres tickets. La suppression du blob d'un
  ticket `too_large` dépend de la même preuve et reste donc exclue. T14 devra trancher cette propriété
  quand `recipes.imageStorageId` aura un écrivain de production. Tout balayage de `_storage` reste
  hors périmètre tant que la liste complète des propriétaires n'est pas garantie.

- **R5 · Repli d'embellissement disponible et chiffré.** `PROMPT_V3` (`spike13/prompt.ts`) supprime
  l'inclinaison partout (7 franchissements sur 8 contre 5) au prix de +23 % de latence. À activer si
  des cadres inclinés apparaissent en usage réel — aucune mesure à refaire.

- **R6 · Pas de remise à zéro d'un scan mort.** Un scan au plafond de tentatives reste terminal ;
  l'administration rend cette limite visible mais ne permet pas de la contourner.

- **R7 · Câblage de l'administration non testé.** Les règles de dérivation de la file sont testées
  dans `src/lib/queueStatus.test.ts`, mais aucun test de composant ne couvre le JSX de `/admin` faute
  d'infrastructure React dédiée.

- **R8 · `npm run build` absent du CI.** Les six contrôles actuels sont tous passés au vert alors que
  le bundle du navigateur embarquait le module d'extraction serveur, prompt OpenRouter compris : seul
  le build l'a attrapé. À ajouter avant qu'un import serveur vers client repasse en silence.

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
