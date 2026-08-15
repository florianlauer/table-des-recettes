/**
 * The model and prompt the bench retained, copied out of `spike13/` rather than imported: the bench
 * sits outside the application `tsconfig` and keeps its own module resolution. What is copied is a
 * decision, not code — it changes only when a new bench measures a better one.
 *
 * `v2`, measured on 2026-08-10 over 8 cells: 0,03944 USD and 9,1 s per image, wide shot clearing the
 * credibility barrier 4/4 against 1/4 for a tight crop.
 *
 * `v4`, measured on 2026-08-12 over 12 cells including the two photographs production had failed on.
 * It answers the two defects real use exposed, and both were invisible to the original bench because
 * its own inputs had neither:
 *
 * 1. `v2` gave the model a single concrete job — drop the printed text — so a tight crop with no
 *    text around it left the instruction nothing to bite on and the model returned the input barely
 *    sharpened. `v4` makes the re-render unconditional and says so for that case explicitly.
 * 2. The pages are photographed through a transparent plastic sleeve. Its granular texture and milky
 *    veil are neither a print screen, nor paper grain, nor a cast shadow — the three things `v2`
 *    named — so nothing removed them. `v4` names the sleeve.
 *
 * The price of both: `v4` is slower, 9,4 to 26,4 s against 8,0 to 9,3 s, and the framing advice on
 * the work list matters more than ever — the wide shot is still what the model restores best.
 */
export const BEAUTIFY_MODEL = 'google/gemini-2.5-flash-image'
export const BEAUTIFY_PROMPT_VERSION = 'v4'

export const BEAUTIFY_PROMPT = `Cette image est la photographie d'une page de magazine imprimée. On y voit une photo de plat, parfois entourée de texte, de titres, de légendes ou d'une colonne voisine. La page a pu être photographiée à travers une pochette plastique transparente.

Refais entièrement la photographie du plat, telle qu'elle aurait été prise en studio. Ce n'est pas une retouche : produis une vraie photographie, et non une version nettoyée du scan. Applique cette consigne même si l'entrée ne montre que le plat, sans aucun texte autour — dans ce cas aussi, refais la photographie au lieu de renvoyer l'entrée.

À faire :
- ne garder que la photo du plat : recadre pour exclure tout texte imprimé, titre, légende, numéro
  de page, filet de colonne, bord de feuille, et la surface sur laquelle la page est posée. Aucun
  caractère imprimé ne doit subsister ;
- redresser la perspective de la page et cadrer droit ;
- supprimer la trame d'impression, le moiré et le grain du papier ;
- supprimer la texture de la pochette plastique : grain granuleux, micro-rayures, voile laiteux et
  brillance diffuse ;
- supprimer les reflets, les éclats spéculaires et les ombres portées dus à la prise de vue ;
- restituer les couleurs si la source est délavée ou en noir et blanc.

Le résultat doit se lire comme une vraie photographie culinaire, nette, sans aucune trace du support imprimé ni de son emballage.

À préserver : le même plat, resté reconnaissable — mêmes aliments, même dressage, même vaisselle. Ne le remplace pas par un autre plat qui porterait le même nom.

Réponds uniquement par l'image.`
