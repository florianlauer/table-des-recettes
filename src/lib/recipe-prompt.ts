// v4 belongs to T11 (open PR #10): it hardens the inferred ingredient list and was validated by a
// paid replay campaign. The multi-page instruction below is a separate change, hence v5.
export const PROMPT_VERSION = 'v5'

export const EXTRACTION_PROMPT = `Tu extrais fidèlement toutes les recettes visibles sur une ou plusieurs pages de magazine françaises.

Les images qui te sont fournies sont les pages d'une même source, dans leur ordre de lecture. Une recette peut être à cheval sur deux d'entre elles — commencer sur l'une et se poursuivre sur la suivante. Dans ce cas, rends-la une seule fois, en réunissant ses ingrédients et ses étapes dans l'ordre. Ne rends jamais deux fois la même recette, et ne fusionne jamais deux recettes distinctes sous prétexte qu'elles se suivent.

Une page peut contenir plusieurs coupures recollées, des colonnes, des photos, des encadrés et des textes qui se chevauchent visuellement. Commence par identifier les frontières de chaque recette. Ne fusionne jamais deux recettes et ne transforme jamais une légende, une publicité ou un texte décoratif en recette.

Pour chaque recette, respecte ces règles :
- Recopie le titre sans l'inventer. Si le titre manque réellement, utilise une description minimale fondée uniquement sur le texte visible.
- Choisis type parmi entree, plat, dessert, apero, petitDej ou autre.
- Renseigne servings comme un nombre entier de portions, sans unité ni aucun texte. Si la page annonce une fourchette, par exemple « pour 6 à 8 personnes », retiens la borne basse. Utilise null seulement si l'information est absente ou illisible.
- Si la recette imprime une liste d'ingrédients, produis exactement une entrée ingredients par ligne visible, dans l'ordre. Pose ingredientsInferred à false et ne fusionne, ne divise, n'ajoute et ne déduis aucune ligne.
- Si la recette n'imprime aucune liste d'ingrédients, reconstitue ingredients uniquement depuis les étapes, dans l'ordre de la prose, et pose ingredientsInferred à true.
- raw est la transcription complète de la ligne imprimée ou, pour une liste reconstituée, la formulation littérale de l'ingrédient et de sa quantité dans les étapes, sans recopier l'instruction entière.
- quantity est un nombre nu, sans unité ni texte, tandis que unit et label sont textuels. Ils décrivent la ligne raw sans perdre son texte. Utilise null pour chaque sous-champ absent ou incertain ; n'invente aucune valeur.
- Recopie toutes les étapes dans leur ordre de lecture. Conserve une étape par instruction éditoriale ; ne résume pas, ne réordonne pas et ne complète pas avec tes connaissances culinaires.

Ignore les temps de préparation et de cuisson, les conseils, les variantes, les accords, les crédits et les informations nutritionnelles. En cas d'incertitude, reste littéral et utilise null uniquement pour les champs qui l'autorisent. Retourne seulement l'objet JSON conforme au schéma fourni.`
