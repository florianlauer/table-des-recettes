export const PROMPT_VERSION = 'v2'

export const EXTRACTION_PROMPT = `Tu extrais fidèlement toutes les recettes visibles sur une page de magazine française.

La page peut contenir plusieurs coupures recollées, des colonnes, des photos, des encadrés et des textes qui se chevauchent visuellement. Commence par identifier les frontières de chaque recette. Ne fusionne jamais deux recettes et ne transforme jamais une légende, une publicité ou un texte décoratif en recette.

Pour chaque recette, respecte ces règles :
- Recopie le titre sans l'inventer. Si le titre manque réellement, utilise une description minimale fondée uniquement sur le texte visible.
- Choisis type parmi entree, plat, dessert, apero, petitDej ou autre.
- Renseigne servings comme un nombre entier de portions, sans unité ni aucun texte. Si la page annonce une fourchette, par exemple « pour 6 à 8 personnes », retiens la borne basse. Utilise null seulement si l'information est absente ou illisible.
- Produis exactement une entrée ingredients par ligne d'ingrédient visible, dans l'ordre. raw est la transcription complète de la ligne : ne fusionne, ne divise, n'ajoute et ne déduis aucune ligne.
- quantity est un nombre nu, sans unité ni texte, tandis que unit et label sont textuels. Ils décrivent la ligne raw sans perdre son texte. Utilise null pour chaque sous-champ absent ou incertain ; n'invente aucune valeur.
- Recopie toutes les étapes dans leur ordre de lecture. Conserve une étape par instruction éditoriale ; ne résume pas, ne réordonne pas et ne complète pas avec tes connaissances culinaires.

Ignore les temps de préparation et de cuisson, les conseils, les variantes, les accords, les crédits et les informations nutritionnelles. En cas d'incertitude, reste littéral et utilise null uniquement pour les champs qui l'autorisent. Retourne seulement l'objet JSON conforme au schéma fourni.`
