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
  const isWord = (part: string) => part !== "" && !/^\s+$/.test(part);

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
