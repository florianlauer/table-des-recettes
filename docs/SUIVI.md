# Suivi d'avancement

État du projet au **2026-08-11**, `main` à `1a292f4`. Ce fichier dit **où on en est** ; il ne
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
| **T7**  | Rétention `purgeAfter`                   | P2  | ⬜     | —                           | champs et index posés, logique absente            |
| **T8**  | Scan multi-images + écran de correction  | P2  | ⬜     | —                           | `imageStorageIds` borné à 1 à l'entrée            |
| **T9**  | Export automatique versionné dans git    | P2  | ⬜     | —                           | —                                                 |
| **T10** | Compteurs de file + bouton relancer      | P2  | ⬜     | —                           | bouton nu posé dans `src/routes/admin.tsx`        |
| **T11** | Durcissement de l'appel OpenRouter       | P2  | ✅     | —                           | journal `extractionAttempts` + prompt v4          |
| **T14** | Photo du plat : upload, embellissement   | P2  | ⬜     | —                           | prompt et modèle figés par T13, prêts à reprendre |

**Reste à faire : 5 tâches, ~15 h humaines estimées** (T7 1 h · T8 4 h · T9 4 h · T10 1 h ·
T14 5 h).

---

## Ce qui tourne aujourd'hui

- **Vitrine publique** — index une colonne groupé par lettre, fiche recette, recalcul de portions,
  recherche tolérante. Lit des recettes publiées.
- **Pipeline d'ingestion** — `/admin` : jeton en `sessionStorage`, sélection de fichier passant par
  `compress.ts`, création de scan, liste brute des scans, bouton d'extraction nu. Un scan traverse
  compression → stockage → appel OpenRouter → brouillons en base, avec `lastAttempt` qui raconte
  l'appel.
- **Journal des tentatives d'extraction** — une ligne par tentative dans `extractionAttempts`,
  estampillée du modèle, du provider servi, de la version de prompt et de schéma, du coût, de la
  latence et du nombre de réparations. Survit à la purge du scan. `/admin` en rend l'agrégat groupé
  par modèle et version : taux d'échec, échecs par nature, coût moyen et total, latence moyenne,
  volume de correction.
- **Deux bancs de spike** — `spike/` (extraction) et `spike13/` (embellissement), hors réseau en CI.
- **CI** — six contrôles sur chaque PR, aucun ne dépense d'argent.
- **Déploiement** — production sur https://table-des-recettes.vercel.app, backend Convex
  `fleet-bat-50` (région US East). `vercel.json` porte le build ; poser le label `preview` sur une
  PR crée un backend Convex jetable avec une copie de la base de production et publie un frontend
  derrière la protection de déploiement Vercel.

Ce qui **n'existe pas encore** : la publication d'un brouillon. Aucune écriture de `slug`,
`publishedAt` ni `status: 'published'` n'est implémentée — voir le reliquat R3.

---

## Prochain pas

Rien en cours. L'ordre court : **T7 → T10 → T8**. Le reste s'insère où on veut.

### Chemin principal — dans cet ordre, une tâche par PR

1. **T7 · rétention `purgeAfter`** (1 h) — les champs et l'index sont déjà en base, seule la logique
   manque. En premier parce que chaque upload abandonné laisse environ 600 Ko qui ne partiront
   jamais tout seuls (reliquat R4) : la dette grossit à chaque scan tant qu'elle n'est pas là.
2. **T10 · compteurs de file + bouton relancer** (1 h) — le bouton est déjà posé, nu. Sans elle un
   scan bloqué est invisible depuis `/admin`. Avant T8 et pas après, parce que les deux écrivent
   dans `src/routes/admin/` et que T8 réécrirait l'écran une seconde fois.
3. **T8 · scan multi-images + écran de correction** (4 h) — la grosse pièce. **Y rattacher R3, la
   publication d'un brouillon** : aucune tâche ne la porte, la vitrine reste vide sans elle, et
   l'écran de correction est le seul endroit naturel pour le geste « publier ».

### En parallèle, à n'importe quel moment

Aucune des trois ne dépend du chemin principal ni des autres.

- **T14 · photo du plat** (5 h) — débloquée : T4 et T5 sont faits, le prompt et le modèle sont figés
  par T13. Seule contrainte : elle finit dans `src/routes/admin/`, donc **pas en même temps que T8
  par la même personne**.
- **T9 · export versionné dans git** (4 h) — vit dans `convex/export.ts`, ne partage aucun fichier
  avec le reste.

### Les deux pièges d'ordre

- **T8 avant T10** : même écran, écrit deux fois.
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

- **R4 · Blobs orphelins.** Environ 600 Ko par upload abandonné s'accumulent jusqu'à T7. Le balayage
  de `_storage` n'est sûr qu'avec la liste complète des propriétaires
  (`scans.imageStorageIds`, `recipes.imageStorageId`, `recipes.beautifiedStorageId`).

- **R5 · Repli d'embellissement disponible et chiffré.** `PROMPT_V3` (`spike13/prompt.ts`) supprime
  l'inclinaison partout (7 franchissements sur 8 contre 5) au prix de +23 % de latence. À activer si
  des cadres inclinés apparaissent en usage réel — aucune mesure à refaire.

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
