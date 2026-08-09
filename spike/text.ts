export function normalizedText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();
}

export function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  const distances = Array.from({ length: normalizedRight.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= normalizedLeft.length; leftIndex += 1) {
    let diagonal = distances[0] ?? 0;
    distances[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= normalizedRight.length; rightIndex += 1) {
      const above = distances[rightIndex] ?? 0;
      const insertion = (distances[rightIndex - 1] ?? 0) + 1;
      const deletion = above + 1;
      const substitution = diagonal + (normalizedLeft[leftIndex - 1] === normalizedRight[rightIndex - 1] ? 0 : 1);
      distances[rightIndex] = Math.min(insertion, deletion, substitution);
      diagonal = above;
    }
  }
  const longest = Math.max(normalizedLeft.length, normalizedRight.length, 1);
  return 1 - (distances[normalizedRight.length] ?? longest) / longest;
}

// Une coquille ne déplace jamais un chiffre. Comparer les suites de chiffres est donc le garde-fou
// le moins cher contre la dérive la plus coûteuse : « 500 g » relu en « 50 g » passerait inaperçu
// à la lecture et fausserait la recette.
export function digitRuns(value: string): string[] {
  return value.match(/\d+/g) ?? [];
}

export function sameDigits(left: string, right: string): boolean {
  const leftRuns = digitRuns(left);
  const rightRuns = digitRuns(right);
  return leftRuns.length === rightRuns.length && leftRuns.every((run, index) => run === rightRuns[index]);
}
