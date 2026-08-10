# Pages du Spike T1

Ne placez ici que les JPEG produits par `npm run ingest -- <role> [source]`. Les originaux restent
dans `~/Downloads/table-des-recettes-inbox/`.

Le second argument découple le rôle dans le protocole du nom de la photo :
`npm run ingest -- B collage3` lit `collage3.jpeg` et écrit `b.jpg`.

## Correspondance rôle / source

| Rôle | Source      | Cas                                                              |         Nombre réel de recettes | Ingestion                   |
| ---- | ----------- | ---------------------------------------------------------------- | ------------------------------: | --------------------------- |
| A    | `mono1`     | Mono-recette — Cabillaud à la milanaise                          |                               1 | Faite                       |
| B    | `4recettes` | Page 2×2, quatre recettes, traits de découpe                     |                               4 | Faite                       |
| C    | `complexe`  | Texte sur photo, contraste faible, surface incurvée et brillante |                               1 | Faite                       |
| D    | `duo2`      | Acceptation — collage de deux fiches découpées                   | Non utilisé avant l'acceptation | À faire après gel du prompt |

Le nombre réel de recettes de A, B et C est la seule vérité terrain de ces trois pages : une erreur
de saisie y rend le critère de segmentation faux sans que rien ne le signale. Valeurs relevées à
l'œil et **confirmées** par l'auteur le 2026-08-09.

### Ce que la page B piège, en plus de la segmentation

- **Les en-têtes de pays ne sont pas les titres.** « MEXIQUE » est plus gros et plus contrasté que
  « Dinde aux piments et au cacao ». Remonter le mauvais des deux échoue le critère « titre exact ».
- **« Le conseil de Danone » n'est ni ingrédient ni étape** : de l'éditorial en fin de bloc. Le
  verser dans `steps` est une invention silencieuse, difficile à voir à l'œil.
- **Les ingrédients sont un flux inline** (`Marché. 2 filets de dinde de 500 g • 20 g de cacao
brut • …`) et non une liste verticale : c'est le test du découpage ligne à ligne de `raw`, avec un
  vrai risque de fusion.
- **« Pour 6 à 8 personnes »** alors que `servings` est un `number | null`. Tranché depuis : le prompt
  v2 impose la **borne basse**, donc `6`. Transcris la vérité terrain avec cette même règle ; la
  question se reposera en T6 sur le recalcul de portions.

## Prompt v2 — la page D n'est pas périmée

Le prompt est passé en `v2` le 2026-08-09 : v1 ne disait rien des fourchettes de portions, et
`gemini-2.5-flash-lite` a rendu `"6 à 8 personnes"` — une chaîne — dans un champ déclaré `number`,
chez `google-ai-studio` comme chez `google-vertex`. v2 impose la borne basse et interdit l'unité.

La règle de péremption du plan brûle la page d'acceptation quand le prompt change, parce qu'une
vérité terrain transcrite sous une convention ne peut pas juger une sortie produite sous une autre.
**Elle ne s'applique pas ici : D n'avait été ni ingérée ni transcrite.** `duo2` reste scellée et
valable. La réécriture unique autorisée est en revanche consommée.

## Réserve

`duo1`, `duo3`, `mono2`, `mono3` restent dans l'inbox. Le protocole exige une page d'acceptation
**fraîche par candidat** : si un candidat est recalé sur D, le suivant est jugé sur E, puis F, tirées
de cette réserve.

`duo1` mérite une mention : un titre unique (« Le soufflé au fromage ») coiffe deux recettes
distinctes, version tradi et version light. C'est la segmentation la plus ambiguë du lot — un humain
hésite entre une recette et deux. Bonne page d'acceptation sévère.

## Ordre humain obligatoire

1. Photographier toutes les pages, originaux dans l'inbox.
2. `npm run ingest -- A mono1`, `npm run ingest -- B 4recettes`, `npm run ingest -- C complexe`. — fait.
3. Renseigner le nombre réel de recettes ci-dessus. — fait.
4. Geler `prompt v1` par un commit — déjà fait (`5f4fbd6`).
5. Seulement ensuite : `npm run ingest -- D duo2`, ouvrir D et transcrire sa vérité terrain au
   chronomètre.
