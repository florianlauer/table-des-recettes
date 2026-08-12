/**
 * The model and prompt T13 retained, copied out of `spike13/` rather than imported: the bench sits
 * outside the application `tsconfig` and keeps its own module resolution. What is copied is a
 * decision, not code — it changes only when a new bench measures a better one.
 *
 * Measured on 2026-08-10 over 8 cells: 0,03944 USD and 9,1 s per image, wide shot clearing the
 * credibility barrier 4/4 against 1/4 for a tight crop.
 */
export const BEAUTIFY_MODEL = 'google/gemini-2.5-flash-image'
export const BEAUTIFY_PROMPT_VERSION = 'v2'

// Per-call cost measured by the bench. The alert compares against a multiple of it — it never
// prevents a call, since the price is only known once the answer is billed.
export const BEAUTIFY_EXPECTED_COST_USD = 0.03944
export const BEAUTIFY_COST_ALERT_FACTOR = 3

export function costLooksExcessive(costUsd: number): boolean {
  return costUsd > BEAUTIFY_EXPECTED_COST_USD * BEAUTIFY_COST_ALERT_FACTOR
}

export const BEAUTIFY_PROMPT = `Cette image est la photographie d'une page de magazine imprimée. On y voit une photo de plat, parfois entourée de texte, de titres, de légendes ou d'une colonne voisine.

Produis la photographie du plat seul, telle qu'elle aurait été prise dans de bonnes conditions.

À faire :
- ne garder que la photo du plat : recadre pour exclure tout texte imprimé, titre, légende, numéro
  de page, filet de colonne, bord de feuille, et la surface sur laquelle la page est posée. Aucun
  caractère imprimé ne doit subsister ;
- redresser la perspective de la page et cadrer droit ;
- supprimer la trame d'impression, le moiré et le grain du papier ;
- supprimer les reflets et les ombres portées dus à la prise de vue ;
- restituer les couleurs si la source est délavée ou en noir et blanc.

Le résultat doit se lire comme une vraie photographie, pas comme le scan d'une page imprimée.

À préserver : le même plat, resté reconnaissable — mêmes aliments, même dressage, même vaisselle. Ne
le remplace pas par un autre plat qui porterait le même nom.

Réponds uniquement par l'image.`
