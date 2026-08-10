// v1 was written before any render was seen. The spec allows a single rewrite to v2, which replays
// the grid; there is no v3, otherwise the prompt would be tuned on these four photos alone and the
// verdict would not generalise. v1 is kept exported so its renders on disk stay attributable.
export const PROMPT_V1 = `Restaure cette photographie d'un plat, prise en photo dans un magazine imprimé.

À corriger :
- la perspective et le cadrage, pour rendre la photo droite ;
- la trame d'impression, le moiré et le grain du papier ;
- les reflets et les ombres portées dus à la prise de vue ;
- les couleurs, à restituer fidèlement si la source est délavée ou en noir et blanc.

Interdit, sans exception : ne modifie pas le plat, son dressage, la vaisselle, les couverts, la
nappe, ni aucun ingrédient visible. N'ajoute aucun élément qui n'est pas déjà dans l'image.
N'invente pas de hors-champ. Le résultat doit montrer exactement le même plat, photographié dans
de meilleures conditions.

Réponds uniquement par l'image restaurée.`

// v2 changes two things, both learned from the v1 renders. It says out loud that the source is a
// magazine page and that only the dish photograph must survive — v1 never asked for the text to go,
// so a wide shot kept its neighbouring column. And it drops v1's blanket ban on touching anything,
// which forbade the reframing the crop needs; the floor is now recognisability, matching the barrier
// order chosen on 2026-08-10.
export const PROMPT_V2 = `Cette image est la photographie d'une page de magazine imprimée. On y voit une photo de plat, parfois entourée de texte, de titres, de légendes ou d'une colonne voisine.

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

// v3 went past the spec's single-rewrite quota, overridden by florianlauer on 2026-08-10, then was
// MEASURED AND NOT RETAINED: it clears barrier 1 on 7 of 8 cells against v2's 5, but it drifts further
// from the source dish and costs 23% more latency (11.2s against 9.1s). Kept here as a documented
// fallback, not as the active prompt — if T14 sees tilted frames in real use, this is the wording to
// switch to, and its trade-off is already priced.
export const PROMPT_V3 = `Cette image est la photographie d'une page de magazine imprimée. On y voit une photo de plat, parfois entourée de texte, de titres, de légendes ou d'une colonne voisine.

Produis la photographie du plat seul, telle qu'elle aurait été prise dans de bonnes conditions.

Le résultat doit être **parfaitement droit**, comme pris d'aplomb : aucune inclinaison, aucune
rotation, aucun basculement. Les bords du cadre sont horizontaux et verticaux, l'assiette ou le plat
est vu de face ou de dessus, et rien ne penche — ni la table, ni l'horizon, ni le cadre lui-même.
Redresse la perspective oblique de la page photographiée jusqu'à la faire disparaître.

À faire également :
- ne garder que la photo du plat : recadre pour exclure tout texte imprimé, titre, légende, numéro
  de page, filet de colonne, bord de feuille, et la surface sur laquelle la page est posée. Aucun
  caractère imprimé ne doit subsister ;
- supprimer la trame d'impression, le moiré et le grain du papier ;
- supprimer les reflets et les ombres portées dus à la prise de vue ;
- restituer les couleurs si la source est délavée ou en noir et blanc.

Le résultat doit se lire comme une vraie photographie, pas comme le scan d'une page imprimée.

À préserver : le même plat, resté reconnaissable — mêmes aliments, même dressage, même vaisselle. Ne
le remplace pas par un autre plat qui porterait le même nom.

Réponds uniquement par l'image.`

// Retained on 2026-08-10 by florianlauer, after seeing both v2 and v3 renders side by side.
export const PROMPT_VERSION = 'v2'
export const RESTORATION_PROMPT = PROMPT_V2
