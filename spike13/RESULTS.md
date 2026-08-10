# Résultats — Spike T13

## Protocole

- Prompt retenu : **`v2`**, la réécriture unique autorisée par la spec, consommée parce que les
  quatre modèles laissaient subsister le texte imprimé voisin sur les plans larges.
- `v3` a été écrit et mesuré — dépassement de quota arbitré par florianlauer, des cadres inclinés
  revenant malgré `v2`. **Mesuré puis non retenu** : voir « La réserve `v3` » plus bas. Il reste
  exporté dans `spike13/prompt.ts` comme repli documenté, gardé par un test qui vérifie qu'il n'est
  pas actif.
- Normalisation : 2000 px sur le grand côté, sRGB, JPEG q80
- Plafond : 10 USD — **dépensé 2,2924 USD**
- Grille couverte : 49 cellules, dont les **8 du modèle retenu sous `v2` et ses 8 sous `v3`**

Les barrières sont celles de la spec révisée le 2026-08-10 : la crédibilité photographique décide,
la fidélité au plat n'est plus qu'un plancher de reconnaissabilité.

## Coût et latence mesurés

Jamais le tarif catalogue : la famille OpenAI facture des tokens de raisonnement en plus de l'image,
ce qui multiplie son coût réel par 3 à 7.

| Modèle · prompt | cellules | $/image | latence |
|---|---:|---:|---:|
| `google/gemini-2.5-flash-image` · `v2` **← retenu** | 8 | **0.03944** | **9,1 s** |
| `google/gemini-2.5-flash-image` · `v3` (réserve) | 8 | 0.03947 | 11,2 s |
| `google/gemini-2.5-flash-image` · `v1` | 8 | 0.03942 | 8,8 s |
| `google/gemini-3.1-flash-lite-image` · `v1` | 8 | 0.03423 | 5,1 s |
| `google/gemini-3.1-flash-lite-image` · `v2` | 4 | 0.03395 | 5,9 s |
| `openai/gpt-5-image-mini` · `v1` | 8 | 0.05130 | 63,4 s |
| `openai/gpt-5-image-mini` · `v2` | 4 | 0.05010 | 59,0 s |
| `openai/gpt-5.4-image-2` · `v1` | 1 | 0.23531 | 180,7 s |

`gpt-5.4-image-2` est **dominé** et sa grille est restée ouverte à 1 cellule sur 8 : 6× le prix et
20× la latence d'un modèle qui franchit les mêmes barrières. Le constat tient sur cette seule
observation, il est écrit ici plutôt que payé sept fois.

## Barrière 1 — est-ce une vraie photographie ?

Modèle retenu, croix = ne se lit plus comme une photo de photo.

| Plat | `v2` p1 | `v2` p2 | `v3` p1 | `v3` p2 | Observation |
|---|:--:|:--:|:--:|:--:|---|
| `brut2` (plan large) | ✅ | ✅ | ✅ | ✅ | page et texte supprimés, photographie franche |
| `brut1` (plan large) | ✅ | ✅ | ✅ | ✅ | idem ; le liseré résiduel de `v2` disparaît en `v3` |
| `recadre1` (gros plan) | ✅ | ❌ | ✅ | ✅ | `v3` rattrape la passe 2 que `v2` ratait |
| `recadre2` (gros plan) | ❌ | ❌ | ✅ | ❌ | `v3` rattrape la passe 1 ; la passe 2 reste un quasi-scan |

**Prompt retenu `v2` : 5 sur 8** — 4 sur 4 en plan large, 1 sur 4 en gros plan. `v3` monte à 7 sur 8
et supprime l'inclinaison partout, mais n'est pas retenu.

En plan large, les deux versions font 4 sur 4. Tout l'écart est sur les gros plans.

### Le constat central, et il inverse une hypothèse de T14

Le modèle restaure **quand il doit détourer**. L'instruction « ne garder que la photo du plat, aucun
caractère imprimé » lui donne quelque chose à faire, et il re-rend la scène entière. Quand l'entrée
est déjà un gros plan serré, sans texte autour, l'instruction ne mord sur rien : il renvoie l'entrée à
peine affûtée, trame d'impression comprise.

Avec le prompt retenu, l'écart est net : **plan large 4 sur 4, gros plan 1 sur 4.**

Donc **envoyer le plan large avec sa colonne de texte donne un meilleur résultat que d'envoyer le
plat pré-recadré**. T14 ne doit pas recadrer avant l'appel — c'est l'inverse de ce que le plan
supposait. C'est le gain du découpage `recadre` / `brut` du jeu d'essai : une série mélangée n'aurait
pas pu le voir, et aurait attribué au modèle une instabilité qui vient du cadrage d'entrée.

`v3` réduit cet écart sans l'effacer (3 sur 4 en gros plan, 4 sur 4 en plan large), mais il n'est pas
retenu — voir plus bas. La consigne pour T14 est donc la version forte : **pas de recadrage avant
l'appel**.

## Barrière 2 — le plat reste-t-il reconnaissable ?

Franchie partout, sur les 16 cellules du modèle retenu (`v2` et `v3`). Aucun plat n'est devenu un
autre plat.

Écarts observés, non éliminatoires — le prix accepté de la barrière 1 :

| Écart | Où |
|---|---|
| Décor de fond re-rendu (nappe devenue vert olive, marbre ou bois inventé sous l'assiette) | tous les plans larges |
| Texture de l'aliment re-rendue — la sauce de `brut1` ressort plus croustillante que fondante | `brut1` |
| Accessoires d'arrière-plan conservés mais redessinés (verre, bols, couteau) | `brut1`, `brut2` |
| Motif floral de l'assiette et feuille de laurier **conservés** | `brut1` |
| `v3` s'écarte plus que `v2` : `recadre2` devient un cake dans un plat à four là où l'original montre des tranches, le ragoût de `brut1` ressort en viande tranchée — **c'est la raison du non-choix de `v3`** | gros plans, `v3` |

## Barrière 3 — le gain se voit-il ?

- **À 200 px de haut** : oui, massivement, sur les plans larges — on passe d'une page de magazine
  photographiée à une photographie de plat. À 200 px l'écart est celui entre « illustration » et
  « défaut visible ».
- **En pleine taille** : oui, même écart, et les écarts de la barrière 2 restent invisibles à cette
  échelle comme à 200 px.
- **Sur les gros plans pré-recadrés** : aucun gain avec le prompt retenu, le modèle ne faisant rien.
  `v3` en obtient un sur 3 cellules sur 4, du même ordre qu'en plan large — ce qui se joue là n'est
  pas l'ampleur du gain mais sa fiabilité.
- **Conséquence sur T14** : première issue de la spec — **T14 tel que spécifié**, la photo reste une
  illustration de 200 px et l'agrandissement en vitrine n'est pas nécessaire pour justifier le
  travail.

## Accord entre les deux passes

Sur les 4 couples (modèle retenu, plat) : **3 accords, 1 divergence**.

- Prompt retenu `v2` : `brut1`, `brut2`, `recadre2` s'accordent ; `recadre1` diverge.
- Réserve `v3` : `brut1`, `brut2`, `recadre1` s'accordent ; `recadre2` diverge.

Le taux ne bouge pas — **3 accords sur 4 dans les deux versions**. Seul le plat qui divergeait a
changé, ce qui est la meilleure preuve que la divergence est du bruit du modèle et non un défaut du
plat.

**Verdict sur le bouton « régénérer » de T14 : justifié.** Ce n'est pas une commodité — dans les deux
versions du prompt, une des quatre photos rend un verdict différent selon la passe, à modèle, prompt
et entrée identiques. Sans le bouton, cette photo serait publiée en l'état ou abandonnée.

## Surface d'images explorée, et abandonnée

Le catalogue du banc venait de `GET /api/v1/models` : 400 modèles, dont 11 seulement acceptent une
image en entrée et en produisent une, tous OpenAI ou Google. Les modèles à tarif forfaitaire (FLUX,
Krea, Recraft, Qwen Image, Seedream, Riverflow) vivent sur une **seconde surface**,
`GET /api/v1/images/models` — 40 modèles, tous image→image, appelés par
`POST /api/v1/images/generations` avec l'image source dans
`input_references: [{type:"image_url", image_url:{url}}]`.

Trois sondes, 0,09 USD, sur `brut1` avec `v2` :

| Modèle | $ réel | latence | barrière 1 |
|---|---:|---:|---|
| `black-forest-labs/flux.2-klein-4b` | 0.017 | 7,9 s | **échec — régénère le texte en charabia lisible** |
| `qwen/qwen-image-3` | 0.033 | 109,5 s | **échec — page, texte et trame intacts** |
| `bytedance-seed/seedream-4.5` | 0.040 | 24,6 s | franchie |

Deux enseignements. D'abord un **mode d'échec que la spec n'avait pas nommé** : le faux texte. Le
modèle le moins cher ne retire pas le texte imprimé, il le réécrit en charabia — « Fonds
d'artedraaads au thon » — ce qui est pire que de le laisser. Ensuite, sur cette surface le coût réel
colle au tarif affiché, sans tokens de raisonnement.

`seedream-4.5` franchissait la barrière 1 mais reste plus cher et près de 3× plus lent que le modèle
retenu. La branche est **abandonnée par décision** : le second chemin d'appel n'est pas implémenté.

## Verdict

- `BEAUTIFY_MODEL` : **`google/gemini-2.5-flash-image`** (`spike13/models.ts`)
- Version du prompt : **`v2`** (`spike13/prompt.ts`)
- Coût moyen par image : **0,03944 USD**
- Latence moyenne : **9,1 s**
- Dépense totale : **2,2924 USD** sur un plafond de 10 USD
- Verdict T13 : **positif, sous condition d'entrée.**

La condition est le constat central : l'embellissement fonctionne sur un **plan large contenant la
page**, pas sur un gros plan déjà détouré. T14 doit envoyer la photo telle qu'elle est prise, sans
recadrage préalable.

9,1 s de latence interdit l'appel synchrone dans le formulaire de scan, mais reste assez court pour
une attente explicite. C'est la contrainte d'architecture que T14 doit reprendre.

## La réserve `v3`

`v3` sort l'exigence d'aplomb de la liste où `v2` l'enfouit et la détaille : bords horizontaux et
verticaux, plat vu de face ou de dessus, rien qui penche, perspective de page redressée jusqu'à
disparaître.

Mesuré sur les 8 mêmes cellules : **7 franchissements contre 5**, inclinaison supprimée partout où la
barrière est franchie, les deux gains tombant exactement sur les cellules qui échouaient.

**Non retenu par florianlauer**, après comparaison des deux séries de rendus. Deux raisons, toutes
deux mesurées : `v3` s'écarte davantage du plat d'origine, et il coûte **23 % de latence en plus**
(11,2 s contre 9,1 s).

Il reste exporté (`PROMPT_V3` dans `spike13/prompt.ts`) avec deux tests : l'un vérifie que sa
formulation d'aplomb est intacte, l'autre qu'il **n'est pas** le prompt actif. C'est le repli à
activer si T14 voit des cadres inclinés en usage réel — son compromis est déjà chiffré, il n'y a pas
de mesure à refaire.

Réserve de validité à porter dans T14 : `v3` était une troisième itération réglée sur quatre photos,
donc précisément ce que la règle de réécriture unique voulait empêcher. Ne pas le retenir rend cette
réserve sans objet pour le prompt actif, `v2` étant la seule réécriture autorisée.
