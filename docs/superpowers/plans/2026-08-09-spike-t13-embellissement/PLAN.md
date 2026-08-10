# Spike T13 — embellissement d'image · plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un banc d'essai jetable qui lance 4 modèles d'édition d'image × 4 photos de plats × 2 passes, et produit une page HTML permettant de juger à l'œil si un modèle sait restaurer une photo de magazine sans réinventer le plat.

**Architecture:** Un dossier `spike13/` isolé du reste de l'application, avec ses propres `tsconfig.json` et `vitest.config.ts` — parce que les configs de `main` sont taillées pour du navigateur et rendraient les tests du banc silencieusement vides. Logique pure testée (budget, décodage de réponse, échelle) ; E/S et jugement humain non testés, délibérément. Grille complète plutôt que marche par échelons : 4 barreaux à ~1 $ ne justifient aucune machinerie de parcours.

**Périmètre de l'échelle, arbitré le 2026-08-10.** Le catalogue OpenRouter offre 7 modèles à sortie image ; le spike n'en essaie que les **4 moins chers**. Les trois écartés (`openai/gpt-5-image`, `google/gemini-3.1-flash-image`, `google/gemini-3-pro-image`) pesaient à eux seuls les deux tiers de la dépense pour des modèles qu'on n'utiliserait qu'en dernier recours. Conséquence à assumer dans le verdict : si les 4 échouent, T13 ne conclut **pas** « négatif au sommet de l'échelle » mais « négatif sur la moitié basse » — et la décision devient soit remonter d'un cran, soit clore.

**Tech Stack:** Node 22, TypeScript, `tsx`, `sharp`, `dotenv`, `vitest`, API OpenRouter (`/chat/completions` en sortie image).

**Spec de référence :** [`docs/superpowers/specs/2026-08-09-spike-t13-embellissement-design.md`](../../specs/2026-08-09-spike-t13-embellissement-design.md)

## Global Constraints

- **Ne jamais remplacer le `package.json` racine.** Il porte l'application (TanStack Start + Convex). On y **ajoute** trois dépendances et des scripts suffixés `13`, rien d'autre. T1 avait écrasé ce fichier ; c'est une régression à ne pas reproduire.
- **Gestionnaire de paquets : `npm`** (`package-lock.json` à la racine). `node_modules` est un symlink vers le repo principal : `npm install` y écrit, ce qui est voulu — les dépendances sont partagées.
- **Plafond de dépense : 10 USD**, en dur, vérifié avant chaque appel.
- **Normalisation d'image : 2000 px sur le grand côté, sRGB, JPEG qualité 80.** Identique à T1 et à ce que la production devra faire. Toute réduction plus agressive supprimerait le moiré et la trame d'impression — les défauts mêmes que le banc mesure.
- **Le dépôt est public.** Aucune image ne sort de `ingest.ts` sans que ses métadonnées aient été supprimées **et relues**. Les originaux restent dans `~/Downloads/table-des-recettes-inbox/`, jamais commités.
- **Quatre photos, deux rôles.** `recadre1` et `recadre2` sont recadrées sur le plat avant ingestion ; `brut1` et `brut2` gardent le cadrage large de la prise de vue, colonne de texte voisine comprise. Le banc mesure ainsi deux choses séparément : savoir restaurer une trame d'impression, et savoir en plus recadrer et redresser sans inventer. Mélanger les deux dans un même lot rendrait un échec non diagnosticable.
- **HEIC : sharp ne sait pas décoder** les HEIC d'iPhone récents (libvips 8.18.3 refuse au-delà de 16 références dans la boîte `iref`). Les originaux doivent être convertis en JPEG par `sips` avant ingestion. Constat à répercuter sur T5 : le garde-fou de format doit **refuser** le HEIC, pas espérer le convertir côté serveur.
- **Code, commentaires, noms de tests et identifiants en anglais.** Messages destinés à l'utilisateur (console, page HTML) et documentation en prose : en français.
- **Commits manuels.** Les étapes « Commit » du plan donnent le message à utiliser ; c'est florianlauer qui décide quand commiter. Aucune attribution d'assistant dans les messages.
- **Supprimer des fichiers avec `trash`, jamais `rm`.**
- **Deux générations par couple (modèle, photo).** Le taux d'accord entre les deux passes est un livrable, pas un détail d'implémentation.
- **Les décomptes de tests annoncés dans les étapes sont ceux du plan tel qu'écrit.** Toute assertion ajoutée en cours de route les décale ; reporter le nombre réel plutôt que de le forcer à correspondre.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `spike13/tsconfig.json` | Typecheck du banc en environnement Node — la config racine est en `bundler` + `vite/client` et ne connaît pas `node:fs` |
| `spike13/vitest.config.ts` | Épingle racine, environnement `node` et `include` — sans quoi vitest résout la config de `main` (`edge-runtime`, `src/**` seulement) et collecte zéro test en sortant vert |
| `spike13/budget.ts` | Compteur de dépense persistant et plafond |
| `spike13/ingest.ts` | Normalisation d'une photo d'inbox + barrière métadonnées |
| `spike13/models.ts` | Les 4 barreaux retenus, leurs tarifs catalogue et le coût plafond par appel |
| `spike13/prompt.ts` | Prompt de restauration, versionné |
| `spike13/openrouter.ts` | Un appel image→image : requête, décodage, modes d'échec nommés |
| `spike13/run.ts` | La grille 7×3×2, reprise-safe, sous plafond |
| `spike13/review.ts` | Construction de `review.html` |
| `spike13/RESULTS.md` | Tableau et verdict, rempli à la main |

---

### Task 1: Socle isolé — configs, dépendances, budget

**Files:**
- Modify: `package.json` (ajout de 3 dépendances et de 4 scripts)
- Modify: `tsconfig.json` (exclusion de `spike13`)
- Modify: `.gitignore` (rendus non commités)
- Create: `spike13/tsconfig.json`
- Create: `spike13/vitest.config.ts`
- Create: `spike13/budget.ts`
- Test: `spike13/budget.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `BUDGET_CAP_USD: number`, `BudgetExceededError`, `class BudgetCounter` avec `get spent(): number`, `assertCanSpend(maximumNext: number): void`, `record(actualCost: number): void`, `static load({ path, cap? }): Promise<BudgetCounter>`, `save(path: string): Promise<void>`. Script `npm run verify13`.

- [ ] **Step 1: Installer les dépendances du banc**

```bash
npm install --save-dev tsx@^4.20.5 sharp@^0.35.3 dotenv@^17.2.2
```

Vérifier ensuite que `package.json` a bien **conservé** toutes ses dépendances applicatives (`convex`, `@tanstack/react-start`, `react`…). Si elles ont disparu, arrêter : le fichier a été écrasé.

- [ ] **Step 2: Ajouter les scripts du banc**

Dans `package.json`, ajouter à `scripts` (sans toucher aux existants) :

```json
    "ingest13": "tsx spike13/ingest.ts",
    "run13": "tsx spike13/run.ts",
    "review13": "tsx spike13/review.ts",
    "verify13": "tsc -p spike13/tsconfig.json --noEmit && vitest run --config spike13/vitest.config.ts"
```

- [ ] **Step 3: Exclure `spike13` du typecheck applicatif**

`tsconfig.json` racine a `"include": ["**/*.ts", ...]` et `"types": ["vite/client"]`. Sans exclusion, il tenterait de typechecker le banc sans les types Node. Ajouter la clé `exclude` au même niveau que `include` :

```json
  "exclude": ["spike13"],
```

- [ ] **Step 4: Créer le tsconfig du banc**

`spike13/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 5: Créer la config vitest du banc**

`spike13/vitest.config.ts` :

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// `node_modules` is a symlink to the main checkout, so vitest resolves the workspace through the
// symlink's real path and would load the app config — which runs in `edge-runtime` (no `node:fs`)
// and only includes `src/**` and `convex/**`. Left unpinned, the bench's tests are collected as
// zero and the command still exits green.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    environment: "node",
    include: ["spike13/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Ignorer les rendus et la page de revue**

Ajouter à `.gitignore` :

```gitignore

# Spike T13 — 42 rendus pèsent 40 à 80 Mo ; seuls ceux du modèle retenu seront commités à la main.
spike13/fixtures/renders/
spike13/review.html
```

- [ ] **Step 7: Écrire les tests du compteur de budget**

`spike13/budget.test.ts` :

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUDGET_CAP_USD, BudgetCounter, BudgetExceededError } from "./budget.js";

describe("BudgetCounter", () => {
  it("allows a call that fits under the cap", () => {
    const counter = new BudgetCounter({ spent: 1, cap: 10 });
    expect(() => counter.assertCanSpend(8)).not.toThrow();
  });

  it("refuses a call whose worst case would cross the cap", () => {
    const counter = new BudgetCounter({ spent: 9.5, cap: 10 });
    expect(() => counter.assertCanSpend(1)).toThrow(BudgetExceededError);
  });

  it("refuses a call landing exactly on the cap boundary plus one cent", () => {
    const counter = new BudgetCounter({ spent: 10, cap: 10 });
    expect(() => counter.assertCanSpend(0.01)).toThrow(BudgetExceededError);
  });

  it("accumulates recorded costs", () => {
    const counter = new BudgetCounter({ cap: 10 });
    counter.record(0.25);
    counter.record(0.5);
    expect(counter.spent).toBeCloseTo(0.75, 10);
  });

  it("rejects a non-finite or negative cost rather than silently skewing the total", () => {
    const counter = new BudgetCounter({ cap: 10 });
    expect(() => counter.record(Number.NaN)).toThrow();
    expect(() => counter.record(-1)).toThrow();
  });

  it("starts from zero when no counter file exists yet", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t13-budget-"));
    const counter = await BudgetCounter.load({ path: join(directory, "absent.json"), cap: 10 });
    expect(counter.spent).toBe(0);
  });

  it("round-trips through disk so a rerun cannot forget past spending", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t13-budget-"));
    const path = join(directory, "budget.json");
    const counter = new BudgetCounter({ cap: 10 });
    counter.record(1.5);
    await counter.save(path);

    const reloaded = await BudgetCounter.load({ path, cap: 10 });
    expect(reloaded.spent).toBeCloseTo(1.5, 10);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ currency: "USD", spentUsd: 1.5 });
  });

  it("refuses to start rather than treating a corrupted counter as zero", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t13-budget-"));
    const path = join(directory, "budget.json");
    await writeFile(path, "{ not json");
    await expect(BudgetCounter.load({ path, cap: 10 })).rejects.toThrow();
  });

  it("caps the bench at ten dollars by default", () => {
    expect(BUDGET_CAP_USD).toBe(10);
  });
});
```

- [ ] **Step 8: Lancer les tests pour les voir échouer**

Run: `npm run verify13`
Expected: FAIL — `Cannot find module './budget.js'`.

- [ ] **Step 9: Écrire `spike13/budget.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";

// OpenRouter bills in USD, so the cap and the counter stay in that single currency.
// The full grid is estimated at ~4 USD worst case; a single prompt rewrite replays it, so 10 USD
// leaves room for a cost estimate wrong by a factor of two without letting spending run.
export const BUDGET_CAP_USD = 10;

export class BudgetExceededError extends Error {
  constructor({ spent, maximumNext, cap }: { spent: number; maximumNext: number; cap: number }) {
    super(
      `Appel refusé : ${spent.toFixed(6)} USD dépensés + ${maximumNext.toFixed(6)} USD au pire cas > plafond ${cap.toFixed(2)} USD.`,
    );
    this.name = "BudgetExceededError";
  }
}

export class BudgetCounter {
  #spent: number;
  readonly cap: number;

  constructor({ spent = 0, cap = BUDGET_CAP_USD }: { spent?: number; cap?: number } = {}) {
    this.#spent = spent;
    this.cap = cap;
  }

  get spent(): number {
    return this.#spent;
  }

  assertCanSpend(maximumNext: number): void {
    if (this.#spent + maximumNext > this.cap) {
      throw new BudgetExceededError({ spent: this.#spent, maximumNext, cap: this.cap });
    }
  }

  record(actualCost: number): void {
    if (!Number.isFinite(actualCost) || actualCost < 0) {
      throw new Error(`Coût réel invalide : ${actualCost}.`);
    }
    this.#spent += actualCost;
  }

  static async load({ path, cap = BUDGET_CAP_USD }: { path: string; cap?: number }): Promise<BudgetCounter> {
    try {
      const persisted = JSON.parse(await readFile(path, "utf8")) as { spentUsd?: unknown };
      if (typeof persisted.spentUsd !== "number") {
        throw new Error("spentUsd absent ou invalide");
      }
      return new BudgetCounter({ spent: persisted.spentUsd, cap });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new BudgetCounter({ cap });
      }
      throw new Error(`Compteur de budget illisible (${path}) : ${String(error)}`);
    }
  }

  async save(path: string): Promise<void> {
    await writeFile(path, `${JSON.stringify({ currency: "USD", spentUsd: this.#spent }, null, 2)}\n`);
  }
}
```

- [ ] **Step 10: Lancer les tests pour les voir passer**

Run: `npm run verify13`
Expected: PASS, **9 tests exécutés**. Si vitest annonce « no test files found » ou 0 test, la config de l'étape 5 n'est pas prise : ne pas continuer, c'est exactement le piège que cette tâche existe pour éviter.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore spike13/
git commit -m "feat(spike-t13): socle isolé du banc et compteur de budget"
```

---

### Task 2: `ingest.ts` — normalisation et barrière métadonnées

**Files:**
- Create: `spike13/ingest.ts`
- Create: `spike13/fixtures/dishes/README.md`
- Test: `spike13/ingest.test.ts`

**Interfaces:**
- Consumes: rien de Task 1.
- Produces: `retainedMetadata(metadata: Metadata): string[]`, `normalizeImage({ inputPath, outputPath }): Promise<Metadata>`, `INBOX_DIRECTORY: string`. Script `npm run ingest13 -- <role> [source]` écrivant dans `spike13/fixtures/dishes/<role>.jpg`.

- [ ] **Step 1: Écrire les tests**

`spike13/ingest.test.ts` :

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeImage, retainedMetadata } from "./ingest.js";

describe("retainedMetadata", () => {
  it("reports nothing on a stripped image", () => {
    expect(retainedMetadata({ width: 10, height: 10 } as never)).toEqual([]);
  });

  it("names every metadata block that survived", () => {
    expect(retainedMetadata({ exif: Buffer.from("x"), icc: Buffer.from("y") } as never)).toEqual(["exif", "icc"]);
  });
});

describe("normalizeImage", () => {
  it("caps the long side at 2000px without enlarging a smaller source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t13-ingest-"));
    const inputPath = join(directory, "big.jpg");
    const outputPath = join(directory, "out.jpg");
    await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#888" } })
      .jpeg()
      .toFile(inputPath);

    const metadata = await normalizeImage({ inputPath, outputPath });

    expect(metadata.width).toBe(2000);
    expect(metadata.height).toBe(1500);
  });

  it("leaves a source smaller than the cap untouched in size", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t13-ingest-"));
    const inputPath = join(directory, "small.jpg");
    const outputPath = join(directory, "out.jpg");
    await sharp({ create: { width: 800, height: 600, channels: 3, background: "#888" } })
      .jpeg()
      .toFile(inputPath);

    const metadata = await normalizeImage({ inputPath, outputPath });

    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(600);
  });

  it("strips the metadata a phone photo carries, GPS included", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t13-ingest-"));
    const inputPath = join(directory, "tagged.jpg");
    const outputPath = join(directory, "out.jpg");
    await sharp({ create: { width: 100, height: 100, channels: 3, background: "#888" } })
      .withMetadata({ exif: { IFD0: { Copyright: "test" } } })
      .jpeg()
      .toFile(inputPath);

    const metadata = await normalizeImage({ inputPath, outputPath });

    expect(retainedMetadata(metadata)).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npm run verify13`
Expected: FAIL — `Cannot find module './ingest.js'`.

- [ ] **Step 3: Écrire `spike13/ingest.ts`**

```ts
#!/usr/bin/env node
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp, { type Metadata } from "sharp";

const FORBIDDEN_METADATA_KEYS = [
  "orientation",
  "exif",
  "icc",
  "iptc",
  "xmp",
  "tifftagPhotoshop",
  "comments",
] as const;

export function retainedMetadata(metadata: Metadata): string[] {
  return FORBIDDEN_METADATA_KEYS.filter((key) => metadata[key] !== undefined);
}

// 2000px / q80 is the production normalisation, not a bench convenience: downscaling harder would
// itself remove the print screen and the moiré, which are exactly the defects the model is asked to
// fix. A bench that pre-cleans its own input cannot tell a good model from a resize.
export async function normalizeImage({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<Metadata> {
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await sharp(inputPath)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .toColorspace("srgb")
    .jpeg({ quality: 80 })
    .toFile(outputPath);

  const metadata = await sharp(outputPath).metadata();
  const retained = retainedMetadata(metadata);
  if (retained.length > 0) {
    throw new Error(`Métadonnées restantes dans ${outputPath} : ${retained.join(", ")}.`);
  }
  return metadata;
}

// Outside the repo: the originals carry the home GPS coordinates and the repo is public.
export const INBOX_DIRECTORY = resolve(homedir(), "Downloads", "table-des-recettes-inbox");

async function findInboxImage(stem: string): Promise<string> {
  const stems = [stem, stem.toLowerCase(), stem.toUpperCase()];
  const extensions = ["jpg", "jpeg", "JPG", "JPEG"];
  for (const candidateStem of stems) {
    for (const extension of extensions) {
      const candidate = resolve(INBOX_DIRECTORY, `${candidateStem}.${extension}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // The originals keep whatever casing the phone produced.
      }
    }
  }
  throw new Error(`Image ${stem} introuvable dans ${INBOX_DIRECTORY} (JPEG attendu).`);
}

async function main(): Promise<void> {
  const dish = process.argv[2];
  if (!dish || !/^[a-z][a-z0-9-]*$/i.test(dish)) {
    throw new Error("Usage : npm run ingest13 -- <role> [source] (ex. « recadre1 img_4312 »).");
  }
  const inputPath = await findInboxImage(process.argv[3] ?? dish);
  const outputPath = resolve("spike13/fixtures/dishes", `${dish.toLowerCase()}.jpg`);
  const metadata = await normalizeImage({ inputPath, outputPath });
  console.log(
    `${basename(inputPath)} → ${outputPath} (${metadata.width}×${metadata.height}, ${metadata.space}, métadonnées absentes)`,
  );
  console.log("Note la correspondance rôle/source dans spike13/fixtures/dishes/README.md.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Créer le carnet du jeu d'essai**

`spike13/fixtures/dishes/README.md` :

```markdown
# Jeu d'essai — photos de plats

Trois photos de plats prises au téléphone depuis une page de magazine, cadrées sur le plat comme
en usage réel. Les originaux restent dans `~/Downloads/table-des-recettes-inbox/` et ne sont
jamais commités : ils portent les coordonnées GPS du domicile et le dépôt est public.

Ingérées par `npm run ingest13 -- <role> <source>`, qui applique la normalisation de production
(2000 px sur le grand côté, sRGB, JPEG q80) et échoue si une métadonnée survit.

Deux rôles distincts : `recadre*` est recadrée sur le plat avant ingestion, `brut*` garde le
cadrage large de la prise de vue, colonne de texte voisine comprise. Un modèle qui passe sur l'un
et échoue sur l'autre dit si T14 a besoin d'un recadrage à l'upload.

Les HEIC d'iPhone doivent être convertis avant ingestion — sharp ne sait pas les décoder :
`sips -s format jpeg -s formatOptions 95 <fichier>.HEIC --out <fichier>.jpg`

| Rôle | Fichier source | Ce que la photo met à l'épreuve |
|---|---|---|
| `recadre1` | À renseigner à l'ingestion | Restauration seule — recadrée sur le plat |
| `recadre2` | À renseigner à l'ingestion | Restauration seule — recadrée sur le plat |
| `brut1` | À renseigner à l'ingestion | Restauration **plus** recadrage et redressement |
| `brut2` | À renseigner à l'ingestion | Restauration **plus** recadrage et redressement |
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npm run verify13`
Expected: PASS, 14 tests.

- [ ] **Step 6: Ingérer les trois photos**

Bloqué tant que l'étape 0 humaine n'a pas eu lieu : les trois photos doivent être dans
`~/Downloads/table-des-recettes-inbox/`. Les tests de l'étape 5 passent sans elles ; la suite du
plan, non.

```bash
npm run ingest13 -- recadre1 <nom-du-fichier-recadré>
npm run ingest13 -- recadre2 <nom-du-fichier-recadré>
npm run ingest13 -- brut1 <nom-du-fichier-brut>
npm run ingest13 -- brut2 <nom-du-fichier-brut>
```

Chaque appel doit afficher « métadonnées absentes ». Une erreur « Métadonnées restantes » est un
**arrêt** : ne pas contourner, ne pas commiter l'image. Reporter ensuite la correspondance
rôle/source et ce que chaque photo met à l'épreuve dans `spike13/fixtures/dishes/README.md`.

- [ ] **Step 7: Commit**

```bash
git add spike13/
git commit -m "feat(spike-t13): normalisation des photos de plats et barrière métadonnées"
```

---

### Task 3: `models.ts` et `prompt.ts` — l'échelle et le prompt versionné

**Files:**
- Create: `spike13/models.ts`
- Create: `spike13/prompt.ts`
- Test: `spike13/models.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `type LadderRung = { model: string; imageOutputUsdPerToken: number; maxCostUsdPerCall: number }`, `LADDER: readonly LadderRung[]` (7 éléments, triés par coût croissant), `modelSlug(model: string): string`, `RESTORATION_PROMPT: string`, `PROMPT_VERSION: string`.

- [ ] **Step 1: Écrire les tests**

`spike13/models.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { LADDER, modelSlug } from "./models.js";
import { PROMPT_VERSION, RESTORATION_PROMPT } from "./prompt.js";

describe("LADDER", () => {
  it("covers the four cheapest image-output models, the scope arbitrated for this spike", () => {
    expect(LADDER).toHaveLength(4);
  });

  it("excludes the -preview duplicates and the auto routers", () => {
    const models = LADDER.map((rung) => rung.model);
    expect(models.some((model) => model.includes("preview"))).toBe(false);
    expect(models.some((model) => model.startsWith("openrouter/auto"))).toBe(false);
  });

  it("leaves out the three expensive rungs, which is what keeps the grid around one dollar", () => {
    const models = LADDER.map((rung) => rung.model);
    expect(models).not.toContain("google/gemini-3-pro-image");
    expect(models).not.toContain("google/gemini-3.1-flash-image");
    expect(models).not.toContain("openai/gpt-5-image");
  });

  it("is sorted cheapest first, so the results table reads as a ladder", () => {
    const costs = LADDER.map((rung) => rung.maxCostUsdPerCall);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it("caps every call above its catalogue rate, so the budget guard is never optimistic", () => {
    for (const rung of LADDER) {
      expect(rung.maxCostUsdPerCall).toBeGreaterThan(rung.imageOutputUsdPerToken * 1000);
    }
  });

  it("keeps the whole grid affordable: 4 models x 4 dishes x 2 passes under the 10 USD cap", () => {
    const worstCase = LADDER.reduce((total, rung) => total + rung.maxCostUsdPerCall * 8, 0);
    expect(worstCase).toBeLessThan(10);
  });
});

describe("modelSlug", () => {
  it("turns a model id into a single path segment", () => {
    expect(modelSlug("google/gemini-2.5-flash-image")).toBe("google__gemini-2.5-flash-image");
  });
});

describe("RESTORATION_PROMPT", () => {
  it("is versioned, so a render can always be traced back to the wording that produced it", () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+$/);
  });

  it("forbids altering the dish, which is the whole point of the first barrier", () => {
    expect(RESTORATION_PROMPT).toMatch(/ne modifie/i);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npm run verify13`
Expected: FAIL — `Cannot find module './models.js'`.

- [ ] **Step 3: Écrire `spike13/models.ts`**

Tarifs relevés dans le catalogue OpenRouter le 2026-08-09. `maxCostUsdPerCall` est un plafond volontairement généreux — 2000 tokens de sortie, là où une image en coûte typiquement ~1300 — parce qu'il sert de garde-fou budgétaire avant appel, pas d'estimation.

```ts
export type LadderRung = {
  model: string;
  // Catalogue price for image output, in USD per output token.
  imageOutputUsdPerToken: number;
  // Budget guard, checked before the call. A generated image costs roughly 1300 output tokens;
  // budgeting 2000 keeps the guard pessimistic, which is the only safe direction for a guard.
  maxCostUsdPerCall: number;
};

const OUTPUT_TOKEN_CEILING = 2000;

function rung(model: string, imageOutputUsdPerToken: number): LadderRung {
  return {
    model,
    imageOutputUsdPerToken,
    maxCostUsdPerCall: imageOutputUsdPerToken * OUTPUT_TOKEN_CEILING,
  };
}

// OpenRouter listed 7 distinct image-output models on 2026-08-09 (11 declaring `image` in
// `architecture.output_modalities`, minus the two `openrouter/auto*` routers and the two `-preview`
// duplicates). The spike covers only the four cheapest: the three left out — gpt-5-image at
// 0.00004, gemini-3.1-flash-image at 0.00006 and gemini-3-pro-image at 0.00012 — carried two thirds
// of the spend for models that would only ever be a last resort. A negative verdict on these four
// therefore does not condemn the top of the ladder; it condemns its cheap half.
export const LADDER: readonly LadderRung[] = [
  rung("openai/gpt-5-image-mini", 0.000008),
  rung("google/gemini-2.5-flash-image", 0.00003),
  rung("google/gemini-3.1-flash-lite-image", 0.00003),
  rung("openai/gpt-5.4-image-2", 0.00003),
];

// Model ids carry a slash; renders live one directory per model, so the slash has to go.
export function modelSlug(model: string): string {
  return model.replace("/", "__");
}
```

- [ ] **Step 4: Écrire `spike13/prompt.ts`**

```ts
export const PROMPT_VERSION = "v1";

// Written before any render was seen. A single rewrite to v2 is allowed if v1 fails on all seven
// models, and it replays the whole grid; beyond that the bench would be tuned on its own three
// photos and the verdict would not generalise.
export const RESTORATION_PROMPT = `Restaure cette photographie d'un plat, prise en photo dans un magazine imprimé.

À corriger :
- la perspective et le cadrage, pour rendre la photo droite ;
- la trame d'impression, le moiré et le grain du papier ;
- les reflets et les ombres portées dus à la prise de vue ;
- les couleurs, à restituer fidèlement si la source est délavée ou en noir et blanc.

Interdit, sans exception : ne modifie pas le plat, son dressage, la vaisselle, les couverts, la
nappe, ni aucun ingrédient visible. N'ajoute aucun élément qui n'est pas déjà dans l'image.
N'invente pas de hors-champ. Le résultat doit montrer exactement le même plat, photographié dans
de meilleures conditions.

Réponds uniquement par l'image restaurée.`;
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npm run verify13`
Expected: PASS, 23 tests.

- [ ] **Step 6: Commit**

```bash
git add spike13/
git commit -m "feat(spike-t13): échelle des quatre modèles et prompt de restauration v1"
```

---

### Task 4: `openrouter.ts` — un appel image → image

**Files:**
- Create: `spike13/openrouter.ts`
- Test: `spike13/openrouter.test.ts`

**Interfaces:**
- Consumes: `BudgetCounter` de Task 1, `RESTORATION_PROMPT` de Task 3.
- Produces: `type RenderResult = RenderSuccess | RenderFailure | RenderInconclusive`, `decodeImageResponse(raw: OpenRouterImageResponse): DecodedImage | DecodeFailure`, `renderImage({ model, imagePath, apiKey, budget, maxCostUsd, fetchImpl?, timeoutMs? }): Promise<RenderResult>`, `requireOpenRouterApiKey(env?): string`.

**Note d'implémentation.** La forme de réponse (`choices[0].message.images[]`) n'est **pas confirmée** — c'est l'objet de la sonde de Task 5, étape 1. `decodeImageResponse` doit donc échouer bruyamment et **rendre la réponse brute** quand elle ne trouve pas d'image, jamais écrire un fichier vide.

- [ ] **Step 1: Écrire les tests**

`spike13/openrouter.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { BudgetCounter } from "./budget.js";
import { decodeImageResponse, renderImage, requireOpenRouterApiKey } from "./openrouter.js";

const PIXEL = "iVBORw0KGgoAAAANSUhEUg==";

function responseWithImage() {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: { content: "", images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL}` } }] },
      },
    ],
    usage: { cost: 0.03 },
  };
}

describe("decodeImageResponse", () => {
  it("pulls the image and its media type out of the data URI", () => {
    const decoded = decodeImageResponse(responseWithImage());
    expect(decoded).toEqual({ status: "image", mediaType: "image/png", base64: PIXEL });
  });

  it("reports a refusal as its own outcome, not as a missing image", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "stop", message: { refusal: "I can't help with that." } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "refusal" });
  });

  it("reports a truncated generation as its own outcome", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "length", message: { content: "" } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "truncation" });
  });

  it("reports a text-only answer and keeps the text as the detail", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "stop", message: { content: "Voici une description du plat." } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "no_image" });
    expect(decoded).toHaveProperty("detail", expect.stringContaining("description du plat"));
  });

  it("fails loudly on an unrecognised payload rather than writing an empty file", () => {
    const decoded = decodeImageResponse({ something: "else" });
    expect(decoded).toMatchObject({ status: "failure", reason: "no_image" });
  });

  it("rejects a data URI it cannot parse", () => {
    const decoded = decodeImageResponse({
      choices: [{ finish_reason: "stop", message: { images: [{ image_url: { url: "https://example.test/x.png" } }] } }],
    });
    expect(decoded).toMatchObject({ status: "failure", reason: "no_image" });
  });
});

describe("renderImage", () => {
  it("records the real cost reported by the API, not the estimate", async () => {
    const budget = new BudgetCounter({ cap: 10 });
    const result = await renderImage({
      model: "openai/gpt-5-image-mini",
      imagePath: new URL("./openrouter.test.ts", import.meta.url).pathname,
      apiKey: "test-key",
      budget,
      maxCostUsd: 0.5,
      fetchImpl: async () => new Response(JSON.stringify(responseWithImage()), { status: 200 }),
    });

    expect(result.status).toBe("image");
    expect(budget.spent).toBeCloseTo(0.03, 10);
  });

  it("refuses to call at all when the worst case would cross the cap", async () => {
    const budget = new BudgetCounter({ spent: 9.9, cap: 10 });
    let called = false;
    await expect(
      renderImage({
        model: "openai/gpt-5-image-mini",
        imagePath: new URL("./openrouter.test.ts", import.meta.url).pathname,
        apiKey: "test-key",
        budget,
        maxCostUsd: 0.5,
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("treats a 429 as inconclusive, not as a model failure", async () => {
    const budget = new BudgetCounter({ cap: 10 });
    const result = await renderImage({
      model: "openai/gpt-5-image-mini",
      imagePath: new URL("./openrouter.test.ts", import.meta.url).pathname,
      apiKey: "test-key",
      budget,
      maxCostUsd: 0.5,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 }),
    });

    expect(result).toMatchObject({ status: "inconclusive" });
  });
});

describe("requireOpenRouterApiKey", () => {
  it("names the missing variable instead of failing later with an opaque 401", () => {
    expect(() => requireOpenRouterApiKey({})).toThrow(/OPENROUTER_API_KEY/);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npm run verify13`
Expected: FAIL — `Cannot find module './openrouter.js'`.

- [ ] **Step 3: Écrire `spike13/openrouter.ts`**

```ts
import { readFile } from "node:fs/promises";

import { type BudgetCounter } from "./budget.js";
import { RESTORATION_PROMPT } from "./prompt.js";

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
export const REQUEST_TIMEOUT_MS = 180_000;

type Fetch = typeof fetch;

export type OpenRouterImageResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      images?: Array<{ type?: string; image_url?: { url?: string } }>;
    };
  }>;
  usage?: { cost?: number };
  error?: { message?: string };
  [key: string]: unknown;
};

export type DecodedImage = { status: "image"; mediaType: string; base64: string };
export type DecodeFailure = { status: "failure"; reason: "refusal" | "truncation" | "no_image"; detail: string };

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

export function decodeImageResponse(raw: OpenRouterImageResponse): DecodedImage | DecodeFailure {
  const choice = raw.choices?.[0];
  const refusal = choice?.message?.refusal;
  if (typeof refusal === "string" && refusal.length > 0) {
    return { status: "failure", reason: "refusal", detail: refusal };
  }

  const url = choice?.message?.images?.[0]?.image_url?.url;
  if (typeof url === "string") {
    const match = DATA_URI.exec(url);
    if (match?.[1] && match[2]) {
      return { status: "image", mediaType: match[1], base64: match[2] };
    }
    return { status: "failure", reason: "no_image", detail: `URL d'image non décodable : ${url.slice(0, 120)}` };
  }

  // Truncation is only checked once no image was returned: a model that emitted its image and then
  // ran out of tokens on trailing text has still done the job.
  if (choice?.finish_reason === "length") {
    return { status: "failure", reason: "truncation", detail: "finish_reason=length sans image." };
  }

  const text = choice?.message?.content;
  return {
    status: "failure",
    reason: "no_image",
    detail:
      typeof text === "string" && text.length > 0
        ? `Réponse en texte, sans image : ${text.slice(0, 300)}`
        : `Aucune image dans la réponse : ${JSON.stringify(raw).slice(0, 300)}`,
  };
}

export type RenderSuccess = DecodedImage & { latencyMs: number; actualCostUsd: number; raw: OpenRouterImageResponse };
export type RenderFailure = DecodeFailure & { latencyMs: number; actualCostUsd: number; raw: OpenRouterImageResponse };
export type RenderInconclusive = {
  status: "inconclusive";
  reason: "transient_error";
  detail: string;
  latencyMs: number;
  actualCostUsd: number;
};
export type RenderResult = RenderSuccess | RenderFailure | RenderInconclusive;

export function requireOpenRouterApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY manque. Renseigne .env avec une clé OpenRouter avant tout appel payant.");
  }
  return key;
}

function isTransient({ status, message }: { status: number; message: string }): boolean {
  return status === 429 || status >= 500 || /rate.?limit|temporar|timeout|timed out|overloaded/i.test(message);
}

export async function renderImage({
  model,
  imagePath,
  apiKey,
  budget,
  maxCostUsd,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  model: string;
  imagePath: string;
  apiKey: string;
  budget: BudgetCounter;
  maxCostUsd: number;
  fetchImpl?: Fetch;
  timeoutMs?: number;
}): Promise<RenderResult> {
  // Throws before any network call when the worst case would cross the cap: the guard is the point.
  budget.assertCanSpend(maxCostUsd);

  const image = await readFile(imagePath);
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${OPENROUTER_API_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: RESTORATION_PROMPT },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
            ],
          },
        ],
        // Without this, an image-capable model answers in text.
        modalities: ["image", "text"],
        usage: { include: true },
      }),
    });

    const responseText = await response.text();
    let raw: OpenRouterImageResponse;
    try {
      raw = JSON.parse(responseText) as OpenRouterImageResponse;
    } catch {
      raw = { error: { message: responseText || `HTTP ${response.status}` } };
    }

    const latencyMs = performance.now() - startedAt;
    const cost = typeof raw.usage?.cost === "number" && Number.isFinite(raw.usage.cost) ? raw.usage.cost : 0;
    if (cost > 0) budget.record(cost);

    if (!response.ok) {
      const message = raw.error?.message ?? responseText;
      if (isTransient({ status: response.status, message })) {
        return {
          status: "inconclusive",
          reason: "transient_error",
          detail: `HTTP ${response.status}: ${message}`,
          latencyMs,
          actualCostUsd: cost,
        };
      }
      return {
        status: "failure",
        reason: "no_image",
        detail: `HTTP ${response.status}: ${message}`,
        latencyMs,
        actualCostUsd: cost,
        raw,
      };
    }

    const decoded = decodeImageResponse(raw);
    return { ...decoded, latencyMs, actualCostUsd: cost, raw };
  } catch (error) {
    return {
      status: "inconclusive",
      reason: "transient_error",
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: performance.now() - startedAt,
      actualCostUsd: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npm run verify13`
Expected: PASS, 33 tests.

- [ ] **Step 5: Commit**

```bash
git add spike13/
git commit -m "feat(spike-t13): appel OpenRouter image vers image et modes d'échec nommés"
```

---

### Task 5: `run.ts` — la grille, reprise-safe et sous plafond

**Files:**
- Create: `spike13/run.ts`
- Test: `spike13/run.test.ts`

**Interfaces:**
- Consumes: `LADDER`, `modelSlug` (Task 3) ; `renderImage`, `requireOpenRouterApiKey` (Task 4) ; `BudgetCounter` (Task 1).
- Produces: `type Cell = { model: string; dish: string; pass: 1 | 2 }`, `buildGrid(dishes: readonly string[]): Cell[]`, `renderPath({ model, dish, pass, mediaType }): string`, `sidecarPath({ model, dish, pass }): string`. Script `npm run run13`.

**Prérequis bloquant :** les 4 photos doivent avoir été ingérées (`spike13/fixtures/dishes/*.jpg`). L'étape 1 ci-dessous est une sonde manuelle qui dépense de l'argent réel.

- [ ] **Step 1: Sonde de forme — un appel réel, avant d'écrire la grille**

Confirme la forme de réponse en sortie image, qui n'est pas documentée avec certitude. Un seul appel, sur le modèle le moins cher :

```bash
node --env-file=.env -e '
const { readFileSync, writeFileSync } = require("node:fs");
const image = readFileSync("spike13/fixtures/dishes/recadre1.jpg").toString("base64");
fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "openai/gpt-5-image-mini",
    messages: [{ role: "user", content: [
      { type: "text", text: "Restaure cette photo." },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
    ]}],
    modalities: ["image", "text"],
    usage: { include: true },
  }),
}).then((r) => r.text()).then((t) => {
  writeFileSync("/tmp/t13-probe.json", t);
  const raw = JSON.parse(t);
  const message = raw.choices?.[0]?.message ?? {};
  console.log("clés de message :", Object.keys(message));
  console.log("images :", Array.isArray(message.images) ? message.images.length : "absent");
  console.log("préfixe url :", message.images?.[0]?.image_url?.url?.slice(0, 40) ?? "-");
  console.log("coût :", raw.usage?.cost);
});
'
```

**Si la sortie montre `images: 1` et une url commençant par `data:image/`,** `decodeImageResponse` est bon : continuer.
**Sinon,** lire `/tmp/t13-probe.json`, corriger `decodeImageResponse` et son test dans Task 4 pour coller à la forme réelle, puis revenir ici. Ne pas continuer sur une supposition.

- [ ] **Step 2: Écrire les tests**

`spike13/run.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { buildGrid, renderPath, sidecarPath } from "./run.js";

describe("buildGrid", () => {
  it("pairs every model with every dish, twice", () => {
    expect(buildGrid(["recadre1", "recadre2", "brut1", "brut2"])).toHaveLength(32);
  });

  it("runs both passes of a cell before moving on, so a divergence shows up early", () => {
    const grid = buildGrid(["recadre1"]);
    expect(grid[0]).toMatchObject({ dish: "recadre1", pass: 1 });
    expect(grid[1]).toMatchObject({ dish: "recadre1", pass: 2 });
    expect(grid[0]?.model).toBe(grid[1]?.model);
  });

  it("starts from the cheapest model", () => {
    expect(buildGrid(["recadre1"])[0]?.model).toBe("openai/gpt-5-image-mini");
  });
});

describe("renderPath", () => {
  it("gives every render its own path, one directory per model", () => {
    expect(renderPath({ model: "google/gemini-2.5-flash-image", dish: "recadre1", pass: 2, mediaType: "image/png" })).toBe(
      "spike13/fixtures/renders/google__gemini-2.5-flash-image/recadre1-2.png",
    );
  });

  it("follows the media type the model actually returned", () => {
    expect(renderPath({ model: "openai/gpt-5.4-image-2", dish: "brut1", pass: 1, mediaType: "image/jpeg" })).toBe(
      "spike13/fixtures/renders/openai__gpt-5.4-image-2/brut1-1.jpg",
    );
  });
});

describe("sidecarPath", () => {
  it("sits next to the render and carries the outcome even when no image came back", () => {
    expect(sidecarPath({ model: "openai/gpt-5-image-mini", dish: "recadre1", pass: 1 })).toBe(
      "spike13/fixtures/renders/openai__gpt-5-image-mini/recadre1-1.json",
    );
  });
});
```

- [ ] **Step 3: Lancer les tests pour les voir échouer**

Run: `npm run verify13`
Expected: FAIL — `Cannot find module './run.js'`.

- [ ] **Step 4: Écrire `spike13/run.ts`**

```ts
#!/usr/bin/env node
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import { BudgetCounter } from "./budget.js";
import { LADDER, modelSlug } from "./models.js";
import { PROMPT_VERSION } from "./prompt.js";
import { renderImage, requireOpenRouterApiKey, type RenderResult } from "./openrouter.js";

// Two framings, kept apart on purpose: `recadre*` is cropped on the dish before ingestion, `brut*`
// keeps the wide shot with the neighbouring text column. A model that passes on one and fails on the
// other tells us whether T14 needs a crop step at upload; a single mixed batch would not.
export const DISHES = ["recadre1", "recadre2", "brut1", "brut2"] as const;
export const RENDERS_DIRECTORY = "spike13/fixtures/renders";
export const BUDGET_PATH = "spike13/fixtures/budget.json";

export type Cell = { model: string; dish: string; pass: 1 | 2 };

export function buildGrid(dishes: readonly string[]): Cell[] {
  return LADDER.flatMap((rung) =>
    dishes.flatMap((dish) => [
      { model: rung.model, dish, pass: 1 as const },
      { model: rung.model, dish, pass: 2 as const },
    ]),
  );
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function renderPath({
  model,
  dish,
  pass,
  mediaType,
}: {
  model: string;
  dish: string;
  pass: number;
  mediaType: string;
}): string {
  return `${RENDERS_DIRECTORY}/${modelSlug(model)}/${dish}-${pass}.${EXTENSIONS[mediaType] ?? "bin"}`;
}

export function sidecarPath({ model, dish, pass }: { model: string; dish: string; pass: number }): string {
  return `${RENDERS_DIRECTORY}/${modelSlug(model)}/${dish}-${pass}.json`;
}

// A cell is done as soon as its sidecar exists, whatever the outcome recorded in it. Rerunning the
// grid must never re-spend on a cell already answered — including one that answered "refusal".
async function alreadyDone(cell: Cell): Promise<boolean> {
  const directory = `${RENDERS_DIRECTORY}/${modelSlug(cell.model)}`;
  try {
    const entries = await readdir(directory);
    return entries.includes(`${cell.dish}-${cell.pass}.json`);
  } catch {
    return false;
  }
}

async function writeOutcome({ cell, result }: { cell: Cell; result: RenderResult }): Promise<void> {
  const directory = `${RENDERS_DIRECTORY}/${modelSlug(cell.model)}`;
  await mkdir(directory, { recursive: true });

  if (result.status === "image") {
    await writeFile(
      renderPath({ ...cell, mediaType: result.mediaType }),
      Buffer.from(result.base64, "base64"),
    );
  }

  const sidecar = {
    model: cell.model,
    dish: cell.dish,
    pass: cell.pass,
    promptVersion: PROMPT_VERSION,
    status: result.status,
    reason: "reason" in result ? result.reason : null,
    detail: "detail" in result ? result.detail : null,
    mediaType: result.status === "image" ? result.mediaType : null,
    latencyMs: Math.round(result.latencyMs),
    actualCostUsd: result.actualCostUsd,
  };
  await writeFile(sidecarPath(cell), `${JSON.stringify(sidecar, null, 2)}\n`);
}

async function main(): Promise<void> {
  const apiKey = requireOpenRouterApiKey();
  const budget = await BudgetCounter.load({ path: BUDGET_PATH });
  const grid = buildGrid(DISHES);
  const costByModel = new Map(LADDER.map((rung) => [rung.model, rung.maxCostUsdPerCall]));

  console.log(`Grille : ${grid.length} cellules · déjà dépensé ${budget.spent.toFixed(4)} USD / ${budget.cap} USD.`);

  for (const cell of grid) {
    if (await alreadyDone(cell)) {
      console.log(`− ${cell.model} ${cell.dish} passe ${cell.pass} : déjà fait, non rappelé.`);
      continue;
    }

    const maxCostUsd = costByModel.get(cell.model);
    if (maxCostUsd === undefined) throw new Error(`Modèle hors échelle : ${cell.model}.`);

    const result = await renderImage({
      model: cell.model,
      imagePath: resolve("spike13/fixtures/dishes", `${cell.dish}.jpg`),
      apiKey,
      budget,
      maxCostUsd,
    });

    // Saved after every call, not at the end: a crash mid-grid must not lose the spending record.
    await budget.save(BUDGET_PATH);
    await writeOutcome({ cell, result });

    const suffix = result.status === "image" ? "" : ` (${"reason" in result ? result.reason : "?"})`;
    console.log(
      `→ ${cell.model} ${cell.dish} passe ${cell.pass} : ${result.status}${suffix} · ` +
        `${result.actualCostUsd.toFixed(5)} USD · ${Math.round(result.latencyMs)} ms`,
    );
  }

  console.log(`Terminé. Dépense totale : ${budget.spent.toFixed(4)} USD. Lance « npm run review13 ».`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npm run verify13`
Expected: PASS, 39 tests.

- [ ] **Step 6: Lancer la grille**

Run: `npm run run13`
Expected: 32 cellules traitées. Une `BudgetExceededError` est un arrêt **correct**, pas un bug : relancer après avoir vérifié la dépense dans `spike13/fixtures/budget.json`. Relancer la commande ne redépense sur aucune cellule déjà traitée.

- [ ] **Step 7: Commit**

```bash
git add spike13/run.ts spike13/run.test.ts
git commit -m "feat(spike-t13): grille quatre modèles par quatre plats par deux passes"
```

---

### Task 6: `review.ts` — la page de jugement, et le verdict

**Files:**
- Create: `spike13/review.ts`
- Create: `spike13/RESULTS.md`
- Test: `spike13/review.test.ts`

**Interfaces:**
- Consumes: `LADDER`, `modelSlug` (Task 3) ; `DISHES`, `RENDERS_DIRECTORY` (Task 5).
- Produces: `renderReviewHtml(cells: ReviewCell[]): string` où `type ReviewCell = { model: string; dish: string; pass: number; imageSrc: string | null; status: string; detail: string | null; costUsd: number; latencyMs: number }`. Script `npm run review13` écrivant `spike13/review.html`.

- [ ] **Step 1: Écrire les tests**

`spike13/review.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { renderReviewHtml } from "./review.js";

const CELL = {
  model: "openai/gpt-5-image-mini",
  dish: "recadre1",
  pass: 1,
  imageSrc: "fixtures/renders/openai__gpt-5-image-mini/recadre1-1.png",
  status: "image",
  detail: null,
  costUsd: 0.0123,
  latencyMs: 4200,
};

describe("renderReviewHtml", () => {
  it("shows renders at 200px tall, the size the storefront actually uses", () => {
    expect(renderReviewHtml([CELL])).toContain("--judge-height: 200px");
  });

  it("offers a full-size toggle, because an enlargement stays on the table", () => {
    const html = renderReviewHtml([CELL]);
    expect(html).toContain("Pleine taille");
  });

  it("puts the original next to every render, since the criterion is identity of the dish", () => {
    expect(renderReviewHtml([CELL])).toContain("fixtures/dishes/recadre1.jpg");
  });

  it("shows a failed cell as a named outcome instead of a broken image", () => {
    const html = renderReviewHtml([
      { ...CELL, imageSrc: null, status: "failure", detail: "refusal: I can't help with that." },
    ]);
    expect(html).toContain("refusal");
    expect(html).not.toContain("<img src=\"null\"");
  });

  it("escapes a detail carrying markup rather than injecting it into the page", () => {
    const html = renderReviewHtml([{ ...CELL, imageSrc: null, status: "failure", detail: "<script>x</script>" }]);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("reports cost and latency, which is what picks the cheapest model that passes", () => {
    const html = renderReviewHtml([CELL]);
    expect(html).toContain("0.01230");
    expect(html).toContain("4200");
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npm run verify13`
Expected: FAIL — `Cannot find module './review.js'`.

- [ ] **Step 3: Écrire `spike13/review.ts`**

```ts
#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LADDER, modelSlug } from "./models.js";
import { DISHES, RENDERS_DIRECTORY } from "./run.js";

export type ReviewCell = {
  model: string;
  dish: string;
  pass: number;
  imageSrc: string | null;
  status: string;
  detail: string | null;
  costUsd: number;
  latencyMs: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderReviewHtml(cells: ReviewCell[]): string {
  const byDish = DISHES.map((dish) => ({ dish, cells: cells.filter((cell) => cell.dish === dish) }));

  const sections = byDish
    .map(
      ({ dish, cells: dishCells }) => `
    <section>
      <h2>${escapeHtml(dish)}</h2>
      <div class="row">
        <figure class="original">
          <img src="fixtures/dishes/${escapeHtml(dish)}.jpg" alt="originale ${escapeHtml(dish)}">
          <figcaption>Originale</figcaption>
        </figure>
        ${dishCells
          .map(
            (cell) => `
        <figure>
          ${
            cell.imageSrc
              ? `<img src="${escapeHtml(cell.imageSrc)}" alt="${escapeHtml(cell.model)} passe ${cell.pass}">`
              : `<div class="failed">${escapeHtml(cell.status)}${cell.detail ? ` — ${escapeHtml(cell.detail)}` : ""}</div>`
          }
          <figcaption>
            ${escapeHtml(cell.model)} · passe ${cell.pass}<br>
            ${cell.costUsd.toFixed(5)} USD · ${Math.round(cell.latencyMs)} ms
          </figcaption>
        </figure>`,
          )
          .join("")}
      </div>
    </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Spike T13 — jugement des rendus</title>
<style>
  :root { --judge-height: 200px; }
  body { font-family: ui-serif, Georgia, serif; margin: 2rem; background: #F7F3EA; color: #2E2723; }
  .row { display: flex; gap: 1rem; overflow-x: auto; align-items: flex-start; padding-bottom: 1rem; }
  figure { margin: 0; flex: 0 0 auto; }
  img { height: var(--judge-height); width: auto; display: block; }
  body.full img { height: auto; max-width: 90vw; }
  .original img { outline: 2px solid #9A5B2B; }
  .failed { height: var(--judge-height); width: 260px; display: flex; align-items: center;
            padding: 0.5rem; font-size: 0.8rem; background: #EFE7DA; overflow: auto; }
  figcaption { font-size: 0.75rem; margin-top: 0.35rem; max-width: 260px; }
  h2 { border-bottom: 1px solid #C6BDB4; padding-bottom: 0.25rem; }
  button { font: inherit; padding: 0.4rem 0.8rem; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<h1>Spike T13 — jugement des rendus</h1>
<ol>
  <li>
    <strong>Barrière 1, éliminatoire — est-ce une vraie photographie ?</strong> Ni trame
    d'impression, ni grain de papier, ni perspective de page oblique, ni bord de feuille. Le
    redressement, le recadrage et le remplacement du fond sont autorisés.
  </li>
  <li>
    <strong>Barrière 2, éliminatoire mais tolérante — le plat reste-t-il reconnaissable ?</strong>
    Éliminatoire seulement si le plat n'est plus reconnaissable. Un ustensile ajouté, une garniture
    retouchée, un motif de pâte redessiné se notent comme écarts observés, sans disqualifier.
  </li>
  <li>
    <strong>Barrière 3, justification — le gain se voit-il ?</strong> À 200 px comme en pleine
    taille.
  </li>
</ol>
<button onclick="document.body.classList.toggle('full')">Pleine taille / 200 px</button>
${sections}
</body>
</html>
`;
}

async function collectCells(): Promise<ReviewCell[]> {
  const cells: ReviewCell[] = [];
  for (const rung of LADDER) {
    const directory = `${RENDERS_DIRECTORY}/${modelSlug(rung.model)}`;
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      continue;
    }
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const sidecar = JSON.parse(await readFile(resolve(directory, entry), "utf8")) as {
        dish: string;
        pass: number;
        status: string;
        reason: string | null;
        detail: string | null;
        mediaType: string | null;
        latencyMs: number;
        actualCostUsd: number;
      };
      const extension = sidecar.mediaType === "image/jpeg" ? "jpg" : sidecar.mediaType === "image/webp" ? "webp" : "png";
      cells.push({
        model: rung.model,
        dish: sidecar.dish,
        pass: sidecar.pass,
        imageSrc:
          sidecar.status === "image"
            ? `fixtures/renders/${modelSlug(rung.model)}/${sidecar.dish}-${sidecar.pass}.${extension}`
            : null,
        status: sidecar.reason ?? sidecar.status,
        detail: sidecar.detail,
        costUsd: sidecar.actualCostUsd,
        latencyMs: sidecar.latencyMs,
      });
    }
  }
  return cells;
}

async function main(): Promise<void> {
  const cells = await collectCells();
  await writeFile("spike13/review.html", renderReviewHtml(cells));
  console.log(`spike13/review.html écrit (${cells.length} cellules). Ouvre-le et juge les trois barrières.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npm run verify13`
Expected: PASS, 45 tests.

- [ ] **Step 5: Créer le carnet de résultats**

`spike13/RESULTS.md` :

```markdown
# Résultats — Spike T13

## Protocole

- Prompt : `v1`
- Normalisation : 2000 px sur le grand côté, sRGB, JPEG q80
- Plafond : 10 USD
- Grille : 4 modèles × 4 plats × 2 passes

Les barrières sont celles de la spec révisée le 2026-08-10 : la crédibilité photographique décide,
la fidélité au plat n'est plus qu'un plancher de reconnaissabilité.

## Barrière 1 — est-ce une vraie photographie ?

Éliminatoire. Une croix par passe dont le rendu ne se lit plus comme une photo de photo : ni trame
d'impression, ni grain de papier, ni perspective de page oblique, ni bord de feuille. Le
redressement, le recadrage et le remplacement du fond sont autorisés.

| Modèle | recadre1 p1 | recadre1 p2 | recadre2 p1 | recadre2 p2 | brut1 p1 | brut1 p2 | brut2 p1 | brut2 p2 | Coût moyen | Latence moyenne | Mode d'échec observé |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `openai/gpt-5-image-mini` | — | — | — | — | — | — | — | — | — | — | — |
| `google/gemini-2.5-flash-image` | — | — | — | — | — | — | — | — | — | — | — |
| `google/gemini-3.1-flash-lite-image` | — | — | — | — | — | — | — | — | — | — | — |
| `openai/gpt-5.4-image-2` | — | — | — | — | — | — | — | — | — | — | — |

## Barrière 2 — le plat reste-t-il reconnaissable ?

Éliminatoire, mais seulement si le plat n'est plus reconnaissable. Les écarts qui ne disqualifient
pas se consignent quand même : c'est le prix accepté de la barrière 1, et il doit être écrit.

| Modèle | Reconnaissable partout ? | Écarts observés non éliminatoires |
|---|---|---|
| `openai/gpt-5-image-mini` | — | — |
| `google/gemini-2.5-flash-image` | — | — |
| `google/gemini-3.1-flash-lite-image` | — | — |
| `openai/gpt-5.4-image-2` | — | — |

## Barrière 3 — le gain se voit-il ?

Jugée sur le modèle le moins cher ayant passé les barrières 1 et 2.

- À 200 px de haut : à renseigner
- En pleine taille : à renseigner
- Conséquence sur T14 : à renseigner — l'une des trois issues de la spec (T14 tel que spécifié /
  T14 plus un agrandissement en vitrine / T14 tombe)

## Accord entre les deux passes

- Nombre de couples (modèle, plat) dont les deux passes rendent le même verdict : à renseigner
- Verdict sur le bouton « régénérer » de T14 : à renseigner

## Verdict

- `BEAUTIFY_MODEL` : à renseigner
- Version du prompt : à renseigner
- Coût moyen par image : à renseigner (USD)
- Latence moyenne : à renseigner
- Dépense totale : à renseigner (USD)
- Verdict T13 : **à renseigner explicitement — positif ou négatif**

Un verdict négatif clôt T13 et annule T14. Le constat reste utile : il dit que la photo de plat
se publie telle quelle, sans embellissement.
```

- [ ] **Step 6: Produire la page et juger**

Run: `npm run review13`, puis ouvrir `spike13/review.html`.

Remplir `RESULTS.md` : barrières 1 et 2 d'abord, sur toute la grille, en consignant les écarts non éliminatoires ; puis barrière 3 sur le modèle le moins cher qui a franchi les deux premières ; puis l'accord entre passes ; puis le verdict.

- [ ] **Step 7: Commiter le code, le verdict et les seuls rendus retenus**

Les rendus sont gitignorés. Ne forcer que ceux du modèle retenu :

```bash
git add spike13/review.ts spike13/review.test.ts spike13/RESULTS.md
git add -f spike13/fixtures/renders/<slug-du-modèle-retenu>/
git commit -m "feat(spike-t13): page de jugement, verdict et rendus du modèle retenu"
```

- [ ] **Step 8: Répercuter le verdict dans le plan de tâches**

Dans `docs/superpowers/specs/2026-08-08-table-des-recettes-tasks.md`, cocher T13 et y inscrire les trois conséquences :

1. **T12** — pas de second fournisseur ni de clé Google directe : l'embellissement passe par la clé OpenRouter existante.
2. **T5** — `src/lib/compress.ts` doit normaliser à 2000 px / q80, exactement comme le banc ; une réduction plus agressive invaliderait le verdict de T13.
3. **T14** — l'issue de la barrière 3, et le verdict sur l'utilité du bouton « régénérer » tiré de l'accord entre passes.

```bash
git add docs/superpowers/specs/2026-08-08-table-des-recettes-tasks.md
git commit -m "docs(spike-t13): répercuter le verdict sur T5, T12 et T14"
```

---

## Ce que ce plan ne fait pas

- **Aucun code applicatif.** `convex/`, `src/` et le schéma ne sont pas touchés. T13 est un banc jetable ; c'est T14 qui construira la fonctionnalité, et seulement si le verdict est positif.
- **Aucune marche par échelons.** La grille complète remplace le parcours, par décision de cadrage : 4 barreaux à ~1 $ ne justifient aucune machinerie et la grille discrimine mieux.
- **Aucun test des trois barreaux chers.** `openai/gpt-5-image`, `google/gemini-3.1-flash-image` et `google/gemini-3-pro-image` sont hors périmètre, arbitré le 2026-08-10. Un verdict négatif ne condamne donc que la moitié basse de l'échelle.
- **Aucune notation quantitative de la qualité.** Le critère est binaire et humain.
- **Aucun test des deux modèles `-preview`.** Doublons de leurs équivalents stables.
