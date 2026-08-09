# La table des recettes

Site personnel de recettes numérisées depuis des magazines et des livres de cuisine. Vitrine
publique non indexée + zone d'administration pour le scan. Stack : TanStack Start (Vercel) +
Convex + OpenRouter.

Documents de référence :

- [`DESIGN.md`](./DESIGN.md) — système de design, source de vérité visuelle
- [`docs/superpowers/specs/2026-08-08-table-des-recettes-design.md`](./docs/superpowers/specs/2026-08-08-table-des-recettes-design.md) — spec technique
- [`docs/superpowers/specs/2026-08-08-table-des-recettes-tasks.md`](./docs/superpowers/specs/2026-08-08-table-des-recettes-tasks.md) — tâches d'implémentation

## Design System

`DESIGN.md` fait foi. Avant d'écrire du CSS ou un composant d'interface, le lire. Résumé
opérationnel :

**Couleur** — papier chaud `--paper: #F7F3EA`, `--surface: #FFFDF8`, `--ink: #2E2723`,
`--ink-muted: #6E645C`, `--ochre: #9A5B2B`, filets `--rule: #C6BDB4` / `--rule-strong: #8A7F74`.
L'ocre sert au filet du masthead, aux lettres de groupe de l'index, à la reliure en tête de page
et au type « plat ». Pas de mode sombre.

**Encres de type** — une couleur par type de plat (`--ink-entree` … `--ink-autre`), résolue en
CSS via `data-type="…"` → `--type-ink`, **jamais** par une correspondance en JavaScript. Elle
n'est portée que par le mot qui nomme le type : colonne droite d'une ligne d'index, ligne de
type d'une fiche, filtre actif. Jamais un aplat, une pastille, une bordure ou un fond de ligne.
Le type reste écrit en toutes lettres — la couleur double l'information, ne la remplace pas.

**Typographie** — Fraunces (display, 500–600) pour titres et noms de recettes ; Atkinson
Hyperlegible Next (400–600) pour tout le reste. Aucun texte fonctionnel sous 15 px. Interdites :
Inter, Roboto, Arial, Helvetica, `system-ui`, Open Sans, Lato, Montserrat, Poppins.

**Échelle typographique** — une seule échelle fluide en `clamp()`, jetons `--type-*`, interpolant
entre 390 px et **plafonnant à 1100 px**. Pas de paliers d'appareil. Ne jamais laisser le desktop
hériter des plus grandes tailles : c'est la surface la plus proche de l'œil, la tablette à 70 cm
est celle qui a besoin du plafond.

**Règle centrale** — *la donnée est typographique, la photo est une illustration.* Environ la
moitié des recettes n'aura jamais d'image.

- `/` est un index **une colonne**, **aucune vignette**, aucune colonne d'images, **aucun numéro
  de ligne**. Groupé par lettre, la lettre seule dans la marge ; l'ordre alphabétique est le seul
  ordre de `/`.
- Recherche **tolérante** : accents, pluriels, et les ingrédients en plus du titre. Si une ligne
  remonte à cause d'un ingrédient, afficher la ligne d'ingrédient qui a produit la correspondance
  — sinon le résultat passe pour un bug. Recherche active : groupes dissous, photos masquées,
  liste plate.
- La photo vit **dans le bloc fileté de sa propre recette**, sous son titre — jamais en planche
  détachée, jamais deux photos côte à côte. Hauteur fixe 200 px desktop / 160 px mobile, largeur
  libre, aucun recadrage automatique du plat, aucune légende.
- Ligne sans photo → ligne normale et complète, **aucun espacement réservé**, aucun cadre vide.
- Recherche textuelle active → toutes les photos disparaissent.
- Aucune photo d'ouverture sur la fiche recette.

**Anti-slop** — pas de dégradé, pas de blob, pas de coin arrondi (sauf `−`/`+` des portions), pas
de carte, pas d'ombre, pas de pictogramme décoratif, pas de loupe dans la recherche, pas de
pastille de filtre, rien de centré.

**Provenance** — le champ n'existe pas. Aucun composant ne doit supposer une source.

## Conventions

- Commits manuels, jamais automatiques. Aucune attribution d'assistant dans les messages de
  commit ni dans les corps de PR.
- Supprimer des fichiers avec `trash`, pas `rm`.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
