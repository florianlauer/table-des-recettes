# Table des recettes — Tâches d'implémentation

Issu de `/plan-eng-review` du 2026-08-08. Chaque tâche découle d'un constat de la review
(Claude ou Codex). Design de référence :
[`2026-08-08-table-des-recettes-design.md`](./2026-08-08-table-des-recettes-design.md).

Priorités : **P1** bloque le démarrage · **P2** doit atterrir dans la même passe · **P3** suite.

---

## Phase 0 — bloquante

- [ ] **T1 · P1 · spike** (human ~2h / CC ~30min) — Valider l'extraction vision multi-recettes
  - **Origine** : Architecture, issue 1 — l'hypothèse centrale du projet n'a jamais été vérifiée
  - **Méthode** : échelle du moins cher au meilleur. On ne compare pas des candidats en
    parallèle, on monte les échelons jusqu'au premier qui passe et on s'arrête. L'échelon le
    plus bas est le modèle le moins cher supportant **simultanément** vision et sortie
    structurée stricte — beaucoup de modèles bon marché ne cochent qu'une des deux cases
  - **Jeu d'essai** : 3 photos réelles — mono-recette, multi-recettes recollée, page difficile
  - **Critères de succès** : nombre de recettes détectées = nombre réel · titre exact ·
    toutes les lignes d'ingrédients présentes, aucune inventée ni fusionnée · étapes complètes
    et dans l'ordre · réponse valide contre le schéma du premier coup
  - **Critère d'arbitrage final** : corriger une recette extraite doit prendre **moins de temps
    que la saisir à la main**. Sinon le modèle est rejeté, quel que soit son prix
  - **Livrables** : modèle et provider retenus (figés en variable d'environnement), schéma JSON
    réel, prompt, réponses brutes conservées comme fixtures de test

- [ ] **T13 · P1 · spike** (human ~1h / CC ~20min) — Valider l'embellissement d'image
  - **Origine** : ajout de périmètre post-review — même raisonnement que T1, hypothèse non
    vérifiée avant construction d'interface
  - **Méthode** : même échelle que T1 — le modèle d'édition le moins cher d'abord, on monte
    seulement s'il échoue
  - **Critère de succès, binaire** : sur 2-3 photos de plats prises depuis une page de magazine,
    le plat est-il reconnaissable comme **le même** ? Dressage, vaisselle et ingrédients visibles
    préservés. Un rendu plus beau montrant un autre plat est un échec, pas un compromis
  - **Livrables** : modèle d'édition retenu (figé en variable d'environnement), prompt de
    restauration, verdict sur la routabilité via OpenRouter (sa couverture en modèles à sortie
    image est plus étroite qu'en texte — si le modèle n'y est pas, il faut une clé Google
    directe, donc un second fournisseur)

> Rien de ce qui **dépend du résultat de l'extraction** ne démarre avant T1 : le formulaire de
> correction, la file de traitement des scans, le schéma d'extraction lui-même. T13 est
> indépendant de T1 et peut tourner en parallèle.

**Arbitrage du 2026-08-09 — ce que T1 ne bloque pas.** La règle initiale (« rien d'autre ne
démarre avant T1, sauf les fonctions pures ») a été remplacée après découpage en quatre plans
d'exécution. Le **socle et la vitrine** — scaffold, schéma Convex des recettes publiées, index,
fiche, recalcul de portions, recherche — ne consomment aucun résultat du spike : ils lisent des
recettes déjà validées, quelle que soit la façon dont elles ont été extraites. Les faire attendre
T1 sérialisait deux travaux indépendants sans réduire aucun risque. Ils démarrent donc en
parallèle, et c'est le plan `docs/superpowers/plans/2026-08-08-socle-et-vitrine/PLAN.md` qui les
porte.

**Corollaire sur T2.** Le schéma Zod source unique reste la source de vérité pour l'extraction,
mais il est désormais **rattaché au plan d'ingestion**, pas au socle : sa forme est déterminée
par ce que le modèle retenu en T1 sait réellement produire, et la figer avant le spike reviendrait
à la réécrire après. Le plan socle crée donc `convex/schema.ts` directement, en assumant qu'il
sera la cible du pont Zod↔Convex quand T2 s'exécutera. `src/lib/recipe-schema.ts` reste un
livrable de T2, hors du socle.

---

## Socle — P1

> **Répartition entre plans.** T2, T3 et T4 appartiennent au **plan d'ingestion** et attendent
> T1. T5 et T6 sont des fonctions pures, indépendantes du spike. `src/lib/scale.ts` (recalcul de
> portions, moitié de T6) est livré par le **plan socle et vitrine**, qui en a besoin pour la
> fiche recette ; T6 ne fait alors que le rejouer contre les fixtures du spike.

- [x] **T2 · P1 · schéma · plan d'ingestion** (human ~2h / CC ~20min) — Schéma Zod source unique + pont vers les validateurs Convex
  - **Origine** : Qualité de code, issue 4 + Codex #14 — structure dupliquée à trois endroits,
    et le pont Zod↔Convex n'est pas gratuit
  - **Ordre** : s'exécute **après** T1 et **après** le plan socle. `convex/schema.ts` existe déjà
    à ce moment-là — le socle l'a créé pour la vitrine ; T2 ne le crée pas, il le fait **dériver**
    du Zod et vérifie que la forme obtenue est identique à celle déjà en base
  - **Fichiers** : `src/lib/recipe-schema.ts` (création), `convex/schema.ts` (refonte en dérivé)
  - **Vérifier** : le JSON schema OpenRouter et les types du formulaire dérivent du même Zod ;
    les fixtures du spike se rejouent contre lui ; le choix du pont (`convex-helpers` /
    `zodOutputToConvex`) est explicite, pas implicite
  - **Attention** : `searchText` est un champ **dénormalisé côté Convex uniquement** — titre +
    `raw` des ingrédients, normalisé sans accents, recalculé à chaque écriture. Il ne fait pas
    partie du schéma d'extraction Zod et ne doit jamais être demandé au modèle

- [x] **T3 · P1 · convex** (human ~3h / CC ~30min) — Finalisation atomique avec `attemptId`
  - **Origine** : Codex #9, #10, #11 — la sérialisation décrite ne sérialisait rien, les retries
    n'étaient pas idempotents, et le bouton de relance pouvait faire tourner deux workers
  - **Fichiers** : `convex/extract.ts`, `convex/schema.ts`
  - **Vérifier** : l'upload ne planifie rien ; le worker réserve **un** scan à la fois via une
    mutation atomique posant `attemptId` et `startedAt` ; l'écriture des recettes et le passage
    à `done` tiennent dans une seule mutation, rejetée si l'`attemptId` ne correspond plus
  - **Test** : une relance après échec partiel ne crée aucun doublon

- [x] **T4 · P1 · auth** (human ~1h / CC ~10min) — `requireAdmin` sur mutations, actions **et** queries
  - **Origine** : Codex #12 — les queries Convex sont publiques par défaut ; la garde initiale
    laissait brouillons, compteurs et URLs d'images lisibles par n'importe qui
  - **Fichiers** : `convex/auth.ts`
  - **Vérifier** : jeton valide / invalide / absent, testé sur une query autant que sur une
    mutation ; secret aléatoire fort en variable d'environnement ; rate limit sur extraction et
    relance

- [x] **T5 · P1 · upload** (human ~1h / CC ~10min) — Garde-fou format image + plafond en octets
  - **Origine** : Modes de panne (HEIC) + Codex #4 — échec silencieux **et facturé** : un HEIC
    ne se décode pas hors Safari, une image vide part au modèle, la réponse est « aucune recette
    détectée » sans indice sur la cause
  - **Fichiers** : `src/lib/compress.ts`
  - **Vérifier** : image valide acceptée ; image non décodable refusée **avant** création du
    scan et tout appel facturé ; plafond en octets en plus du plafond en pixels
  - **Indépendant du spike** — peut démarrer immédiatement

- [x] **T6 · P1 · ingrédients** (human ~1h / CC ~10min) — `raw` canonique + structure optionnelle
  - **Origine** : Codex #8 — `{quantity, unit, label}` ne sait pas représenter « 2 à 3 gousses »,
    « une boîte de 400 g », « beurre ou margarine », les sous-sections
  - **Fichiers** : `src/lib/recipe-schema.ts`, `src/lib/scale.ts`
  - **Vérifier** : `raw` toujours présent et faisant foi ; le recalcul de portions est
    best-effort et laisse inchangées les lignes sans `quantity` ; arrondis testés avec et sans
    unité

> **État réellement provisionné avant T2–T6.** PR #2 avait déjà créé les tables `scans` et
> `recipes`, les champs de lease et de rétention, le tableau `imageStorageIds`, les champs
> d'embellissement et la frontière d'écriture `withSearchText()`. Le spike avait déjà livré le Zod,
> le JSON Schema dérivé et 101 fixtures en succès ; le socle avait déjà livré `scale.ts` et ses
> tests. Cette passe a verrouillé et relié ces éléments au lieu de les recréer.

---

## Fonctionnel — P2

- [ ] **T7 · P2 · photos** (human ~1h / CC ~10min) — Rétention `purgeAfter` au lieu de suppression immédiate
  - **Origine** : Tension cross-model 1 — le cas « le modèle voit 2 recettes sur 3 » est un
    succès partiel, indétectable, et la photo partait avant qu'on puisse s'en rendre compte
  - **Fichiers** : `convex/recipes.ts`, `convex/schema.ts`
  - **Vérifier** : `purgeAfter` posé seulement quand plus aucune recette du scan n'est en
    `review` ; purge effective à l'expiration ; purge manuelle possible depuis l'admin

- [ ] **T8 · P2 · scans** (human ~4h / CC ~45min) — Scan multi-images + ajout/suppression de recettes
  - **Origine** : Codex #6 et #7 — cardinalité fausse (recette à cheval sur deux pages
    impossible) et aucune opération structurelle dans l'écran de correction
  - **Fichiers** : `convex/schema.ts`, `src/routes/admin/`
  - **Vérifier** : un scan porte 1 à N images envoyées ensemble au modèle ; l'écran de
    correction permet d'ajouter une recette manquée et de supprimer un faux positif

- [ ] **T9 · P2 · sauvegarde** (human ~4h / CC ~40min) — Export automatique versionné dans git
  - **Origine** : Codex #17 — aucune stratégie de sauvegarde ; l'offre gratuite Convex ne garde
    que 7 jours, en manuel. Après purge des photos, les corrections sont la seule copie
  - **Fichiers** : `convex/export.ts`
  - **Vérifier** : export JSON des recettes publiées, commité dans un dépôt ; historique lisible
    recette par recette

- [ ] **T10 · P2 · file** (human ~1h / CC ~10min) — Compteurs `pending`/`extracting` + bouton lancer/relancer
  - **Origine** : Architecture, issue 2 — sans cron de surveillance (choix assumé), le blocage
    doit rester visible sans effort, sinon le bouton ne sert à rien
  - **Fichiers** : `src/routes/admin/file`
  - **Vérifier** : un scan bloqué est visible sans action de ta part ; le bouton relance la file

- [ ] **T11 · P2 · extraction** (human ~1h / CC ~10min) — Durcissement de l'appel OpenRouter
  - **Origine** : Codex #15 — la sortie structurée garantit la forme, pas la vérité
  - **Fichiers** : `convex/extract.ts`
  - **Vérifier** : `strict: true` et `require_parameters: true` ; modèle et provider figés en
    variable d'environnement ; refus et troncatures traités comme des échecs ; modèle, provider,
    version de prompt/schéma, usage, coût et latence journalisés **par tentative**
  - **Pourquoi la journalisation compte ici** : c'est elle qui dira, après quelques dizaines de
    recettes, si le modèle bon marché retenu au spike tient en usage réel. Si le taux d'échec ou
    le volume de correction dérive, on monte d'un échelon en changeant la variable — les
    fixtures du spike servent de non-régression

- [ ] **T14 · P2 · illustration** (human ~5h / CC ~1h) — Photo du plat : upload, embellissement, validation
  - **Origine** : ajout de périmètre post-review
  - **Fichiers** : `convex/schema.ts`, `convex/beautify.ts`, `src/routes/admin/recette/$id`,
    `src/routes/recette/$slug`
  - **Dépend de** : T13 (verdict du spike), T5 (garde-fou de format, réutilisé tel quel),
    T4 (`requireAdmin` et rate limit)
  - **Vérifier** :
    - l'originale est stockée définitivement et n'est jamais purgée
    - le résultat est un **candidat** : rien n'apparaît en vitrine tant que `beautifiedAccepted`
      est faux
    - écran de comparaison avant/après, avec accepter / rejeter / régénérer
    - un rejet supprime le candidat et laisse l'originale intacte
    - une finalisation portant un `beautifyAttemptId` périmé est rejetée
    - la vitrine gère les trois cas : version acceptée, originale seule, aucune image
  - **Attention coût** : une génération d'image coûte nettement plus qu'une extraction de texte.
    Aucune reprise automatique, régénération toujours déclenchée à la main.

---

## Intendance — P3

- [ ] **T12 · P3 · déploiement** (human ~2h / CC ~20min) — Câbler Convex ↔ Vercel, previews comprises
  - **Origine** : Codex #3 — absent de la spec initiale
  - **Fichiers** : `package.json`, config Vercel
  - **Vérifier** : `npx convex deploy --cmd 'npm run build'` ; clés de déploiement production et
    preview distinctes ; variables d'environnement configurées sur les backends de preview, qui
    sont **vides et séparés**

---

## Ordre d'exécution

```
T1 spike extraction ──┐          T13 spike embellissement (parallèle, indépendant)
   │                  │                        │
   ├──► T5, T6  ──────┤   (fonctions pures, démarrables tout de suite)
   │                  │                        │
   └──► T2 schéma ──► T3 extraction atomique ──► T4 auth
                                  │                        │
                                  ├──► T7 rétention ──┐    │
                                  ├──► T8 multi-images├──► T10 file ──► T11 durcissement
                                  └──► T9 export ─────┘    │
                                                           └──► T14 illustration
                                                                      │
                                                                      └──► T12 déploiement
```

Lanes parallélisables : `src/lib/` (T5, T6) est indépendant de `convex/`. Les deux spikes (T1 et
T13) portent sur des hypothèses distinctes et tournent en parallèle. Une fois T2–T4 posés, T7,
T8 et T9 touchent des zones disjointes et peuvent avancer en parallèle. T8, T10 et T14 partagent
`src/routes/admin/` — à séquencer ou à coordonner.

## Non retenu

Cron de surveillance de la file, conversion HEIC dans le navigateur, fusion de recettes entre
plusieurs scans, pagination de la vitrine, recadrage d'une photo de plat dans le scan (upload
séparé retenu), galerie multi-photos par recette, génération d'une photo quand aucune n'existe,
test d'intégration bout en bout du pipeline (signalé par Codex, périmètre de test délibérément
restreint — à reconsidérer si le pipeline casse en usage).
