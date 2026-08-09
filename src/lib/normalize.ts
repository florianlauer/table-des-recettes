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
