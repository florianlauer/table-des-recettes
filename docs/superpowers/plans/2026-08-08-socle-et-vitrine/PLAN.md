# Socle et vitrine publique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monter le squelette du projet et livrer les deux surfaces publiques — l'index `/` et la fiche `/recette/$slug` — navigables sur des données de seed, conformes à `DESIGN.md`.

**Architecture:** TanStack Start en SSR sert deux routes qui lisent Convex via TanStack Query. Toute la logique métier (normalisation, recherche, recalcul de portions, groupement alphabétique, choix d'image) vit dans des fonctions **pures** sous `src/lib/`, testées en TDD et importées aussi bien par les composants React que par les fonctions Convex. Les fonctions Convex ne font que lire la base et assembler ; elles ne calculent rien de métier.

**Tech Stack:** TanStack Start 1.168+ (React), Convex 1.43+, TanStack Query 5 via `@convex-dev/react-query`, Vitest 4 en environnement `edge-runtime`, `convex-test` pour les fonctions Convex, Zod 4 pour les search params. CSS écrit à la main, pas de Tailwind.

## Global Constraints

- **Node 22** (fourni par `devenv.nix`). Gestionnaire de paquets : **npm**.
- **Pas de Tailwind, pas de framework CSS.** Le scaffold est généré avec `--blank` précisément pour ça.
- **Polices** : `Fraunces` (display) et `Atkinson Hyperlegible Next` (texte courant), toutes deux variables 400–700, chargées depuis Google Fonts. **Interdites** : Inter, Roboto, Arial, Helvetica, `system-ui`, Open Sans, Lato, Montserrat, Poppins.
- **Aucun texte fonctionnel sous 15 px.**
- **Une seule échelle typographique fluide**, jetons `--type-*` en `clamp()`, plafonnée à 1100 px. Le desktop hérite du plafond ; il ne reçoit **jamais** de taille supérieure à la tablette.
- **Palette, valeurs exactes** : `--paper: #F8F8F8`, `--surface: #FFFFFF`, `--ink: #2E2723`, `--ink-muted: #6E645C`, `--ochre: #9A5B2B`, `--ochre-hover: #7C4720`, `--on-ochre: #FFFFFF`, `--rule: #C6BDB4`, `--rule-strong: #8A7F74`, `--focus: #9A5B2B`.
- **Anti-slop, sans exception** : pas de dégradé, pas de blob, pas de faux grain de papier, pas d'ombre, pas de coin arrondi (sauf `−`/`+` du sélecteur de portions), pas de carte, pas de pictogramme décoratif, pas de loupe dans le champ de recherche, pas de pastille de filtre, rien de centré.
- **Aucune vignette, aucun numéro de ligne** dans l'index. La marge gauche ne porte que la lettre de groupe.
- **Aucune provenance.** Aucun champ, aucun composant, aucune donnée de seed ne doit mentionner un magazine, un livre ou une source.
- **Pas de mode sombre.**
- **Tests** : périmètre étroit et délibéré. On teste les fonctions pures et les fonctions Convex. **Pas de tests de composants d'affichage, pas de tests end-to-end** — c'est une décision de la spec, pas un oubli.
- **Vocabulaire** : les termes canoniques sont ceux de [`CONTEXT.md`](../../../../CONTEXT.md) — coupure, scan, **brouillon**, **recette publiée**, slug, ligne brute, annotation, recalcul de portions, vitrine, groupe, embellissement. Ne pas introduire de synonyme.
- **Frontière de lecture** : les queries publiques rendent un type `PublishedRecipe` où `slug: string` est **obligatoire**, jamais un document Convex brut — voir [ADR 0001](../../../adr/0001-frontiere-de-lecture-brouillon-publie.md). Une recette publiée sans slug **lève**, elle ne dégrade pas.
- **Arrondi du recalcul de portions**, trois paliers : au-dessus de 10 → entier ; de 1 à 10 → demi ; en dessous de 1 → quart, avec un plancher à `0,25`. Une ligne **dénombrable** (sans unité) reste arrondie à l'entier, minimum 1.
- **Accord du singulier** : quand la quantité recalculée est inférieure à 2, le mot qui suit le nombre est mis au singulier. Une liste d'invariables français (`noix`, `pois`, `ananas`, …) protège les mots déjà singuliers qui se terminent par `s` ou `x`.
- **Recherche** : `.take(1024)`, le plafond dur d'un index de recherche Convex. Le corpus envisagé (~400) reste très en dessous, donc aucun résultat n'est caché en pratique — mais la limite existe, ce n'est pas « aucune troncature possible ». La requête est par ailleurs bornée à 16 termes de 32 caractères, limite imposée par Convex.
- **`searchText` est un champ dérivé** : aucune écriture de recette ne contourne `withSearchText()` de `convex/lib/recipeWrites.ts`. Un titre ou des ingrédients modifiés sans recalcul rendraient des résultats périmés sans le signaler.
- **Le schéma Zod canonique est délibérément reporté.** La spec impose une description Zod unique de la recette (tâche T2) avec un pont explicite vers les validateurs Convex. Son objet est de valider la **sortie du modèle** — il n'y a aucune sortie de modèle dans ce plan. L'écrire ici reviendrait à figer une forme avant d'avoir vu ce que le spike T1 produit réellement. Il appartient au plan d'ingestion, et c'est lui qui devra prouver l'équivalence avec `convex/schema.ts`. La spec a été amendée en conséquence — voir l'« Arbitrage du 2026-08-09 » et le rattachement de T2 dans [`2026-08-08-table-des-recettes-tasks.md`](../../specs/2026-08-08-table-des-recettes-tasks.md).
- **`noUncheckedIndexedAccess` est activé** dans `tsconfig.json` (ajouté à l'exécution de la tâche 6). Indexer un tableau ou un `Record` hors borne rend `undefined` à l'exécution ; sans ce drapeau, le type prétend le contraire et `@typescript-eslint/no-unnecessary-condition` déclare « toujours vrai » des gardes qui sont nécessaires. Toute indexation doit donc être gardée, ou passer par un prédicat de type.
- **Aucun commit automatique.** Les étapes « point d'arrêt » sont des relectures humaines ; le commit reste à la main de l'utilisateur, y compris son message.

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/lib/normalize.ts` | Normalisation texte (accents, ligatures, casse, ponctuation), racinisation, construction de `searchText` |
| `src/lib/slug.ts` | Génération de slug et résolution de collision |
| `src/lib/scale.ts` | Recalcul et formatage des quantités, application à une ligne d'ingrédient |
| `src/lib/groupByLetter.ts` | Tri et regroupement alphabétique de l'index |
| `src/lib/displayImage.ts` | Choix de l'image à afficher parmi originale / embellie / aucune |
| `src/lib/matchReason.ts` | Ligne d'ingrédient expliquant une correspondance de recherche |
| `src/lib/recipeTypes.ts` | Les six types de plat et leurs libellés français |
| `convex/schema.ts` | Tables `scans` et `recipes`, index et index de recherche |
| `convex/recipes.ts` | Queries publiques : liste, compteurs, fiche par slug, recherche |
| `convex/seed.ts` | Mutation interne de peuplement pour le développement |
| `scripts/seed-images.sh` | Attache deux photos locales à deux recettes de seed via le stockage Convex |
| `src/styles/tokens.css` | Jetons de couleur et échelle typographique |
| `src/styles/app.css` | Reset, base typographique, styles des deux surfaces |
| `src/routes/__root.tsx` | Coquille HTML, polices, providers Convex + Query |
| `src/routes/index.tsx` | Surface `/` : masthead, recherche, filtres, index groupé |
| `src/routes/recette.$slug.tsx` | Surface fiche : ingrédients, portions, étapes |

---

### Task 1 : Scaffold TanStack Start et harnais de test

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx` (générés)
- Create: `vitest.config.ts`
- Create: `src/lib/__smoke__.test.ts`

**Interfaces:**
- Consumes: rien
- Produces: un projet qui démarre avec `npm run dev`, et `npm test` qui exécute Vitest en environnement `edge-runtime`

- [ ] **Step 1 : Vérifier que le dépôt est propre**

Le scaffold écrit dans un répertoire non vide. Tout doit être committé pour pouvoir inspecter puis annuler ce qu'il touche.

Run: `git status --short`
Expected: aucune sortie.

- [ ] **Step 2 : Générer le scaffold**

`--blank` est délibéré : il exclut Tailwind, les devtools et les pages de démonstration. `--deployment nitro` est l'adaptateur qui sert Vercel. `--no-git` parce que le dépôt existe déjà.

```bash
npx --yes create-start-app@latest . \
  --framework React \
  --blank \
  --package-manager npm \
  --deployment nitro \
  --toolchain eslint \
  --no-git \
  --no-examples \
  --no-intent \
  --force
```

- [ ] **Step 3 : Inspecter ce que le scaffold a touché**

Run: `git status --short && ls src src/routes`

Expected : `package.json`, `vite.config.ts`, `tsconfig.json`, `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx` créés. **Vérifier en particulier `.gitignore` et `README.md`** : si le scaffold les a écrasés, restaurer nos versions avec `git checkout -- .gitignore README.md`.

Si l'arborescence générée diffère de celle listée ci-dessus, **adapter les chemins dans toutes les tâches suivantes** — le générateur évolue, ce plan ne peut pas le figer.

- [ ] **Step 4 : Vérifier que le serveur de développement démarre**

Run: `npm run dev`
Expected: le serveur écoute, la page d'accueil répond en HTTP 200. Arrêter avec Ctrl-C.

- [ ] **Step 5 : Installer le harnais de test**

Un seul environnement `edge-runtime` pour tout : il convient aux fonctions pures et il est **obligatoire** pour `convex-test`. Deux environnements compliqueraient la configuration sans rien apporter.

```bash
npm install --save-dev vitest@^4 @edge-runtime/vm@^5 convex-test@^0.0.55
```

- [ ] **Step 6 : Écrire la configuration Vitest**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
  },
});
```

- [ ] **Step 7 : Ajouter le script de test**

Dans `package.json`, ajouter à `scripts` :

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 8 : Écrire un test de fumée**

```ts
// src/lib/__smoke__.test.ts
import { expect, test } from "vitest";

test("le harnais de test fonctionne", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 9 : Exécuter les tests**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 10 : Point d'arrêt — relecture puis commit manuel**

Relire le diff, puis committer **à la main**. Suggestion de message :

```
chore: scaffold tanstack start and vitest harness
```

---

### Task 2 : Jetons de design et polices

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`
- Modify: `src/routes/__root.tsx`

**Interfaces:**
- Consumes: le scaffold de la tâche 1
- Produces: les variables CSS `--paper`, `--surface`, `--ink`, `--ink-muted`, `--ochre`, `--ochre-hover`, `--on-ochre`, `--rule`, `--rule-strong`, `--focus`, `--type-meta`, `--type-control`, `--type-body`, `--type-lead`, `--type-letter`, `--type-section`, `--type-title`, `--type-masthead`, disponibles globalement

- [ ] **Step 1 : Écrire les jetons**

Les valeurs de `clamp()` interpolent entre 390 px et 1100 px de large. Ne pas les recalculer : le commentaire de droite donne les bornes en pixels, c'est le contrat.

```css
/* src/styles/tokens.css */
:root {
  --paper:        #F8F8F8;
  --surface:      #FFFFFF;

  --ink:          #2E2723;
  --ink-muted:    #6E645C;

  --ochre:        #9A5B2B;
  --ochre-hover:  #7C4720;
  --on-ochre:     #FFFFFF;

  --rule:         #C6BDB4;
  --rule-strong:  #8A7F74;
  --focus:        #9A5B2B;

  --type-meta:     clamp(0.9375rem, 0.869rem + 0.282vw, 1.0625rem);  /* 15 → 17 px */
  --type-control:  clamp(1.0625rem, 0.994rem + 0.282vw, 1.1875rem);  /* 17 → 19 px */
  --type-body:     clamp(1.125rem,  0.988rem + 0.563vw, 1.375rem);   /* 18 → 22 px */
  --type-lead:     clamp(1.1875rem, 1.016rem + 0.704vw, 1.5rem);     /* 19 → 24 px */
  --type-letter:   clamp(1.75rem,   1.338rem + 1.69vw,  2.5rem);     /* 28 → 40 px */
  --type-section:  clamp(1.5rem,    1.294rem + 0.845vw, 1.875rem);   /* 24 → 30 px */
  --type-title:    clamp(2.25rem,   1.426rem + 3.38vw,  3.75rem);    /* 36 → 60 px */
  --type-masthead: clamp(2.5rem,    1.401rem + 4.51vw,  4.5rem);     /* 40 → 72 px */

  --serif: Fraunces, Georgia, serif;
  --sans:  "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", sans-serif;

  --margin-w: 88px;
  --page-max: 1100px;
}

@media (max-width: 640px) {
  :root { --margin-w: 44px; }
}
```

- [ ] **Step 2 : Écrire la base**

```css
/* src/styles/app.css */
@import "./tokens.css";

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: var(--type-body);
  line-height: 1.5;
}

a { color: inherit; text-decoration: none; }
a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

img { max-width: 100%; display: block; }

.page {
  max-width: var(--page-max);
  margin: 0 auto;
  padding: 0 1.5rem 4rem;
}
```

- [ ] **Step 3 : Charger les polices et la feuille de style dans la racine**

L'URL a été vérifiée : elle renvoie bien deux familles variables en 400–700. Ne pas la reformuler.

```tsx
// src/routes/__root.tsx — dans la configuration head de la route racine
head: () => ({
  meta: [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { name: "robots", content: "noindex, nofollow" },
    { title: "La table des recettes" },
  ],
  links: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Atkinson+Hyperlegible+Next:wght@400..700&display=swap",
    },
    { rel: "stylesheet", href: appCss },
  ],
}),
```

Avec, en haut du fichier : `import appCss from "../styles/app.css?url";`

Le `noindex, nofollow` n'est pas cosmétique : c'est une décision de cadrage de la spec.

- [ ] **Step 4 : Vérifier visuellement**

Run: `npm run dev`
Expected : le fond est `#F8F8F8` et non blanc pur ; le texte s'affiche en Atkinson Hyperlegible Next et non en police système. Contrôler dans l'inspecteur : `getComputedStyle(document.body).fontFamily` doit commencer par `"Atkinson Hyperlegible Next"`.

- [ ] **Step 5 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff`), puis committer **à la main**. Suggestion de message :

```
feat(design): add design tokens, fonts and base stylesheet
```

---

### Task 3 : Normalisation et jetons de recherche

**Files:**
- Create: `src/lib/normalize.ts`
- Test: `src/lib/normalize.test.ts`

**Interfaces:**
- Consumes: rien
- Produces: `normalizeText(input: string): string`, `stemToken(token: string): string`, `toSearchTokens(input: string): string`, `buildSearchText(title: string, ingredients: readonly { raw: string }[]): string`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// src/lib/normalize.test.ts
import { describe, expect, test } from "vitest";
import { buildSearchText, normalizeText, stemToken, toSearchTokens } from "./normalize";

describe("normalizeText", () => {
  test("retire les accents", () => {
    expect(normalizeText("Crêpes de sarrasin")).toBe("crepes de sarrasin");
  });

  test("décompose les ligatures", () => {
    expect(normalizeText("Œufs à la coque")).toBe("oeufs a la coque");
  });

  test("réduit la ponctuation et les espaces multiples", () => {
    expect(normalizeText("Tarte  fine, aux poireaux !")).toBe("tarte fine aux poireaux");
  });

  test("chaîne vide", () => {
    expect(normalizeText("   ")).toBe("");
  });
});

describe("stemToken", () => {
  test("retire le pluriel des mots de plus de trois lettres", () => {
    expect(stemToken("courgettes")).toBe("courgette");
    expect(stemToken("choux")).toBe("chou");
  });

  test("laisse les mots courts intacts", () => {
    expect(stemToken("aux")).toBe("aux");
    expect(stemToken("des")).toBe("des");
  });
});

describe("toSearchTokens", () => {
  test("singulier et pluriel produisent le même jeton", () => {
    expect(toSearchTokens("Courgettes")).toBe(toSearchTokens("courgette"));
  });
});

describe("buildSearchText", () => {
  test("concatène le titre et les lignes brutes", () => {
    const result = buildSearchText("Riz au lait", [{ raw: "200 g de riz rond" }]);
    expect(result).toContain("riz");
    expect(result).toContain("rond");
  });

  test("un ingrédient devient cherchable au pluriel comme au singulier", () => {
    const result = buildSearchText("Gratin", [{ raw: "3 courgettes" }]);
    expect(result.split(" ")).toContain(toSearchTokens("courgette"));
  });
});
```

- [ ] **Step 2 : Exécuter pour vérifier l'échec**

Run: `npx vitest run src/lib/normalize.test.ts`
Expected: FAIL, « Failed to resolve import "./normalize" ».

- [ ] **Step 3 : Écrire l'implémentation**

La racinisation s'applique **des deux côtés** — au texte indexé et à la requête. C'est ce qui rend le pluriel transparent sans que Convex ait à faire de la morphologie.

```ts
// src/lib/normalize.ts
const LIGATURES: Record<string, string> = { œ: "oe", æ: "ae", Œ: "oe", Æ: "ae" };

export function normalizeText(input: string): string {
  return input
    .replace(/[œæŒÆ]/g, (c) => LIGATURES[c] ?? c)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function stemToken(token: string): string {
  return token.length > 3 ? token.replace(/[sx]$/, "") : token;
}

export function toSearchTokens(input: string): string {
  const normalized = normalizeText(input);
  if (!normalized) return "";
  return normalized.split(" ").map(stemToken).join(" ");
}

export function buildSearchText(
  title: string,
  ingredients: readonly { raw: string }[],
): string {
  return toSearchTokens([title, ...ingredients.map((i) => i.raw)].join(" "));
}

// Convex refuse une requête de recherche au-delà de 16 termes ou 32 caractères par terme.
// Sans ce garde-fou, un copier-coller un peu long fait échouer la query côté serveur.
const MAX_QUERY_TERMS = 16;
const MAX_TERM_LENGTH = 32;

export function toSearchQuery(input: string): string {
  return toSearchTokens(input)
    .split(" ")
    .filter(Boolean)
    .slice(0, MAX_QUERY_TERMS)
    .map((term) => term.slice(0, MAX_TERM_LENGTH))
    .join(" ");
}
```

- [ ] **Step 4 : Exécuter pour vérifier le succès**

Run: `npx vitest run src/lib/normalize.test.ts`
Expected: PASS, suite verte, aucun test ignoré.

- [ ] **Step 5 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff src/lib/normalize.ts src/lib/normalize.test.ts`), puis committer **à la main**. Suggestion de message :

```
feat(lib): add text normalization and search tokenization
```

---

### Task 4 : Slugs et collisions

**Files:**
- Create: `src/lib/slug.ts`
- Test: `src/lib/slug.test.ts`

**Interfaces:**
- Consumes: `normalizeText` de `src/lib/normalize.ts`
- Produces: `slugify(title: string): string`, `resolveSlugCollision(base: string, existing: readonly string[]): string`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// src/lib/slug.test.ts
import { describe, expect, test } from "vitest";
import { resolveSlugCollision, slugify } from "./slug";

describe("slugify", () => {
  test("met en minuscules et relie par des tirets", () => {
    expect(slugify("Crêpes de sarrasin")).toBe("crepes-de-sarrasin");
  });

  test("décompose les ligatures", () => {
    expect(slugify("Œufs à la coque")).toBe("oeufs-a-la-coque");
  });

  test("absorbe la ponctuation", () => {
    expect(slugify("Poulet basquaise, façon express !")).toBe("poulet-basquaise-facon-express");
  });

  test("titre sans caractère exploitable", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("resolveSlugCollision", () => {
  test("renvoie la base quand elle est libre", () => {
    expect(resolveSlugCollision("tarte", [])).toBe("tarte");
  });

  test("suffixe à partir de 2", () => {
    expect(resolveSlugCollision("tarte", ["tarte"])).toBe("tarte-2");
  });

  test("saute les suffixes déjà pris", () => {
    expect(resolveSlugCollision("tarte", ["tarte", "tarte-2", "tarte-3"])).toBe("tarte-4");
  });

  test("ignore les slugs sans rapport", () => {
    expect(resolveSlugCollision("tarte", ["gratin", "gratin-2"])).toBe("tarte");
  });
});
```

- [ ] **Step 2 : Exécuter pour vérifier l'échec**

Run: `npx vitest run src/lib/slug.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire l'implémentation**

```ts
// src/lib/slug.ts
import { normalizeText } from "./normalize";

export function slugify(title: string): string {
  return normalizeText(title).replace(/ /g, "-");
}

export function resolveSlugCollision(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
```

- [ ] **Step 4 : Exécuter pour vérifier le succès**

Run: `npx vitest run src/lib/slug.test.ts`
Expected: PASS, suite verte, aucun test ignoré.

- [ ] **Step 5 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff src/lib/slug.ts src/lib/slug.test.ts`), puis committer **à la main**. Suggestion de message :

```
feat(lib): add slug generation and collision resolution
```

---

### Task 5 : Recalcul des portions

**Files:**
- Create: `src/lib/scale.ts`
- Test: `src/lib/scale.test.ts`

**Interfaces:**
- Consumes: rien
- Produces: le type `Ingredient`, `servingsFactor(original: number, target: number): number`, `scaleQuantity(quantity: number, factor: number, hasUnit: boolean): number`, `formatQuantity(value: number): string`, `scaleIngredient(ingredient: Ingredient, factor: number): { text: string; scaled: boolean }`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// src/lib/scale.test.ts
import { describe, expect, test } from "vitest";
import {
  formatQuantity,
  scaleIngredient,
  scaleQuantity,
  servingsFactor,
  singularize,
} from "./scale";

describe("servingsFactor", () => {
  test("rapport cible sur origine", () => {
    expect(servingsFactor(4, 6)).toBe(1.5);
  });

  test("origine nulle ou négative neutralise le facteur", () => {
    expect(servingsFactor(0, 6)).toBe(1);
  });
});

describe("scaleQuantity sans unité (dénombrable)", () => {
  test("arrondit à l'entier", () => {
    expect(scaleQuantity(3, 1.5, false)).toBe(5);
  });

  test("ne descend jamais sous 1", () => {
    expect(scaleQuantity(1, 0.25, false)).toBe(1);
  });
});

describe("scaleQuantity avec unité", () => {
  test("au-delà de 10, arrondi à l'entier", () => {
    expect(scaleQuantity(200, 1.5, true)).toBe(300);
  });

  test("de 1 à 10, arrondi au demi", () => {
    expect(scaleQuantity(3, 1.5, true)).toBe(4.5);
  });

  test("sous 1, arrondi au quart", () => {
    expect(scaleQuantity(1, 0.25, true)).toBe(0.25);
    expect(scaleQuantity(1, 0.4, true)).toBe(0.5);
  });

  test("ne descend jamais sous 0,25", () => {
    expect(scaleQuantity(1, 0.01, true)).toBe(0.25);
  });
});

describe("formatQuantity", () => {
  test("un entier reste entier", () => {
    expect(formatQuantity(300)).toBe("300");
  });

  test("un demi utilise la virgule française", () => {
    expect(formatQuantity(4.5)).toBe("4,5");
  });

  test("un quart garde ses deux décimales", () => {
    expect(formatQuantity(0.25)).toBe("0,25");
  });

  test("un demi ne traîne pas de zéro", () => {
    expect(formatQuantity(0.5)).toBe("0,5");
  });
});

describe("singularize", () => {
  test("retire le pluriel régulier", () => {
    expect(singularize("œufs")).toBe("œuf");
    expect(singularize("gousses")).toBe("gousse");
    expect(singularize("choux")).toBe("chou");
  });

  test("les pluriels en -aux réguliers gardent leur radical", () => {
    expect(singularize("poireaux")).toBe("poireau");
    expect(singularize("noyaux")).toBe("noyau");
    expect(singularize("pruneaux")).toBe("pruneau");
  });

  test("protège les invariables français", () => {
    expect(singularize("noix")).toBe("noix");
    expect(singularize("pois")).toBe("pois");
    expect(singularize("ananas")).toBe("ananas");
    expect(singularize("maïs")).toBe("maïs");
    expect(singularize("couscous")).toBe("couscous");
    expect(singularize("houmous")).toBe("houmous");
  });

  test("les mots de trois lettres ou moins sont déjà protégés", () => {
    expect(singularize("os")).toBe("os");
    expect(singularize("riz")).toBe("riz");
    expect(singularize("jus")).toBe("jus");
  });

  test("le seul irrégulier déclaré", () => {
    expect(singularize("bocaux")).toBe("bocal");
  });
});

describe("scaleQuantity — frontières", () => {
  test("exactement 10 reste au demi, au-dessus de 10 on passe à l'entier", () => {
    expect(scaleQuantity(10, 1, true)).toBe(10);
    // Le palier est « au-dessus de 10 », pas « au-dessus de 10,5 » : dès 10,4 on arrondit
    // à l'entier. C'est la contrainte globale du plan, et le seul palier sans demi.
    expect(scaleQuantity(10.4, 1, true)).toBe(10);
    expect(scaleQuantity(10.5, 1, true)).toBe(11);
    expect(scaleQuantity(10.6, 1, true)).toBe(11);
  });

  test("exactement 1 est au demi, juste en dessous est au quart", () => {
    expect(scaleQuantity(1, 1, true)).toBe(1);
    expect(scaleQuantity(0.9, 1, true)).toBe(1);
    expect(scaleQuantity(0.6, 1, true)).toBe(0.5);
  });
});

describe("gardes numériques", () => {
  test("un facteur ou une quantité non finie ne recalcule rien", () => {
    expect(scaleIngredient({ raw: "200 g", quantity: 200, unit: "g" }, NaN).scaled).toBe(false);
    expect(scaleIngredient({ raw: "200 g", quantity: NaN, unit: "g" }, 2).scaled).toBe(false);
    expect(scaleIngredient({ raw: "200 g", quantity: -5, unit: "g" }, 2).scaled).toBe(false);
  });

  test("servingsFactor neutralise les entrées absurdes", () => {
    expect(servingsFactor(0, 6)).toBe(1);
    expect(servingsFactor(4, 0)).toBe(1);
    expect(servingsFactor(NaN, 6)).toBe(1);
  });
});

describe("scaleIngredient", () => {
  test("substitue le nombre dans la ligne brute", () => {
    const result = scaleIngredient(
      { raw: "200 g de farine", quantity: 200, unit: "g" },
      1.5,
    );
    expect(result).toEqual({ text: "300 g de farine", scaled: true });
  });

  test("une ligne sans quantity est laissée intacte", () => {
    const result = scaleIngredient({ raw: "2 à 3 gousses d'ail" }, 2);
    expect(result).toEqual({ text: "2 à 3 gousses d'ail", scaled: false });
  });

  test("gère un nombre décimal écrit à la française", () => {
    const result = scaleIngredient(
      { raw: "1,5 L de lait", quantity: 1.5, unit: "L" },
      2,
    );
    expect(result).toEqual({ text: "3 L de lait", scaled: true });
  });

  test("dénombrable sans unité", () => {
    const result = scaleIngredient({ raw: "3 œufs", quantity: 3 }, 2);
    expect(result).toEqual({ text: "6 œufs", scaled: true });
  });

  test("sous deux, le mot qui suit passe au singulier", () => {
    expect(scaleIngredient({ raw: "3 œufs", quantity: 3 }, 1 / 3).text).toBe("1 œuf");
    expect(scaleIngredient({ raw: "2 gousses d'ail", quantity: 2 }, 0.5).text).toBe(
      "1 gousse d'ail",
    );
  });

  test("un invariable n'est jamais amputé", () => {
    expect(scaleIngredient({ raw: "4 noix", quantity: 4 }, 0.25).text).toBe("1 noix");
    expect(scaleIngredient({ raw: "3 os à moelle", quantity: 3 }, 1 / 3).text).toBe(
      "1 os à moelle",
    );
  });

  test("une unité abrégée n'est pas touchée", () => {
    expect(
      scaleIngredient({ raw: "4 c. à soupe de crème", quantity: 4, unit: "c. à soupe" }, 0.25)
        .text,
    ).toBe("1 c. à soupe de crème");
  });

  test("au-dessus de deux, le pluriel est conservé", () => {
    expect(scaleIngredient({ raw: "2 gousses d'ail", quantity: 2 }, 2).text).toBe(
      "4 gousses d'ail",
    );
  });

  test("quantity annotée mais aucun nombre dans la ligne brute", () => {
    const result = scaleIngredient({ raw: "une pincée de sel", quantity: 1 }, 3);
    expect(result).toEqual({ text: "une pincée de sel", scaled: false });
  });

  test("le premier nombre doit correspondre à l'annotation, sinon on ne touche à rien", () => {
    // « 2 à 3 gousses » annoté 3 : remplacer le 2 fabriquerait « 6 à 3 gousses ».
    expect(scaleIngredient({ raw: "2 à 3 gousses d'ail", quantity: 3 }, 2)).toEqual({
      text: "2 à 3 gousses d'ail",
      scaled: false,
    });
    // Annoté sur la borne BASSE : le nombre correspond, et pourtant il ne faut pas y toucher.
    expect(scaleIngredient({ raw: "2 à 3 gousses d'ail", quantity: 2 }, 2)).toEqual({
      text: "2 à 3 gousses d'ail",
      scaled: false,
    });
    expect(scaleIngredient({ raw: "1 1/2 tasse de farine", quantity: 1 }, 2).scaled).toBe(false);
    expect(scaleIngredient({ raw: "2-3 échalotes", quantity: 2 }, 2).scaled).toBe(false);
    // « 200 g de chocolat à 70 % » annoté 70 : le premier nombre est 200, pas 70.
    expect(
      scaleIngredient({ raw: "200 g de chocolat à 70 %", quantity: 70, unit: "%" }, 2).scaled,
    ).toBe(false);
  });

  test("le pluriel en -aux du jeu de seed survit au recalcul", () => {
    expect(scaleIngredient({ raw: "6 poireaux", quantity: 6 }, 1 / 6).text).toBe("1 poireau");
  });

  test("facteur 1 rend la ligne brute au caractère près", () => {
    expect(scaleIngredient({ raw: "200 g de farine", quantity: 200, unit: "g" }, 1).text).toBe(
      "200 g de farine",
    );
    // Deux pièges que seul le court-circuit `factor === 1` évite : le reformatage du
    // nombre, et l'accord d'une ligne déjà sous deux alors que rien n'a bougé.
    expect(scaleIngredient({ raw: "1,50 L d'eau", quantity: 1.5, unit: "L" }, 1).text).toBe(
      "1,50 L d'eau",
    );
    expect(scaleIngredient({ raw: "1 gousses d'ail", quantity: 1 }, 1).text).toBe(
      "1 gousses d'ail",
    );
  });

  test("l'adjectif antéposé s'accorde avec le nom, et rien au-delà", () => {
    expect(scaleIngredient({ raw: "3 gros œufs", quantity: 3 }, 1 / 3).text).toBe("1 gros œuf");
    expect(scaleIngredient({ raw: "4 petits oignons", quantity: 4 }, 0.25).text).toBe(
      "1 petit oignon",
    );
    // Le mot suivant le nom n'est jamais touché : « poireaux » reste au pluriel.
    expect(scaleIngredient({ raw: "2 tartes aux poireaux", quantity: 2 }, 0.5).text).toBe(
      "1 tarte aux poireaux",
    );
  });

  test("beau, nouveau et vieux prennent leur forme devant voyelle", () => {
    expect(scaleIngredient({ raw: "3 beaux œufs", quantity: 3 }, 1 / 3).text).toBe("1 bel œuf");
    expect(scaleIngredient({ raw: "2 vieux oignons", quantity: 2 }, 0.5).text).toBe(
      "1 vieil oignon",
    );
    // Devant consonne, la forme de base : « un beau chou », pas « un bel chou ».
    expect(scaleIngredient({ raw: "2 beaux choux", quantity: 2 }, 0.5).text).toBe("1 beau chou");
    // `h` aspiré : « haricot » se comporte comme une consonne.
    expect(scaleIngredient({ raw: "4 beaux haricots", quantity: 4 }, 0.25).text).toBe(
      "1 beau haricot",
    );
  });
});
```

- [ ] **Step 2 : Exécuter pour vérifier l'échec**

Run: `npx vitest run src/lib/scale.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire l'implémentation**

La substitution porte sur le **premier nombre de la ligne brute**, pas sur une reconstruction à partir de `unit` et `label` : la formulation d'origine fait foi et doit survivre au recalcul.

```ts
// src/lib/scale.ts
import { normalizeText } from "./normalize";

export type Ingredient = {
  raw: string;
  quantity?: number;
  unit?: string;
  label?: string;
};

const NUMBER_IN_RAW = /\d+(?:[.,]\d+)?/;
// « 2 à 3 gousses », « 2-3 gousses », « 1 1/2 tasse » : le nombre trouvé n'est pas seul.
// Deux formes distinctes : le séparateur suit immédiatement le nombre (`à 3`, `-3`), ou bien
// c'est un nombre mixte et le séparateur n'arrive qu'après le nombre SUIVANT (`1 1/2`).
// Ne garder que la première laissait « 1 1/2 tasse » doubler en « 2 1/2 tasse ».
const RANGE_OR_FRACTION = /^\s*(?:(?:à|a|-|–|\/)\s*\d|\d+\s*\/\s*\d)/i;

// Mots français déjà singuliers qui se terminent par s ou x : les dépluraliser
// donnerait « noi », « poi », « couscou ». La garde de longueur couvre déjà os, riz, jus.
const INVARIABLE_PLURALS = new Set([
  "ananas",
  "anis",
  "brebis",
  "cassis",
  "coulis",
  "couscous",
  "houmous",
  "jus",
  "mais",
  "noix",
  "os",
  "perdrix",
  "poids",
  "pois",
  "radis",
  "riz",
  "roux",
  "souris",
  // Adjectifs invariables terminés par s ou x : « gros » ne devient pas « gro ».
  // `vieux` y figure pour l'usage direct de `singularize`, même si `singularizeHead` le
  // traite plus tôt via `ELIDED_PRENOMINAL`.
  "doux",
  "epais",
  "frais",
  "gros",
  "vieux",
]);

// Pluriels irréguliers. Aucune règle générale en `-aux` : elle casserait « poireaux »
// (→ « poireal ») et « noyaux », qui se dépluralisent très bien en retirant le x.
const IRREGULAR_SINGULARS: Record<string, string> = { bocaux: "bocal" };

// En français presque tous les adjectifs suivent le nom — sauf cet ensemble fermé (taille,
// âge, beauté, qualité). Sans lui, « 3 gros œufs » sous deux donnerait « 1 gro œufs » :
// le premier mot amputé et le nom laissé au pluriel, soit deux fautes pour une.
const PRENOMINAL_ADJECTIVES = new Set([
  "petits", "petites", "grands", "grandes", "gros", "grosses",
  "belles", "bons", "bonnes", "jeunes", "vieilles",
  "nouvelles", "longs", "longues", "demis", "demies",
]);

// Trois de ces adjectifs changent de forme au masculin devant une voyelle : « un bel œuf »,
// pas « un beau œuf ». Les traiter comme les autres remplacerait une faute de nombre par
// une faute de forme, ce qui n'est pas un progrès.
const ELIDED_PRENOMINAL: Record<string, { base: string; beforeVowel: string }> = {
  beaux: { base: "beau", beforeVowel: "bel" },
  nouveaux: { base: "nouveau", beforeVowel: "nouvel" },
  vieux: { base: "vieux", beforeVowel: "vieil" },
};

// `h` volontairement absent : il est aspiré dans « haricots », le mot où le cas se poserait.
const STARTS_WITH_VOWEL = /^[aeiouy]/;

export function servingsFactor(original: number, target: number): number {
  if (!Number.isFinite(original) || !Number.isFinite(target)) return 1;
  if (original <= 0 || target <= 0) return 1;
  return target / original;
}

export function scaleQuantity(quantity: number, factor: number, hasUnit: boolean): number {
  const value = quantity * factor;
  if (!hasUnit) return Math.max(1, Math.round(value));
  if (value > 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 2) / 2;
  return Math.max(0.25, Math.round(value * 4) / 4);
}

export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0$/, "").replace(".", ",");
}

export function singularize(word: string): string {
  const key = normalizeText(word);
  if (INVARIABLE_PLURALS.has(key)) return word;
  const irregular = IRREGULAR_SINGULARS[key];
  if (irregular) return irregular;
  if (word.length > 3 && /[sx]$/i.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Accorde la tête de la queue : les adjectifs antéposés puis le nom, et rien au-delà.
 * S'arrête au premier mot qui n'est pas un adjectif antéposé — c'est le nom.
 */
function singularizeHead(tail: string): string {
  // Le split capturant préserve les espaces d'origine.
  const parts = tail.split(/(\s+)/);
  // Prédicat de type : il sert aussi bien à sauter les séparateurs qu'à écarter le
  // `undefined` d'une indexation hors borne, sans quoi chaque usage devrait le refaire.
  const isWord = (part: string | undefined): part is string =>
    part !== undefined && part !== "" && !/^\s+$/.test(part);

  for (let i = 0; i < parts.length; i += 1) {
    const word = parts[i];
    if (!isWord(word)) continue;

    const elided = ELIDED_PRENOMINAL[normalizeText(word)];
    if (elided) {
      const next = parts.slice(i + 1).find(isWord);
      parts[i] =
        next && STARTS_WITH_VOWEL.test(normalizeText(next)) ? elided.beforeVowel : elided.base;
      continue; // c'est un adjectif : le nom vient après
    }

    parts[i] = singularize(word);
    if (!PRENOMINAL_ADJECTIVES.has(normalizeText(word))) break;
  }
  return parts.join("");
}

function parseFrenchNumber(text: string): number {
  return Number(text.replace(",", "."));
}

export function scaleIngredient(
  ingredient: Ingredient,
  factor: number,
): { text: string; scaled: boolean } {
  const { raw, quantity, unit } = ingredient;
  const unchanged = { text: raw, scaled: false } as const;

  if (quantity === undefined) return unchanged;
  if (!Number.isFinite(quantity) || quantity <= 0) return unchanged;
  if (!Number.isFinite(factor) || factor <= 0) return unchanged;

  // Portions inchangées : la ligne brute fait foi et doit ressortir au caractère près.
  // Sans ce retour, « 1,50 L » deviendrait « 1,5 L » et « 1 gousses » serait accordé,
  // alors que personne n'a touché au sélecteur. `scaled: true` : rien n'a échoué.
  if (factor === 1) return { text: raw, scaled: true };

  const match = NUMBER_IN_RAW.exec(raw);
  if (!match) return unchanged;

  // La ligne brute fait foi. Si le premier nombre ne correspond pas à l'annotation, on ne
  // sait pas lequel remplacer — « 200 g de chocolat à 70 % ».
  if (parseFrenchNumber(match[0]) !== quantity) return unchanged;

  // Et même quand il correspond, il peut n'être que la borne basse d'une plage ou le
  // numérateur d'une fraction : « 2 à 3 gousses » annoté 2 deviendrait « 4 à 3 gousses ».
  const after = raw.slice(match.index + match[0].length);
  if (RANGE_OR_FRACTION.test(after)) return unchanged;

  const value = scaleQuantity(quantity, factor, unit !== undefined);
  const head = raw.slice(0, match.index);
  const tail = raw.slice(match.index + match[0].length);

  return {
    // Le français accorde au singulier sous deux : « 1,5 gousse », pas « 1,5 gousses ».
    text: `${head}${formatQuantity(value)}${value < 2 ? singularizeHead(tail) : tail}`,
    scaled: true,
  };
}
```

**Ce que cette fonction ne fait pas** : elle ne réécrit jamais la **ligne brute** stockée. Elle produit une chaîne d'affichage. La ligne brute reste la donnée qui fait foi, conformément à `CONTEXT.md`.

- [ ] **Step 4 : Exécuter pour vérifier le succès**

Run: `npx vitest run src/lib/scale.test.ts`
Expected: PASS, suite verte, aucun test ignoré.

- [ ] **Step 5 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff src/lib/scale.ts src/lib/scale.test.ts`), puis committer **à la main**. Suggestion de message :

```
feat(lib): add best-effort servings scaling
```

---

### Task 6 : Groupement alphabétique, choix d'image, raison de correspondance

**Files:**
- Create: `src/lib/groupByLetter.ts`, `src/lib/displayImage.ts`, `src/lib/matchReason.ts`, `src/lib/recipeTypes.ts`
- Test: `src/lib/groupByLetter.test.ts`, `src/lib/displayImage.test.ts`, `src/lib/matchReason.test.ts`

**Interfaces:**
- Consumes: `normalizeText` et `toSearchTokens` de `src/lib/normalize.ts`
- Produces: `initialLetter(title: string): string`, `groupByLetter<T extends { title: string }>(items: readonly T[]): LetterGroup<T>[]`, `pickDisplayImage(recipe: RecipeImages): DisplayImage`, `findMatchingIngredient(title: string, ingredients: readonly { raw: string }[], queryTokens: string): string | null`, `RECIPE_TYPES` et `TYPE_LABELS`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// src/lib/groupByLetter.test.ts
import { describe, expect, test } from "vitest";
import { groupByLetter, initialLetter } from "./groupByLetter";

describe("initialLetter", () => {
  test("majuscule de la première lettre normalisée", () => {
    expect(initialLetter("crêpes")).toBe("C");
  });

  test("les accents ne créent pas de groupe séparé", () => {
    expect(initialLetter("Éclairs")).toBe("E");
  });

  test("les ligatures non plus", () => {
    expect(initialLetter("Œufs mimosa")).toBe("O");
  });

  test("un titre commençant par un chiffre tombe dans #", () => {
    expect(initialLetter("4 saisons")).toBe("#");
  });
});

describe("groupByLetter", () => {
  test("liste vide", () => {
    expect(groupByLetter([])).toEqual([]);
  });

  test("trie et regroupe", () => {
    const result = groupByLetter([
      { title: "Gratin dauphinois" },
      { title: "Clafoutis aux cerises" },
      { title: "Crêpes de sarrasin" },
    ]);
    expect(result).toEqual([
      {
        letter: "C",
        items: [{ title: "Clafoutis aux cerises" }, { title: "Crêpes de sarrasin" }],
      },
      { letter: "G", items: [{ title: "Gratin dauphinois" }] },
    ]);
  });

  test("un groupe d'un seul élément est un groupe valide", () => {
    const result = groupByLetter([{ title: "Tartiflette" }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.letter).toBe("T");
  });
});
```

```ts
// src/lib/displayImage.test.ts
import { describe, expect, test } from "vitest";
import { pickDisplayImage } from "./displayImage";

describe("pickDisplayImage", () => {
  test("la version embellie acceptée l'emporte", () => {
    expect(
      pickDisplayImage({
        imageStorageId: "orig",
        beautifiedStorageId: "beau",
        beautifiedAccepted: true,
      }),
    ).toEqual({ kind: "beautified", storageId: "beau" });
  });

  test("un candidat non accepté ne s'affiche jamais", () => {
    expect(
      pickDisplayImage({
        imageStorageId: "orig",
        beautifiedStorageId: "beau",
        beautifiedAccepted: false,
      }),
    ).toEqual({ kind: "original", storageId: "orig" });
  });

  test("originale seule", () => {
    expect(pickDisplayImage({ imageStorageId: "orig", beautifiedAccepted: false })).toEqual({
      kind: "original",
      storageId: "orig",
    });
  });

  test("aucune image", () => {
    expect(pickDisplayImage({ beautifiedAccepted: false })).toBeNull();
  });

  test("candidat accepté mais sans fichier retombe sur l'originale", () => {
    expect(pickDisplayImage({ imageStorageId: "orig", beautifiedAccepted: true })).toEqual({
      kind: "original",
      storageId: "orig",
    });
  });
});
```

```ts
// src/lib/matchReason.test.ts
import { describe, expect, test } from "vitest";
import { toSearchTokens } from "./normalize";
import { findMatchingIngredient } from "./matchReason";

const ingredients = [{ raw: "3 courgettes" }, { raw: "200 g de chorizo" }];

describe("findMatchingIngredient", () => {
  test("rend la ligne d'ingrédient qui explique la correspondance", () => {
    expect(findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("courgette"))).toBe(
      "3 courgettes",
    );
  });

  test("ne rend rien quand le titre explique déjà", () => {
    expect(
      findMatchingIngredient("Gratin de courgettes", ingredients, toSearchTokens("courgette")),
    ).toBeNull();
  });

  test("ne confond pas un fragment de mot", () => {
    expect(findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("riz"))).toBeNull();
  });

  test("requête vide", () => {
    expect(findMatchingIngredient("Gratin", ingredients, "")).toBeNull();
  });
});
```

- [ ] **Step 2 : Exécuter pour vérifier l'échec**

Run: `npx vitest run src/lib/groupByLetter.test.ts src/lib/displayImage.test.ts src/lib/matchReason.test.ts`
Expected: FAIL, trois modules introuvables.

- [ ] **Step 3 : Écrire les implémentations**

```ts
// src/lib/groupByLetter.ts
import { normalizeText } from "./normalize";

export type LetterGroup<T> = { letter: string; items: T[] };

export function initialLetter(title: string): string {
  const first = normalizeText(title).charAt(0);
  return /[a-z]/.test(first) ? first.toUpperCase() : "#";
}

export function groupByLetter<T extends { title: string }>(
  items: readonly T[],
): LetterGroup<T>[] {
  const sorted = [...items].sort((a, b) =>
    normalizeText(a.title).localeCompare(normalizeText(b.title), "fr"),
  );
  const groups: LetterGroup<T>[] = [];
  for (const item of sorted) {
    const letter = initialLetter(item.title);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.items.push(item);
    else groups.push({ letter, items: [item] });
  }
  return groups;
}
```

```ts
// src/lib/displayImage.ts
// Générique sur l'identifiant : côté Convex il s'agit d'un `Id<"_storage">` (une chaîne
// marquée), et `ctx.storage.getUrl` refuse une `string` nue. Élargir ici casserait l'appel.
export type RecipeImages<T extends string = string> = {
  imageStorageId?: T | null;
  beautifiedStorageId?: T | null;
  beautifiedAccepted?: boolean;
};

export type DisplayImage<T extends string = string> =
  | { kind: "beautified"; storageId: T }
  | { kind: "original"; storageId: T }
  | null;

export function pickDisplayImage<T extends string>(recipe: RecipeImages<T>): DisplayImage<T> {
  if (recipe.beautifiedAccepted && recipe.beautifiedStorageId) {
    return { kind: "beautified", storageId: recipe.beautifiedStorageId };
  }
  if (recipe.imageStorageId) {
    return { kind: "original", storageId: recipe.imageStorageId };
  }
  return null;
}
```

```ts
// src/lib/matchReason.ts
import { toSearchTokens } from "./normalize";

export function findMatchingIngredient(
  title: string,
  ingredients: readonly { raw: string }[],
  queryTokens: string,
): string | null {
  const terms = queryTokens.split(" ").filter(Boolean);
  if (terms.length === 0) return null;

  const titleTokens = toSearchTokens(title).split(" ");
  if (terms.every((term) => titleTokens.includes(term))) return null;

  for (const ingredient of ingredients) {
    const tokens = toSearchTokens(ingredient.raw).split(" ");
    if (terms.some((term) => tokens.includes(term))) return ingredient.raw;
  }
  return null;
}
```

```ts
// src/lib/recipeTypes.ts
export const RECIPE_TYPES = [
  "entree",
  "plat",
  "dessert",
  "apero",
  "petitDej",
  "autre",
] as const;

export type RecipeType = (typeof RECIPE_TYPES)[number];

/** Sur une fiche : le type de CETTE recette. Singulier. */
export const TYPE_LABELS: Record<RecipeType, string> = {
  entree: "Entrée",
  plat: "Plat",
  dessert: "Dessert",
  apero: "Apéro",
  petitDej: "Petit-déjeuner",
  autre: "Autre",
};

/** Dans la ligne de filtres : une collection. Pluriel. */
export const TYPE_FILTER_LABELS: Record<RecipeType, string> = {
  entree: "Entrées",
  plat: "Plats",
  dessert: "Desserts",
  apero: "Apéro",
  petitDej: "Petits-déjeuners",
  autre: "Autres",
};
```

- [ ] **Step 4 : Exécuter pour vérifier le succès**

Run: `npx vitest run src/lib/`
Expected: PASS, suite verte, aucun test ignoré.

- [ ] **Step 5 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff src/lib/`), puis committer **à la main**. Suggestion de message :

```
feat(lib): add alphabetical grouping, image selection and match reason
```

---

### Task 7 : Convex — schéma et seed

**Files:**
- Create: `convex/schema.ts`, `convex/seed.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildSearchText` de `src/lib/normalize.ts`, `slugify` et `resolveSlugCollision` de `src/lib/slug.ts`
- Produces: les tables `scans` et `recipes` avec les index `by_status`, `by_purge_after`, `by_status_type`, `by_slug`, `by_scan` et l'index de recherche `search_recipes` ; la mutation interne `seed.run`

- [ ] **Step 1 : Installer et initialiser Convex**

```bash
npm install convex@^1.43
npx convex dev --once
```

La commande demande de se connecter et de créer un projet. Elle écrit `.env.local` avec `CONVEX_DEPLOYMENT` et `VITE_CONVEX_URL`. **Vérifier que `.env.local` est bien ignoré par git** avant tout commit.

- [ ] **Step 2 : Écrire le schéma**

Les deux tables sont définies dès maintenant, y compris les champs que la vitrine n'utilise pas. Les redéfinir plus tard forcerait une migration sur des données réelles.

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const recipeType = v.union(
  v.literal("entree"),
  v.literal("plat"),
  v.literal("dessert"),
  v.literal("apero"),
  v.literal("petitDej"),
  v.literal("autre"),
);

export const ingredient = v.object({
  raw: v.string(),
  quantity: v.optional(v.number()),
  unit: v.optional(v.string()),
  label: v.optional(v.string()),
});

export default defineSchema({
  scans: defineTable({
    imageStorageIds: v.array(v.id("_storage")),
    status: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("done"),
      v.literal("failed"),
    ),
    attemptId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    attempts: v.number(),
    error: v.optional(v.string()),
    purgeAfter: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_purge_after", ["purgeAfter"]),

  recipes: defineTable({
    scanId: v.optional(v.id("scans")),
    title: v.string(),
    slug: v.optional(v.string()),
    type: recipeType,
    servings: v.optional(v.number()),
    ingredients: v.array(ingredient),
    steps: v.array(v.string()),
    searchText: v.string(),
    status: v.union(v.literal("review"), v.literal("published")),
    publishedAt: v.optional(v.number()),
    imageStorageId: v.optional(v.id("_storage")),
    beautifiedStorageId: v.optional(v.id("_storage")),
    beautifiedAccepted: v.boolean(),
    beautifyStatus: v.union(
      v.literal("idle"),
      v.literal("generating"),
      v.literal("review"),
      v.literal("failed"),
    ),
    beautifyAttemptId: v.optional(v.string()),
    beautifyError: v.optional(v.string()),
  })
    .index("by_status_type", ["status", "type"])
    .index("by_slug", ["slug"])
    .index("by_scan", ["scanId"])
    .searchIndex("search_recipes", {
      searchField: "searchText",
      filterFields: ["status", "type"],
    }),
});
```

- [ ] **Step 3 : Écrire le seed**

Le jeu couvre délibérément les cas limites de l'affichage : une recette sans `servings` (pas de sélecteur), des lignes d'ingrédients non recalculables, un titre long, et plusieurs lettres dont un groupe à un seul élément.

Avant le seed, poser la **frontière d'écriture**. `searchText` est un champ dérivé : si une seule mutation modifie un titre ou des ingrédients sans le recalculer, la recherche rend des résultats périmés sans que rien ne le signale. Aucune écriture de recette ne doit contourner ce helper — y compris celles du plan d'ingestion, qui sont bien plus nombreuses.

```ts
// convex/lib/recipeWrites.ts
import { buildSearchText } from "../../src/lib/normalize";

/**
 * Seul point d'entrée autorisé pour écrire le couple (titre, ingrédients).
 * Dérive systématiquement `searchText` : jamais d'insert ni de patch sans passer par ici.
 */
export function withSearchText<
  T extends { title: string; ingredients: readonly { raw: string }[] },
>(fields: T): T & { searchText: string } {
  return { ...fields, searchText: buildSearchText(fields.title, fields.ingredients) };
}
```

```ts
// convex/seed.ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { withSearchText } from "./lib/recipeWrites";
import { resolveSlugCollision, slugify } from "../src/lib/slug";

const RECIPES = [
  {
    title: "Clafoutis aux cerises",
    type: "dessert" as const,
    servings: 6,
    ingredients: [
      { raw: "500 g de cerises", quantity: 500, unit: "g", label: "cerises" },
      { raw: "100 g de farine", quantity: 100, unit: "g", label: "farine" },
      { raw: "3 œufs", quantity: 3, label: "œufs" },
      { raw: "une pincée de sel" },
    ],
    steps: [
      "Préchauffer le four à 180 °C.",
      "Dénoyauter les cerises et les répartir dans un plat beurré.",
      "Mélanger la farine, les œufs et le sel jusqu'à obtenir une pâte lisse.",
      "Verser sur les cerises et enfourner 40 minutes.",
    ],
  },
  {
    title: "Crème de potiron",
    type: "entree" as const,
    servings: 4,
    ingredients: [
      { raw: "800 g de potiron", quantity: 800, unit: "g", label: "potiron" },
      { raw: "1 oignon", quantity: 1, label: "oignon" },
      { raw: "20 cl de crème", quantity: 20, unit: "cl", label: "crème" },
    ],
    steps: [
      "Éplucher et couper le potiron en cubes.",
      "Faire revenir l'oignon émincé, ajouter le potiron et couvrir d'eau.",
      "Cuire 25 minutes, mixer, ajouter la crème.",
    ],
  },
  {
    title: "Crêpes de sarrasin",
    type: "plat" as const,
    servings: 4,
    ingredients: [
      { raw: "250 g de farine de sarrasin", quantity: 250, unit: "g", label: "farine de sarrasin" },
      { raw: "1,5 L d'eau", quantity: 1.5, unit: "L", label: "eau" },
      { raw: "2 à 3 pincées de gros sel" },
    ],
    steps: [
      "Mélanger la farine et le sel.",
      "Verser l'eau progressivement en fouettant.",
      "Laisser reposer deux heures avant de cuire sur une galetière très chaude.",
    ],
  },
  {
    title: "Gratin dauphinois",
    type: "plat" as const,
    servings: 6,
    ingredients: [
      { raw: "1,2 kg de pommes de terre", quantity: 1.2, unit: "kg", label: "pommes de terre" },
      { raw: "50 cl de crème liquide", quantity: 50, unit: "cl", label: "crème liquide" },
      { raw: "1 gousse d'ail", quantity: 1, label: "gousse d'ail" },
      { raw: "noix de muscade" },
    ],
    steps: [
      "Frotter le plat à l'ail.",
      "Émincer les pommes de terre finement, les disposer en couches.",
      "Couvrir de crème, râper la muscade, cuire 1 h 15 à 160 °C.",
    ],
  },
  {
    // Le tableau de vérification de la tâche 9 cherche « courgette » sur le déploiement
    // réel : sans cette recette, le contrôle ne peut pas passer.
    title: "Tian de courgettes",
    type: "plat" as const,
    servings: 4,
    ingredients: [
      { raw: "4 courgettes", quantity: 4, label: "courgettes" },
      { raw: "3 tomates", quantity: 3, label: "tomates" },
      { raw: "2 gousses d'ail", quantity: 2, label: "gousses d'ail" },
      { raw: "huile d'olive" },
      { raw: "thym" },
    ],
    steps: [
      "Émincer les courgettes et les tomates en rondelles fines.",
      "Les ranger debout en alternance dans un plat frotté à l'ail.",
      "Arroser d'huile d'olive, parsemer de thym, cuire 45 minutes à 180 °C.",
    ],
  },
  {
    title: "Gaufres de Liège",
    type: "dessert" as const,
    servings: 8,
    ingredients: [
      { raw: "300 g de farine", quantity: 300, unit: "g", label: "farine" },
      { raw: "150 g de sucre perlé", quantity: 150, unit: "g", label: "sucre perlé" },
      { raw: "2 œufs", quantity: 2, label: "œufs" },
    ],
    steps: ["Pétrir la pâte.", "Incorporer le sucre perlé.", "Cuire au gaufrier 4 minutes."],
  },
  {
    title: "Œufs mimosa",
    type: "apero" as const,
    servings: 4,
    ingredients: [
      { raw: "6 œufs", quantity: 6, label: "œufs" },
      { raw: "3 cuillères à soupe de mayonnaise", quantity: 3, unit: "cuillère à soupe", label: "mayonnaise" },
      { raw: "ciboulette" },
    ],
    steps: ["Cuire les œufs 10 minutes.", "Écraser les jaunes avec la mayonnaise.", "Garnir et parsemer de ciboulette."],
  },
  {
    title: "Poulet basquaise",
    type: "plat" as const,
    servings: 4,
    ingredients: [
      { raw: "4 cuisses de poulet", quantity: 4, label: "cuisses de poulet" },
      { raw: "3 poivrons", quantity: 3, label: "poivrons" },
      { raw: "400 g de tomates concassées", quantity: 400, unit: "g", label: "tomates concassées" },
      { raw: "piment d'Espelette" },
    ],
    steps: [
      "Colorer les cuisses de poulet dans une cocotte.",
      "Ajouter les poivrons émincés et les tomates.",
      "Mijoter 45 minutes à couvert, relever au piment.",
    ],
  },
  {
    title: "Riz au lait vanillé",
    type: "dessert" as const,
    servings: 4,
    ingredients: [
      { raw: "200 g de riz rond", quantity: 200, unit: "g", label: "riz rond" },
      { raw: "1 L de lait entier", quantity: 1, unit: "L", label: "lait entier" },
      { raw: "1 gousse de vanille", quantity: 1, label: "gousse de vanille" },
    ],
    steps: ["Fendre la gousse et infuser dans le lait.", "Verser le riz et cuire 35 minutes à feu doux en remuant."],
  },
  {
    title: "Salade de lentilles au comté",
    type: "entree" as const,
    servings: 4,
    ingredients: [
      { raw: "250 g de lentilles vertes", quantity: 250, unit: "g", label: "lentilles vertes" },
      { raw: "150 g de comté", quantity: 150, unit: "g", label: "comté" },
      { raw: "1 échalote", quantity: 1, label: "échalote" },
    ],
    steps: ["Cuire les lentilles 20 minutes.", "Détailler le comté en dés, ciseler l'échalote.", "Assaisonner tiède."],
  },
  {
    title: "Tarte fine aux poireaux et à la crème de moutarde ancienne",
    type: "plat" as const,
    servings: 6,
    ingredients: [
      { raw: "1 pâte feuilletée", quantity: 1, label: "pâte feuilletée" },
      { raw: "6 poireaux", quantity: 6, label: "poireaux" },
      { raw: "2 cuillères à soupe de moutarde à l'ancienne", quantity: 2, unit: "cuillère à soupe", label: "moutarde à l'ancienne" },
    ],
    steps: ["Émincer et fondre les poireaux 20 minutes.", "Étaler la pâte, tartiner de moutarde, garnir.", "Cuire 25 minutes à 200 °C."],
  },
  {
    title: "Tartiflette",
    type: "plat" as const,
    ingredients: [
      { raw: "1 reblochon" },
      { raw: "1 kg de pommes de terre", quantity: 1, unit: "kg", label: "pommes de terre" },
      { raw: "200 g de lardons", quantity: 200, unit: "g", label: "lardons" },
    ],
    steps: ["Cuire les pommes de terre à l'eau.", "Faire revenir les lardons et les oignons.", "Couvrir du reblochon fendu, gratiner 25 minutes."],
  },
  {
    title: "4 saisons express",
    type: "autre" as const,
    servings: 2,
    ingredients: [{ raw: "ce qui reste dans le réfrigérateur" }],
    steps: ["Assembler.", "Assaisonner."],
  },
];

export const run = internalMutation({
  args: {},
  // `returns: null` est refusé au déploiement : Convex attend un validateur, pas la valeur.
  returns: v.null(),
  handler: async (ctx) => {
    // La garde est une variable d'environnement du déploiement, pas un argument : un argument
    // voyage dans la commande copiée-collée et ne prouve rien sur le backend réellement visé.
    // À poser une seule fois, sur le déploiement de développement :
    //   npx convex env set ALLOW_DESTRUCTIVE_SEED true
    if (process.env.ALLOW_DESTRUCTIVE_SEED !== "true") {
      throw new Error(
        "Seed refusé : ALLOW_DESTRUCTIVE_SEED n'est pas à \"true\" sur ce déploiement.",
      );
    }

    const existing = await ctx.db.query("recipes").collect();
    for (const row of existing) {
      // Supprimer les fichiers avant les documents, sinon ils restent orphelins
      // dans le stockage sans plus aucune référence pour les retrouver.
      if (row.imageStorageId) await ctx.storage.delete(row.imageStorageId);
      if (row.beautifiedStorageId) await ctx.storage.delete(row.beautifiedStorageId);
      await ctx.db.delete(row._id);
    }

    const slugs: string[] = [];
    for (const recipe of RECIPES) {
      const slug = resolveSlugCollision(slugify(recipe.title), slugs);
      slugs.push(slug);
      await ctx.db.insert("recipes", {
        ...withSearchText(recipe),
        slug,
        status: "published",
        publishedAt: Date.now(),
        beautifiedAccepted: false,
        beautifyStatus: "idle",
      });
    }
    return null;
  },
});
```

Le typecheck de `convex/` ne connaît pas `process`, alors que le runtime Convex l'expose. Déclarer **uniquement** ce qui existe, plutôt que de tirer `@types/node` : sinon `fs` et `path` type-checkent et plantent à l'exécution.

```ts
// convex/env.d.ts
declare const process: { env: Record<string, string | undefined> };
```

- [ ] **Step 4 : Exécuter le seed**

Lancer d'abord `npx convex run seed:run` **sans** le drapeau : la commande doit échouer sur « Seed refusé ». C'est la seule preuve que la garde est active.

```bash
npx convex env set ALLOW_DESTRUCTIVE_SEED true
npx convex run seed:run
```

Expected : la commande se termine sans erreur.

- [ ] **Step 5 : Vérifier le contenu de la base**

Run: `npx convex data recipes --limit 3`
Expected : trois lignes, chacune avec un `slug` non vide, un `searchText` sans accent, et `status: "published"`.

- [ ] **Step 6 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff convex/ package.json package-lock.json`), puis committer **à la main**. Suggestion de message :

```
feat(convex): add schema and development seed
```

---

### Task 8 : Convex — queries publiques

**Files:**
- Create: `convex/recipes.ts`
- Test: `convex/recipes.test.ts`

**Interfaces:**
- Consumes: le schéma de la tâche 7, `toSearchTokens` de `src/lib/normalize.ts`, `findMatchingIngredient` de `src/lib/matchReason.ts`
- Produces: `api.recipes.listPublished({ type? })`, `api.recipes.countsByType({})`, `api.recipes.getBySlug({ slug })`, `api.recipes.search({ query, type? })`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// convex/recipes.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const base = {
  status: "published" as const,
  publishedAt: 1,
  beautifiedAccepted: false,
  beautifyStatus: "idle" as const,
  steps: ["Étape unique."],
};

async function withRecipes() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("recipes", {
      ...base,
      title: "Gratin de courgettes",
      slug: "gratin-de-courgettes",
      type: "plat",
      ingredients: [{ raw: "3 courgettes" }],
      searchText: "gratin de courgette 3 courgette",
    });
    await ctx.db.insert("recipes", {
      ...base,
      title: "Riz au lait",
      slug: "riz-au-lait",
      type: "dessert",
      ingredients: [{ raw: "200 g de riz rond" }],
      searchText: "riz au lait 200 g de riz rond",
    });
    await ctx.db.insert("recipes", {
      ...base,
      status: "review",
      title: "Brouillon non publié",
      type: "plat",
      ingredients: [{ raw: "1 courgette" }],
      searchText: "brouillon non publie 1 courgette",
    });
  });
  return t;
}

test("listPublished exclut les brouillons", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.listPublished, {});
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.title)).not.toContain("Brouillon non publié");
});

test("listPublished filtre par type", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.listPublished, { type: "dessert" });
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe("Riz au lait");
});

test("countsByType ne compte que le publié", async () => {
  const t = await withRecipes();
  const counts = await t.query(api.recipes.countsByType, {});
  expect(counts.total).toBe(2);
  expect(counts.byType.plat).toBe(1);
  expect(counts.byType.dessert).toBe(1);
});

test("getBySlug rend la recette publiée", async () => {
  const t = await withRecipes();
  const recipe = await t.query(api.recipes.getBySlug, { slug: "riz-au-lait" });
  expect(recipe?.title).toBe("Riz au lait");
});

test("getBySlug rend null sur un slug inconnu", async () => {
  const t = await withRecipes();
  expect(await t.query(api.recipes.getBySlug, { slug: "inexistant" })).toBeNull();
});

test("le pluriel de la requête trouve le singulier indexé, et le titre suffit à expliquer", async () => {
  const t = await withRecipes();
  const rows = await t.query(api.recipes.search, { query: "courgettes" });
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe("Gratin de courgettes");
  expect(rows[0].matchedIngredient).toBeNull();
});

test("la recherche par ingrédient absent du titre expose la ligne", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("recipes", {
      ...base,
      title: "Gratin du jardin",
      slug: "gratin-du-jardin",
      type: "plat",
      ingredients: [{ raw: "3 courgettes" }],
      searchText: "gratin du jardin 3 courgette",
    });
  });
  const rows = await t.query(api.recipes.search, { query: "courgette" });
  expect(rows[0].matchedIngredient).toBe("3 courgettes");
});

test("une recherche vide ne rend rien", async () => {
  const t = await withRecipes();
  expect(await t.query(api.recipes.search, { query: "   " })).toEqual([]);
});

test("une recette publiée sans slug lève au lieu de dégrader", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("recipes", {
      ...base,
      title: "Invariant rompu",
      type: "plat",
      ingredients: [],
      searchText: "invariant rompu",
    });
  });
  await expect(t.query(api.recipes.listPublished, {})).rejects.toThrow(/sans slug/);
});
```

- [ ] **Step 2 : Exécuter pour vérifier l'échec**

Run: `npx vitest run convex/recipes.test.ts`
Expected: FAIL, `api.recipes` non défini.

- [ ] **Step 3 : Écrire les queries**

Les queries n'appliquent aucune règle métier : elles lisent, résolvent les URLs de fichiers et délèguent le reste aux fonctions pures.

```ts
// convex/recipes.ts
import { v } from "convex/values";
import { query } from "./_generated/server";
// `import/consistent-type-specifier-style` de la config TanStack refuse le `type` inline.
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { recipeType } from "./schema";
import { toSearchQuery } from "../src/lib/normalize";
import { findMatchingIngredient } from "../src/lib/matchReason";
import { pickDisplayImage } from "../src/lib/displayImage";

type StorageCtx = Pick<QueryCtx, "storage">;

/** Une recette publiée telle que la vitrine la voit. `slug` y est obligatoire — voir ADR 0001. */
export type PublishedRecipeSummary = {
  id: string;
  title: string;
  slug: string;
  type: Doc<"recipes">["type"];
  imageUrl: string | null;
};

async function imageUrl(ctx: StorageCtx, doc: Doc<"recipes">): Promise<string | null> {
  const picked = pickDisplayImage({
    imageStorageId: doc.imageStorageId ?? null,
    beautifiedStorageId: doc.beautifiedStorageId ?? null,
    beautifiedAccepted: doc.beautifiedAccepted,
  });
  return picked ? ctx.storage.getUrl(picked.storageId) : null;
}

/**
 * Franchit la frontière brouillon → recette publiée. Une recette publiée sans slug est
 * un invariant rompu : on lève plutôt que de fabriquer un lien mort (ADR 0001).
 */
async function toSummary(ctx: StorageCtx, doc: Doc<"recipes">): Promise<PublishedRecipeSummary> {
  if (!doc.slug) {
    throw new Error(`Recette publiée sans slug : ${doc._id}`);
  }
  return {
    id: doc._id,
    title: doc.title,
    slug: doc.slug,
    type: doc.type,
    imageUrl: await imageUrl(ctx, doc),
  };
}

export const listPublished = query({
  args: { type: v.optional(recipeType) },
  handler: async (ctx, { type }) => {
    const rows = type
      ? await ctx.db
          .query("recipes")
          .withIndex("by_status_type", (q) => q.eq("status", "published").eq("type", type))
          .collect()
      : await ctx.db
          .query("recipes")
          .withIndex("by_status_type", (q) => q.eq("status", "published"))
          .collect();
    return Promise.all(rows.map((doc) => toSummary(ctx, doc)));
  },
});

export const countsByType = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("recipes")
      .withIndex("by_status_type", (q) => q.eq("status", "published"))
      .collect();
    const byType: Record<string, number> = {};
    for (const row of rows) byType[row.type] = (byType[row.type] ?? 0) + 1;
    return { total: rows.length, byType };
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!doc || doc.status !== "published") return null;
    // Le type de sortie n'expose que ce dont la vitrine a besoin : les champs
    // d'administration (scanId, beautifyAttemptId, beautifyError) ne partent jamais au client.
    return {
      ...(await toSummary(ctx, doc)),
      servings: doc.servings ?? null,
      ingredients: doc.ingredients,
      steps: doc.steps,
    };
  },
});

export const search = query({
  args: { query: v.string(), type: v.optional(recipeType) },
  handler: async (ctx, { query: rawQuery, type }) => {
    const tokens = toSearchQuery(rawQuery);
    if (!tokens) return [];
    const rows = await ctx.db
      .query("recipes")
      .withSearchIndex("search_recipes", (s) => {
        const base = s.search("searchText", tokens).eq("status", "published");
        return type ? base.eq("type", type) : base;
      })
      .take(1024);
    return Promise.all(
      rows.map(async (doc) => ({
        ...(await toSummary(ctx, doc)),
        matchedIngredient: findMatchingIngredient(doc.title, doc.ingredients, tokens),
      })),
    );
  },
});
```

- [ ] **Step 4 : Exécuter pour vérifier le succès**

Run: `npx vitest run convex/recipes.test.ts`
Expected: PASS, suite verte, aucun test ignoré.

- [ ] **Step 5 : Régénérer l'API et sortir le généré du linter**

`convex/_generated/api.d.ts` type `api` comme `{}` tant que la CLI n'a pas revu le nouveau
fichier : sans ce passage, `npx tsc --noEmit` échoue sur `Property 'recipes' does not exist`.

Run: `npx convex dev --once`

Puis ajouter `convex/_generated/` aux `ignores` d'`eslint.config.js` — la CLI y dépose des `.js`
absents du projet TypeScript du linter, que le parser typé refuse de lire :

```js
  {
    // `convex/_generated` est régénéré par la CLI et n'est pas dans le projet TypeScript
    // du linter : le parser typé échoue sur ses `.js`.
    ignores: ['eslint.config.js', 'prettier.config.js', 'convex/_generated/'],
  },
```

- [ ] **Step 6 : Exécuter toute la suite**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS, aucune régression sur les tâches 3 à 6, typecheck et lint propres.

- [ ] **Step 7 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff convex/recipes.ts convex/recipes.test.ts`), puis committer **à la main**. Suggestion de message :

```
feat(convex): add public recipe queries with tolerant search
```

---

### Task 9 : Surface `/` — index groupé, filtres, recherche

**Files:**
- Modify: `src/routes/__root.tsx` (providers Convex et Query)
- Modify: `src/routes/index.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: `api.recipes.listPublished`, `api.recipes.countsByType`, `api.recipes.search`, `groupByLetter`, `RECIPE_TYPES`, `TYPE_LABELS`
- Produces: la route `/` avec les search params `q` (string) et `type` (RecipeType), validés par Zod

- [ ] **Step 1 : Installer les dépendances de données**

```bash
npm install @convex-dev/react-query @tanstack/react-query @tanstack/react-router-ssr-query zod@^4
```

- [ ] **Step 2 : Câbler le routeur, par requête**

Deux points sur lesquels une version naïve casse en SSR, et qui ne se voient pas en développement local à un seul utilisateur.

**Le routeur et ses clients sont créés par requête, jamais au niveau module.** Un `QueryClient` créé à l'import est partagé entre toutes les requêtes du serveur : son cache traverse les utilisateurs. Aujourd'hui tout est public et rien ne fuit ; le jour où l'administration arrive, c'est une fuite inter-utilisateurs déjà installée. On l'évite maintenant, pas plus tard.

**`setupRouterSsrQueryIntegration` est ce qui déshydrate et réhydrate le cache.** Sans lui, le loader remplit un cache serveur que le client jette, et la page se re-télécharge intégralement à l'hydratation.

```tsx
// src/router.tsx
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexProvider } from "convex/react";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!convexUrl) throw new Error("VITE_CONVEX_URL absent — lancer `npx convex dev`");

  const convexQueryClient = new ConvexQueryClient(convexUrl);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  });
  convexQueryClient.connect(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>{children}</ConvexProvider>
    ),
  });

  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}
```

Déclarer le type du contexte sur la route racine, sinon les `loader` des tâches 9 et 10 ne voient pas `queryClient` :

```tsx
// src/routes/__root.tsx
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({ /* … voir tâche 2 … */ }),
  component: RootComponent,
});
```

> Le scaffold `--blank` génère peut-être déjà un `src/router.tsx` avec une signature différente. **Adapter à ce qu'il a produit** plutôt que d'écraser : le point non négociable est que routeur, `QueryClient` et `ConvexQueryClient` naissent tous les trois à l'intérieur de la fonction.

- [ ] **Step 3 : Écrire la route**

```tsx
// src/routes/index.tsx
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { groupByLetter } from "../lib/groupByLetter";
import { RECIPE_TYPES, TYPE_FILTER_LABELS, TYPE_LABELS } from "../lib/recipeTypes";

const searchSchema = z.object({
  q: z.string().optional(),
  type: z.enum(RECIPE_TYPES).optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  // Sans ce loader, `useSuspenseQuery` se résout côté client seulement : la page
  // arriverait vide en SSR, ce qui contredit la décision de garder le SSR.
  loaderDeps: ({ search }) => ({ q: search.q, type: search.type }),
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.recipes.countsByType, {}));
    await context.queryClient.ensureQueryData(
      deps.q?.trim()
        ? convexQuery(api.recipes.search, { query: deps.q, type: deps.type })
        : convexQuery(api.recipes.listPublished, { type: deps.type }),
    );
  },
  component: IndexPage,
});

function IndexPage() {
  const { q, type } = Route.useSearch();
  const navigate = Route.useNavigate();
  const searching = Boolean(q && q.trim());

  // Le champ est piloté localement, l'URL suit avec 250 ms de retard. Taper « courgette »
  // ne doit empiler ni neuf entrées d'historique ni neuf abonnements Convex — mais tout
  // remplacer effacerait aussi l'index vide, et le bouton retour quitterait le site au
  // lieu d'y revenir. Seule l'entrée dans la recherche est donc empilée ; les frappes
  // suivantes remplacent.
  const [draft, setDraft] = useState(q ?? "");
  useEffect(() => setDraft(q ?? ""), [q]);
  useEffect(() => {
    const current = q ?? "";
    if (draft === current) return;
    const id = setTimeout(() => {
      navigate({
        search: (prev) => ({ ...prev, q: draft || undefined }),
        replace: current !== "",
      });
    }, 250);
    return () => clearTimeout(id);
  }, [draft, q, navigate]);

  const counts = useSuspenseQuery(convexQuery(api.recipes.countsByType, {})).data;
  const listed = useSuspenseQuery(
    searching
      ? convexQuery(api.recipes.search, { query: q!, type })
      : convexQuery(api.recipes.listPublished, { type }),
  ).data;

  return (
    <main className="page">
      <header className="masthead">
        <h1 className="masthead__title">La table des recettes</h1>
        <p className="masthead__count">{counts.total} recettes</p>
      </header>

      <input
        className="search"
        type="search"
        value={draft}
        placeholder="Rechercher une recette"
        aria-label="Rechercher une recette"
        onChange={(e) => setDraft(e.target.value)}
      />

      <nav className="filters" aria-label="Types de plat">
        <button
          className="filters__item"
          aria-current={type === undefined}
          onClick={() => navigate({ search: (prev) => ({ ...prev, type: undefined }) })}
        >
          Toutes <span className="filters__count">{counts.total}</span>
        </button>
        {RECIPE_TYPES.filter((t) => counts.byType[t]).map((t) => (
          <button
            key={t}
            className="filters__item"
            aria-current={type === t}
            onClick={() => navigate({ search: (prev) => ({ ...prev, type: t }) })}
          >
            {TYPE_FILTER_LABELS[t]} <span className="filters__count">{counts.byType[t]}</span>
          </button>
        ))}
      </nav>

      {listed.length === 0 ? (
        <p className="empty">
          {counts.total === 0
            ? "Aucune recette publiée."
            : "Aucune recette ne correspond."}
        </p>
      ) : searching ? (
        <ol className="index index--flat">
          {listed.map((recipe) => (
            <RecipeRow key={recipe.id} recipe={recipe} showImage={false} />
          ))}
        </ol>
      ) : (
        groupByLetter(listed).map((group) => (
          <section className="group" key={group.letter}>
            <ol className="index">
              {group.items.map((recipe, i) => (
                <RecipeRow
                  key={recipe.id}
                  recipe={recipe}
                  letter={i === 0 ? group.letter : undefined}
                  showImage
                />
              ))}
            </ol>
          </section>
        ))
      )}
    </main>
  );
}

type RowRecipe = {
  id: string;
  title: string;
  slug: string;
  type: keyof typeof TYPE_LABELS;
  imageUrl: string | null;
  matchedIngredient?: string | null;
};

function RecipeRow({
  recipe,
  letter,
  showImage,
}: {
  recipe: RowRecipe;
  letter?: string;
  showImage: boolean;
}) {
  return (
    <li className="row">
      <span className="row__letter" aria-hidden={!letter}>
        {letter ?? ""}
      </span>
      <div className="row__body">
        <Link to="/recette/$slug" params={{ slug: recipe.slug }} className="row__title">
          {recipe.title}
        </Link>
        <span className="row__type">{TYPE_LABELS[recipe.type]}</span>
        {recipe.matchedIngredient ? (
          <p className="row__reason">{recipe.matchedIngredient}</p>
        ) : null}
        {showImage && recipe.imageUrl ? (
          <img className="row__photo" src={recipe.imageUrl} alt="" loading="lazy" />
        ) : null}
      </div>
    </li>
  );
}
```

- [ ] **Step 4 : Écrire les styles de l'index**

La hauteur de photo est **fixe** et la largeur libre : c'est ce qui empêche une photo verticale de creuser un trou dans la liste.

```css
/* à ajouter dans src/styles/app.css */
.masthead { padding: 3rem 0 0; }
.masthead__title {
  font-family: var(--serif);
  font-weight: 600;
  font-size: var(--type-masthead);
  line-height: 1;
  margin: 0;
  border-bottom: 1px solid var(--ochre);
  padding-bottom: 0.5rem;
}
.masthead__count {
  font-size: var(--type-meta);
  color: var(--ink-muted);
  margin: 0.5rem 0 0;
}

.search {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--ink);
  background: transparent;
  font: inherit;
  font-size: var(--type-body);
  color: var(--ink);
  padding: 1.5rem 0 0.5rem;
  border-radius: 0;
  -webkit-appearance: none;
}
.search::-webkit-search-cancel-button { display: none; }
.search::placeholder { color: var(--ink-muted); }

.filters { display: flex; flex-wrap: wrap; gap: 1.5rem; padding: 1rem 0; }
.filters__item {
  border: 0; background: none; padding: 0; cursor: pointer;
  font: inherit; font-size: var(--type-meta); color: var(--ink);
}
.filters__item[aria-current="true"] { color: var(--ochre); }
.filters__count { color: var(--ink-muted); }

.group { border-top: 1px solid var(--rule-strong); }
.index { list-style: none; margin: 0; padding: 0; }

.row { display: flex; border-bottom: 1px solid var(--rule); }
.row__letter {
  flex: 0 0 var(--margin-w);
  font-family: var(--serif);
  font-weight: 600;
  font-size: var(--type-letter);
  line-height: 1;
  color: var(--ochre);
  padding-top: 0.6rem;
  border-right: 1px solid var(--rule);
}
.index--flat .row__letter { border-right: 0; flex-basis: 0; }
.row__body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 1rem;
  padding: 0.75rem 0 0.75rem 1.5rem;
}
.row__title {
  font-family: var(--serif);
  font-weight: 500;
  font-size: var(--type-lead);
  line-height: 1.15;
}
.row__type {
  font-size: var(--type-meta);
  color: var(--ink-muted);
  text-align: right;
}
.row__reason { grid-column: 1 / -1; font-size: var(--type-meta); color: var(--ink-muted); margin: 0.25rem 0 0; }
.row__photo {
  grid-column: 1 / -1;
  height: 200px;
  width: auto;
  max-width: 100%;
  margin-top: 0.75rem;
  border: 1px solid var(--rule-strong);
}
@media (max-width: 640px) {
  .row__photo { height: 160px; }
  .row__body { padding-left: 1rem; }
}

.empty { font-size: var(--type-meta); color: var(--ink-muted); padding: 2rem 0; }
```

- [ ] **Step 5 : Vérifier dans le navigateur**

Run: `npm run dev`

Contrôler point par point :
- les recettes sont groupées par lettre, la lettre apparaît **une seule fois** par groupe, en ocre, dans la marge ;
- **aucun numéro** n'apparaît nulle part ;
- cliquer sur « Desserts » filtre la liste et met le libellé en ocre, sans pastille ni bouton visible ;
- taper `courgette` fait disparaître les lettres de groupe et aplatit la liste ;
- vider le champ restaure le regroupement ;
- l'URL porte `?q=` et `?type=` et un rechargement conserve l'état ;
- taper huit caractères puis appuyer sur retour **une seule fois** revient à l'index vide, et non à `/?q=courgett` : l'entrée dans la recherche est empilée, les frappes suivantes remplacent. Un second retour doit quitter le site, pas remonter la frappe caractère par caractère.

- [ ] **Step 6 : Prouver que le SSR sert vraiment du contenu**

Une vérification visuelle passe même si le serveur a renvoyé une coquille vide et que tout est arrivé à l'hydratation. Seule la réponse brute le dit.

```bash
curl -s http://localhost:3000/ | grep -c "Clafoutis aux cerises"
```

Expected : `1` ou plus. Si c'est `0`, le loader ou l'intégration `setupRouterSsrQueryIntegration` n'est pas câblée — ne pas continuer.

- [ ] **Step 7 : Vérifier la recherche sur le déploiement réel**

`convex-test` simule l'index de recherche : il ne reproduit ni le classement par pertinence, ni la sémantique de préfixe, ni le comportement multi-termes. Les tests de la tâche 8 prouvent la logique, **pas** la recherche Convex.

Dans le navigateur, contrôler contre le déploiement de développement :

| Saisie | Attendu |
|---|---|
| `courgette` | trouve les recettes dont un ingrédient est « courgettes » |
| `Crepes` | trouve « Crêpes de sarrasin » — insensible aux accents |
| `poireaux` | trouve « Tarte fine aux poireaux… » |
| `riz lait` | trouve « Riz au lait vanillé » — deux termes |
| `xyzzy` | aucun résultat, ligne factuelle, aucune erreur |

- [ ] **Step 8 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff`), puis committer **à la main**. Suggestion de message :

```
feat(vitrine): add alphabetical index with filters and tolerant search
```

---

### Task 10 : Surface `/recette/$slug` — fiche et sélecteur de portions

**Files:**
- Create: `src/routes/recette.$slug.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: `api.recipes.getBySlug`, `servingsFactor`, `scaleIngredient`, `TYPE_LABELS`
- Produces: la route `/recette/$slug`

- [ ] **Step 1 : Écrire la route**

Aucune photo d'ouverture : le premier écran donne le titre, le type, les portions et les ingrédients. La photo arrive **après** les ingrédients.

```tsx
// src/routes/recette.$slug.tsx
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { scaleIngredient, servingsFactor } from "../lib/scale";
import { TYPE_LABELS } from "../lib/recipeTypes";

export const Route = createFileRoute("/recette/$slug")({
  loader: async ({ context, params }) => {
    // Sans `notFound()`, un slug inconnu repondrait HTTP 200 avec un message dans le corps.
    const recipe = await context.queryClient.ensureQueryData(
      convexQuery(api.recipes.getBySlug, { slug: params.slug }),
    );
    if (!recipe) throw notFound();
  },
  notFoundComponent: () => (
    <main className="page">
      <p className="empty">Cette recette n’existe pas.</p>
      <Link to="/" className="back">Retour à l’index</Link>
    </main>
  ),
  component: RecipePage,
});

function RecipePage() {
  const { slug } = Route.useParams();
  const recipe = useSuspenseQuery(convexQuery(api.recipes.getBySlug, { slug })).data;
  const [target, setTarget] = useState<number | null>(null);

  // Le loader a déjà levé `notFound()` si la recette n'existe pas.
  if (!recipe) return null;

  const servings = recipe.servings;
  const current = target ?? servings ?? 0;
  const factor = servings ? servingsFactor(servings, current) : 1;

  // Calculé une seule fois : le marqueur de ligne et la note de bas de liste doivent
  // dépendre exactement du même prédicat, sinon une dague peut apparaître sans explication.
  const lines = recipe.ingredients.map((ingredient) => scaleIngredient(ingredient, factor));
  const showNote = factor !== 1 && lines.some((line) => !line.scaled);

  return (
    <main className="page recipe">
      {/*
        Les deux colonnes de la double page sont deux vrais conteneurs, pas des
        enfants directs placés par `grid-column` : sans wrapper, l'auto-placement
        de la grille donne une ligne à chacun et la colonne de droite descend au
        lieu de commencer en haut, face au titre.
      */}
      <div className="recipe__left">
        <Link to="/" className="back">Retour à l'index</Link>
        <h1 className="recipe__title">{recipe.title}</h1>
        <p className="recipe__type">{TYPE_LABELS[recipe.type]}</p>
      </div>

      <div className="recipe__right">
        {servings ? (
          <div className="servings">
            <button
              className="servings__btn"
              aria-label="Une personne de moins"
              onClick={() => setTarget(Math.max(1, current - 1))}
            >
              −
            </button>
            <span className="servings__value">
              {current} {current > 1 ? "personnes" : "personne"}
            </span>
            <button
              className="servings__btn"
              aria-label="Une personne de plus"
              onClick={() => setTarget(current + 1)}
            >
              +
            </button>
          </div>
        ) : null}

        <h2 className="recipe__section">Ingrédients</h2>
        <ul className="ingredients">
          {lines.map(({ text, scaled }, i) => (
            <li key={i} className="ingredients__item">
              {text}
              {factor !== 1 && !scaled ? (
                <span className="ingredients__fixed" title="Quantité non recalculée"> †</span>
              ) : null}
            </li>
          ))}
        </ul>

        {showNote ? (
          <p className="ingredients__note">
            † Cette quantité n'a pas pu être recalculée : la ligne est reproduite telle quelle.
          </p>
        ) : null}
      </div>

      {recipe.imageUrl ? (
        <img className="recipe__photo" src={recipe.imageUrl} alt="" />
      ) : null}

      <h2 className="recipe__section recipe__section--steps">Préparation</h2>
      <ol className="steps">
        {recipe.steps.map((step, i) => (
          <li key={i} className="steps__item">{step}</li>
        ))}
      </ol>
    </main>
  );
}
```

- [ ] **Step 2 : Écrire les styles de la fiche**

Les boutons `−` et `+` sont la **seule** exception au refus des coins arrondis, et leur cible tactile est de 48 px — la fiche se lit les mains prises.

```css
/* à ajouter dans src/styles/app.css */
.back { font-size: var(--type-meta); color: var(--ink-muted); display: inline-block; padding: 2rem 0 0; }

.recipe__title {
  font-family: var(--serif);
  font-weight: 600;
  font-size: var(--type-title);
  line-height: 1.02;
  letter-spacing: -0.02em;
  margin: 1rem 0 0;
}
.recipe__type { font-size: var(--type-meta); color: var(--ink-muted); margin: 0.5rem 0 0; }

.recipe__section {
  font-family: var(--serif);
  font-weight: 600;
  font-size: var(--type-section);
  line-height: 1.1;
  margin: 2.5rem 0 1rem;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 0.5rem;
}

.servings { display: flex; align-items: center; gap: 1rem; margin-top: 1.5rem; }
.servings__btn {
  width: 48px; height: 48px;
  border: 1px solid var(--rule-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--ink);
  font: inherit; font-size: var(--type-control);
  cursor: pointer;
}
.servings__value { font-size: var(--type-control); font-weight: 600; }

.ingredients { list-style: none; margin: 0; padding: 0; }
.ingredients__item {
  font-size: var(--type-body);
  line-height: 1.5;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--rule);
}
.ingredients__fixed { color: var(--ochre); }
.ingredients__note { font-size: var(--type-meta); color: var(--ink-muted); margin-top: 1rem; }

.recipe__photo {
  height: 200px; width: auto; max-width: 100%;
  margin-top: 2rem;
  border: 1px solid var(--rule-strong);
}

.steps { margin: 0; padding: 0 0 0 2.5rem; max-width: 68ch; }
.steps__item { font-size: var(--type-lead); line-height: 1.6; margin-bottom: 1.25rem; }

/*
 * Double page, exigée par DESIGN.md : à gauche le retour, le titre et le type ;
 * à droite les portions puis les ingrédients ; « Préparation » reprend sur toute
 * la largeur, de sorte que son début apparaisse en bas du premier écran.
 * Sous 900 px les wrappers redeviennent de simples blocs et la fiche retombe en
 * flux linéaire, dans l'ordre du DOM, sans réordonnancement.
 */
@media (min-width: 900px) {
  .recipe {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 4rem;
    align-items: start;
  }
  .recipe > .recipe__left { grid-column: 1; grid-row: 1; }
  .recipe > .recipe__right { grid-column: 2; grid-row: 1; }
  .recipe > .recipe__photo,
  .recipe > .recipe__section--steps,
  .recipe > .steps { grid-column: 1 / -1; }

  /* Le premier titre de la colonne de droite s'aligne sur le haut du titre de gauche. */
  .recipe__right > .recipe__section:first-child,
  .recipe__right > .servings { margin-top: 0; }
}
```

Le `<h2>` « Préparation » porte `recipe__section recipe__section--steps` : c'est le seul des deux à être un enfant direct de la grille, et le modificateur est ce qui le fait courir sur les deux colonnes.

- [ ] **Step 3 : Vérifier dans le navigateur**

Run: `npm run dev`

Contrôler :
- ouvrir « Clafoutis aux cerises » : le premier écran montre titre, type, portions et ingrédients — **aucune photo d'ouverture** ;
- passer de 6 à 12 personnes double `500 g de cerises` en `1000 g de cerises` et `3 œufs` en `6 œufs` ;
- `une pincée de sel` reste inchangée et porte un `†` ;
- ouvrir « Tartiflette » : **aucun sélecteur de portions** n'est affiché, la recette n'a pas de `servings` ;
- ouvrir `/recette/nimporte-quoi` : le message d'absence s'affiche, pas une erreur ;
- réduire la fenêtre à 390 px : le texte reste lisible et rien ne déborde horizontalement.

- [ ] **Step 4 : Exécuter toute la suite de tests**

Run: `npm test`
Expected: PASS, aucune régression.

- [ ] **Step 5 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff`), puis committer **à la main**. Suggestion de message :

```
feat(vitrine): add recipe page with best-effort servings selector
```

---

### Task 11 : Photos de seed

**Files:**
- Create: `scripts/seed-images.sh`
- Create: `convex/devImages.ts`
- Create: `docs/design/samples/` (deux JPEG fournis par toi)

**Interfaces:**
- Consumes: le schéma de la tâche 7
- Produces: deux recettes de seed portant un `imageStorageId` réel, ce qui rend la photo-dans-la-ligne visuellement vérifiable

> **Pourquoi cette tâche existe.** La photo à l'intérieur de sa ligne est la décision de design la plus distinctive du projet, et elle est invérifiable tant qu'aucun fichier n'est stocké. Sans elle, les tâches 9 et 10 sont livrées sans que personne n'ait vu le rendu réel.

- [ ] **Step 1 : Déposer deux photos**

Placer deux JPEG de plats dans `docs/design/samples/`, nommés `crepes.jpg` et `gratin.jpg`. **Prendre volontairement deux formats différents** — un paysage et un portrait — c'est le cas que la hauteur fixe est censée absorber.

- [ ] **Step 2 : Écrire les fonctions Convex de développement**

```ts
// convex/devImages.ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * `attach` remplace puis supprime une image. Être interne ne protège de rien ici : la CLI
 * s'authentifie en administrateur, et une variable d'environnement mal pointée suffirait à
 * détruire les photos d'un déploiement réel. Le déploiement doit donc se déclarer lui-même.
 */
function assertDevDeployment() {
  if (process.env.ALLOW_DEV_IMAGES !== "true") {
    throw new Error(
      "ALLOW_DEV_IMAGES n'est pas \"true\" sur ce déploiement : refus d'écrire des images de développement.",
    );
  }
}

export const generateUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertDevDeployment();
    return ctx.storage.generateUploadUrl();
  },
});

export const attach = internalMutation({
  args: { slug: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { slug, storageId }) => {
    assertDevDeployment();
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!doc) {
      // Le fichier est déjà dans le stockage : sans ce nettoyage il resterait orphelin,
      // sans plus aucune référence pour le retrouver.
      await ctx.storage.delete(storageId);
      throw new Error(`Recette introuvable : ${slug}`);
    }
    // Une réexécution du script remplacerait le pointeur en laissant l'ancien fichier derrière.
    if (doc.imageStorageId) await ctx.storage.delete(doc.imageStorageId);
    await ctx.db.patch(doc._id, { imageStorageId: storageId });
  },
});

/**
 * Filet du script : si `attach` échoue après l'upload — panne CLI, slug mal orthographié,
 * interruption — le blob est déjà stocké et plus personne ne connaît son identifiant.
 */
export const discardOrphan = internalMutation({
  args: { slug: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { slug, storageId }) => {
    assertDevDeployment();
    // `attach` peut avoir été validée par Convex alors que la CLI a perdu la réponse et
    // rendu un échec : le `trap` du script appellerait alors ce nettoyage sur un fichier
    // désormais référencé, et casserait la recette qu'on voulait servir. La vérification
    // et la suppression tiennent dans la même mutation, donc rien ne s'intercale entre
    // les deux. Le slug suffit à trancher — pas besoin d'un index sur `imageStorageId`
    // dans le schéma de production pour un besoin de développement.
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (doc?.imageStorageId === storageId) return;
    await ctx.storage.delete(storageId);
  },
});
```

- [ ] **Step 3 : Écrire le script**

**Un client Convex ne peut pas appeler une fonction `internal`** — c'est précisément ce qui les rend internes. La CLI, elle, s'authentifie en administrateur et le peut. Le script passe donc par `npx convex run` pour les mutations, et par `curl` pour le seul morceau que la CLI ne sait pas faire : le POST du fichier vers l'URL d'upload.

Trois pièges de shell méritent d'être nommés, parce qu'ils transforment un échec en succès apparent. `curl` sans `--fail-with-body` rend 0 sur un HTTP 500 et le corps d'erreur devient l'identifiant. Un `sed` permissif accepterait un JSON d'erreur comme `storageId`. Et une panne entre l'upload et l'attachement laisse un blob que plus personne ne peut retrouver — d'où le `trap`.

```bash
#!/usr/bin/env bash
# scripts/seed-images.sh
set -euo pipefail

command -v jq >/dev/null || { echo "jq requis (déclaré dans devenv.nix)" >&2; exit 1; }

attach() {
  local slug="$1" file="$2"
  [ -f "$file" ] || { echo "Fichier absent : $file" >&2; exit 1; }

  # `npx convex run` s'authentifie en administrateur : il atteint les fonctions internes.
  local upload_url
  upload_url=$(npx convex run devImages:generateUploadUrl | jq -er '.')

  # --fail-with-body : sans lui, curl rend 0 sur un HTTP 500 et le corps d'erreur
  # deviendrait l'identifiant de stockage.
  local storage_id
  storage_id=$(curl -sS --fail-with-body -X POST "$upload_url" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@$file" | jq -er '.storageId')

  # À partir d'ici le blob existe. Toute sortie avant l'attachement doit le supprimer,
  # sinon il reste dans le stockage sans référence.
  # shellcheck disable=SC2064
  trap "npx convex run devImages:discardOrphan '{\"slug\":\"$slug\",\"storageId\":\"$storage_id\"}' >/dev/null 2>&1 || true" EXIT

  # `attach` supprime aussi l'ancien fichier, et supprime le nouveau si le slug est introuvable.
  npx convex run devImages:attach "{\"slug\":\"$slug\",\"storageId\":\"$storage_id\"}"
  trap - EXIT
  echo "$slug ← $file"
}

attach "crepes-de-sarrasin" "docs/design/samples/crepes.jpg"
attach "gratin-dauphinois"  "docs/design/samples/gratin.jpg"
```

Le déploiement doit porter le drapeau, sans quoi les trois mutations refusent d'écrire :

```bash
npx convex env set ALLOW_DEV_IMAGES true
```

- [ ] **Step 4 : Exécuter le script**

```bash
chmod +x scripts/seed-images.sh
./scripts/seed-images.sh
```

Expected : deux lignes de confirmation, une par recette.

- [ ] **Step 5 : Vérifier le rendu**

Run: `npm run dev`

Contrôler :
- « Crêpes de sarrasin » et « Gratin dauphinois » portent chacune leur photo **sous leur propre titre**, dans le même bloc fileté ;
- les deux photos ont **exactement la même hauteur** malgré des formats différents ;
- les autres recettes n'ont ni cadre vide, ni espace réservé ;
- taper une recherche fait disparaître les deux photos.

- [ ] **Step 6 : Point d'arrêt — relecture puis commit manuel**

Relire le diff (`git diff`), puis committer **à la main**. Suggestion de message :

```
chore(dev): add seed image upload script
```

---

## Ce que ce plan ne couvre pas

Volontairement hors périmètre, et repris dans les plans suivants :

- **Ingestion** — upload, worker, extraction OpenRouter, file de validation, écrans d'administration. Bloqué par le spike T1.
- **Illustration** — embellissement d'image et validation avant/après. Bloqué par le spike T13.
- **Intendance** — export git versionné, câblage du déploiement Vercel/Convex, backends de preview.
- **Authentification admin** — `requireAdmin` sur mutations, actions et queries. Aucune surface d'administration n'existe encore ; la poser maintenant serait une garde sans porte.

Les recettes de seed sont toutes en `status: "published"` : la vitrine ne voit jamais de brouillon, ce que la tâche 8 vérifie par un test.
