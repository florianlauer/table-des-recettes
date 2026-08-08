# Table des recettes — Tâches d'implémentation

Issu de `/plan-eng-review` du 2026-08-08. Chaque tâche découle d'un constat de la review
(Claude ou Codex). Design de référence :
[`2026-08-08-table-des-recettes-design.md`](./2026-08-08-table-des-recettes-design.md).

Priorités : **P1** bloque le démarrage · **P2** doit atterrir dans la même passe · **P3** suite.

---

## Phase 0 — bloquante

- [ ] **T1 · P1 · spike** (human ~2h / CC ~30min) — Valider l'extraction vision multi-recettes
  - **Origine** : Architecture, issue 1 — l'hypothèse centrale du projet n'a jamais été vérifiée
  - **Livrables** : modèle et provider retenus, schéma JSON réel, prompt, réponses brutes
    conservées comme fixtures de test
  - **Vérifier** : 3 photos réelles (mono-recette, multi-recettes recollée, page difficile),
    2 modèles candidats, segmentation et quantités contrôlées à la main

- [ ] **T13 · P1 · spike** (human ~1h / CC ~20min) — Valider l'embellissement d'image
  - **Origine** : ajout de périmètre post-review — même raisonnement que T1, hypothèse non
    vérifiée avant construction d'interface
  - **Livrables** : modèle d'édition retenu, prompt de restauration, verdict sur la routabilité
    via OpenRouter (sa couverture en modèles à sortie image est plus étroite qu'en texte — si le
    modèle n'y est pas, il faut une clé Google directe, donc un second fournisseur)
  - **Vérifier** : sur 2-3 photos de plats prises depuis une page de magazine, le plat, le
    dressage, la vaisselle et les ingrédients visibles sont-ils préservés ? Si le modèle
    réinvente le plat, la fonctionnalité n'a pas de sens

> Rien d'autre ne démarre avant T1, **sauf** les fonctions pures (T6 partiellement, T5) qui ne
> dépendent d'aucun résultat du spike. T13 est indépendant de T1 et peut tourner en parallèle.

---

## Socle — P1

- [ ] **T2 · P1 · schéma** (human ~2h / CC ~20min) — Schéma Zod source unique + pont vers les validateurs Convex
  - **Origine** : Qualité de code, issue 4 + Codex #14 — structure dupliquée à trois endroits,
    et le pont Zod↔Convex n'est pas gratuit
  - **Fichiers** : `src/lib/recipe-schema.ts`, `convex/schema.ts`
  - **Vérifier** : le JSON schema OpenRouter et les types du formulaire dérivent du même Zod ;
    les fixtures du spike se rejouent contre lui ; le choix du pont (`convex-helpers` /
    `zodOutputToConvex`) est explicite, pas implicite

- [ ] **T3 · P1 · convex** (human ~3h / CC ~30min) — Finalisation atomique avec `attemptId`
  - **Origine** : Codex #9, #10, #11 — la sérialisation décrite ne sérialisait rien, les retries
    n'étaient pas idempotents, et le bouton de relance pouvait faire tourner deux workers
  - **Fichiers** : `convex/extract.ts`, `convex/schema.ts`
  - **Vérifier** : l'upload ne planifie rien ; le worker réserve **un** scan à la fois via une
    mutation atomique posant `attemptId` et `startedAt` ; l'écriture des recettes et le passage
    à `done` tiennent dans une seule mutation, rejetée si l'`attemptId` ne correspond plus
  - **Test** : une relance après échec partiel ne crée aucun doublon

- [ ] **T4 · P1 · auth** (human ~1h / CC ~10min) — `requireAdmin` sur mutations, actions **et** queries
  - **Origine** : Codex #12 — les queries Convex sont publiques par défaut ; la garde initiale
    laissait brouillons, compteurs et URLs d'images lisibles par n'importe qui
  - **Fichiers** : `convex/auth.ts`
  - **Vérifier** : jeton valide / invalide / absent, testé sur une query autant que sur une
    mutation ; secret aléatoire fort en variable d'environnement ; rate limit sur extraction et
    relance

- [ ] **T5 · P1 · upload** (human ~1h / CC ~10min) — Garde-fou format image + plafond en octets
  - **Origine** : Modes de panne (HEIC) + Codex #4 — échec silencieux **et facturé** : un HEIC
    ne se décode pas hors Safari, une image vide part au modèle, la réponse est « aucune recette
    détectée » sans indice sur la cause
  - **Fichiers** : `src/lib/compress.ts`
  - **Vérifier** : image valide acceptée ; image non décodable refusée **avant** création du
    scan et tout appel facturé ; plafond en octets en plus du plafond en pixels
  - **Indépendant du spike** — peut démarrer immédiatement

- [ ] **T6 · P1 · ingrédients** (human ~1h / CC ~10min) — `raw` canonique + structure optionnelle
  - **Origine** : Codex #8 — `{quantity, unit, label}` ne sait pas représenter « 2 à 3 gousses »,
    « une boîte de 400 g », « beurre ou margarine », les sous-sections
  - **Fichiers** : `src/lib/recipe-schema.ts`, `src/lib/scale.ts`
  - **Vérifier** : `raw` toujours présent et faisant foi ; le recalcul de portions est
    best-effort et laisse inchangées les lignes sans `quantity` ; arrondis testés avec et sans
    unité

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
  - **Vérifier** : `strict: true` et `require_parameters: true` ; modèle et provider figés ;
    refus et troncatures traités comme des échecs ; modèle, provider, version de prompt/schéma,
    usage, coût et latence journalisés **par tentative**

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
