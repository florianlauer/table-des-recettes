# Suivi d'avancement

État du projet au **2026-08-10**, `main` à `0bbc781`. Ce fichier dit **où on en est** ; il ne
remplace pas le contenu des tâches, qui reste dans
[`specs/2026-08-08-table-des-recettes-tasks.md`](./superpowers/specs/2026-08-08-table-des-recettes-tasks.md).

Statuts : ✅ fait · ⬜ à faire · ⛔ bloqué.

À mettre à jour à chaque PR mergée, en même temps que la case du fichier de tâches.

---

## Vue d'ensemble

| #       | Titre                                    | P   | Statut | Livré par                   | Preuve                                               |
| ------- | ---------------------------------------- | --- | ------ | --------------------------- | ---------------------------------------------------- |
| **T1**  | Spike extraction vision multi-recettes   | P1  | ✅     | PR #1 + rejeu v3 dans PR #5 | `spike/RESULTS.md`                                   |
| **T13** | Spike embellissement d'image             | P1  | ✅     | PR #3                       | `spike13/RESULTS.md`                                 |
| —       | Socle et vitrine publique                | P1  | ✅     | PR #2                       | `src/routes/index.tsx`, `recette.$slug.tsx`          |
| **T2**  | Schéma Zod source unique + pont Convex   | P1  | ✅     | PR #5                       | `src/lib/recipe-schema.ts`, `convex/schema.ts`       |
| **T3**  | Finalisation atomique avec `attemptId`   | P1  | ✅     | PR #5                       | `convex/extract.ts`, `convex/extract.test.ts`        |
| **T4**  | `requireAdmin` mutations/actions/queries | P1  | ✅     | PR #5                       | `convex/auth.ts`, `convex/rateLimits.ts`             |
| **T5**  | Garde-fou format image + plafond octets  | P1  | ✅     | PR #5                       | `src/lib/compress.ts`, `src/lib/imageHeader.ts`      |
| **T6**  | `raw` canonique + structure optionnelle  | P1  | ✅     | PR #2 (`scale.ts`) + PR #5  | `src/lib/scale.ts`, `spike/replay-fixtures.ts`       |
| **T15** | Contrôles GitHub Actions sur les PR      | P3  | ✅     | PR #4                       | `.github/workflows/ci.yml`                           |
| **T7**  | Rétention `purgeAfter`                   | P2  | ⬜     | —                           | champs et index posés, logique absente               |
| **T8**  | Scan multi-images + écran de correction  | P2  | ⬜     | —                           | `imageStorageIds` borné à 1 à l'entrée               |
| **T9**  | Export automatique versionné dans git    | P2  | ⬜     | —                           | —                                                    |
| **T10** | Compteurs de file + bouton relancer      | P2  | ⬜     | —                           | bouton nu posé dans `src/routes/admin.tsx`           |
| **T11** | Durcissement de l'appel OpenRouter       | P2  | ⬜     | —                           | `lastAttempt` posé sur le scan, conçu pour déménager |
| **T14** | Photo du plat : upload, embellissement   | P2  | ⬜     | —                           | prompt et modèle figés par T13, prêts à reprendre    |
| **T12** | Câbler Convex ↔ Vercel                   | P3  | ⬜     | —                           | —                                                    |

**Reste à faire : 7 tâches, ~18 h humaines estimées** (T7 1 h · T8 4 h · T9 4 h · T10 1 h ·
T11 1 h · T14 5 h · T12 2 h).

---

## Ce qui tourne aujourd'hui

- **Vitrine publique** — index une colonne groupé par lettre, fiche recette, recalcul de portions,
  recherche tolérante. Lit des recettes publiées.
- **Pipeline d'ingestion** — `/admin` : jeton en `sessionStorage`, sélection de fichier passant par
  `compress.ts`, création de scan, liste brute des scans, bouton d'extraction nu. Un scan traverse
  compression → stockage → appel OpenRouter → brouillons en base, avec `lastAttempt` qui raconte
  l'appel.
- **Deux bancs de spike** — `spike/` (extraction) et `spike13/` (embellissement), hors réseau en CI.
- **CI** — six contrôles sur chaque PR, aucun ne dépense d'argent.

Ce qui **n'existe pas encore** : la publication d'un brouillon. Aucune écriture de `slug`,
`publishedAt` ni `status: 'published'` n'est implémentée — voir le reliquat R3.

---

## Prochain pas

**T7 puis T10**, dans cet ordre, avant T8.

T7 et T10 sont les deux tâches d'une heure qui rendent la surface admin utilisable au quotidien :
sans T7 les photos partent trop tôt, sans T10 un scan bloqué reste invisible. Elles touchent des
zones disjointes de T8 et ne coûtent presque rien.

T8 est la grosse pièce (écran de correction) et partage `src/routes/admin/` avec T10 et T14 — à
séquencer après T10 pour ne pas réécrire l'écran deux fois.

T14 dépend de T4 (fait) et T5 (fait) : elle est **débloquée**, avec prompt et modèle déjà figés par
T13. Elle peut se prendre en parallèle de T8/T9 par quelqu'un qui ne touche pas `admin/`.

---

## Reliquats — hors périmètre des tâches restantes

Ce sont des choses connues, mesurées et non faites. Elles n'ont pas de tâche à elles.

- **R1 · Prompt v4 à écrire.** La liste d'ingrédients déduite (pages sans liste imprimée) contient
  des lignes qui n'en sont pas : `1 mn sur feu doux` sur la page E, et les œufs comptés trois fois.
  v4 doit interdire les durées, les températures et les fractions d'un ingrédient déjà listé. Coût
  d'un rejeu de contrôle chiffré : **0,071 USD**.

- **R2 · Instabilité des étiquettes de section sur la page B.** `Pour la pâte :` entre une passe sur
  deux dans la ligne d'ingrédient. Sans conséquence sur les comptes. Ouvert pour T11 — la corriger
  demande une révision de prompt et un rejeu de plus.

- **R3 · Publication d'un brouillon.** Aucune tâche ne la porte explicitement. La vitrine lit
  `status: 'published'`, l'ingestion écrit des brouillons, et rien ne fait le pont. À rattacher à
  T8 (écran de correction) au moment de la planifier, sinon la chaîne reste coupée au milieu.

- **R4 · Blobs orphelins.** Environ 600 Ko par upload abandonné s'accumulent jusqu'à T7. Le balayage
  de `_storage` n'est sûr qu'avec la liste complète des propriétaires
  (`scans.imageStorageIds`, `recipes.imageStorageId`, `recipes.beautifiedStorageId`).

- **R5 · `convex/convex.config.ts` est un fichier nouveau.** Monter le premier composant Convex
  (`@convex-dev/rate-limiter`) l'a créé. Son effet sur le déploiement est à vérifier **avant** T12.

- **R6 · Repli d'embellissement disponible et chiffré.** `PROMPT_V3` (`spike13/prompt.ts`) supprime
  l'inclinaison partout (7 franchissements sur 8 contre 5) au prix de +23 % de latence. À activer si
  des cadres inclinés apparaissent en usage réel — aucune mesure à refaire.

---

## Dépense des spikes

| Banc                        | Dépensé   | Plafond   |
| --------------------------- | --------- | --------- |
| `spike/` — extraction       | 0,403 USD | 5,00 USD  |
| `spike13/` — embellissement | 2,292 USD | 10,00 USD |

Coûts unitaires retenus, à reprendre en T11 et T14 : **0,0051 USD / 7,5 s** par extraction
(prompt v3), **0,03944 USD / 9,1 s** par embellissement.

---

## Ordre d'exécution restant

```
T7 rétention ──┐
T10 file ──────┼──► T8 multi-images + écran de correction (+ R3 publication)
               │
T9 export ─────┘

T14 illustration (débloquée, parallèle — ne touche pas admin/ avant T8)

T11 durcissement ──► T12 déploiement (après R5)
```

Lanes parallélisables : T9 (`convex/export.ts`) et T14 ne partagent aucun fichier avec T7/T8/T10.
T8, T10 et T14 partagent `src/routes/admin/` — à séquencer ou à coordonner.

---

## Non retenu

Inchangé, voir la section correspondante du fichier de tâches : cron de surveillance de la file,
conversion HEIC dans le navigateur, fusion de recettes entre plusieurs scans, pagination de la
vitrine, recadrage d'une photo de plat dans le scan, galerie multi-photos, génération d'une photo
quand aucune n'existe, test d'intégration bout en bout du pipeline.
