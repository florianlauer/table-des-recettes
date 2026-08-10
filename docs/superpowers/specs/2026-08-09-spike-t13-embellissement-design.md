# Spike T13 — validation de l'embellissement d'image

_Design validé avec florianlauer, 2026-08-09. Issu de T13 du plan de tâches
[`2026-08-08-table-des-recettes-tasks.md`](./2026-08-08-table-des-recettes-tasks.md), volet 2 du
spike décrit dans [`2026-08-08-table-des-recettes-design.md`](./2026-08-08-table-des-recettes-design.md)._

## But

Trancher, sur un banc d'essai jetable et hors application, la seconde hypothèse non vérifiée du
projet : un modèle d'édition d'image sait-il transformer une photo de plat prise en photo dans un
magazine en **une image qui ne se lit plus comme une photo de photo** — perspective redressée,
trame d'impression et grain de papier supprimés, couleurs restituées — **tout en laissant le plat
reconnaissable** ?

Et, question ajoutée au cadrage : le gain se voit-il assez pour justifier T14, qui représente
environ cinq heures de travail ?

> **Formulation révisée le 2026-08-10.** La question posait initialement « sans réinventer le
> plat », fidélité au détail comprise. Après examen des premiers rendus, florianlauer a inversé la
> priorité : c'est la crédibilité photographique qui décide, et la fidélité n'est plus qu'un
> plancher de reconnaissabilité. Voir « Les trois barrières » ci-dessous pour la raison et le risque
> accepté.

Un verdict **négatif** est un résultat valide et suffisant. Il annule T14 avant qu'une ligne
d'interface ne soit écrite.

## Livrable déjà acquis — routabilité OpenRouter

La spec initiale posait ce point comme conditionnant l'architecture de la fonctionnalité :
« la couverture d'OpenRouter en modèles à *sortie image* est plus étroite que sa couverture en
texte et en vision. Si le modèle retenu n'y est pas routable, il faut une clé API Google directe
— donc un second secret et un second fournisseur dans la section déploiement. »

**Tranché, par interrogation du catalogue le 2026-08-09 : OpenRouter route bien les modèles à
sortie image.** Sur 400 modèles au catalogue, 11 déclarent `image` dans
`architecture.output_modalities` ; en retirant `openrouter/auto` et `openrouter/auto-beta`, qui
sont des routeurs et non des modèles, il en reste 9, tous en entrée `image+text`. En retirant les
deux doublons `-preview` (`gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`),
l'échelle compte **7 barreaux distincts**.

**Conséquences, à répercuter dans la section déploiement du design :**

- pas de second fournisseur, pas de clé Google directe, pas de second secret ;
- l'embellissement passe par la **même clé OpenRouter** que l'extraction, sous le même régime :
  variable d'environnement Convex, jamais transmise au navigateur, configurée séparément sur les
  backends de preview ;
- T12 (câblage du déploiement) n'a pas de fournisseur supplémentaire à prévoir.

## L'échelle

Le prix affiché au catalogue pour la sortie image est `image_output`, exprimé **en dollars par
token de sortie**. Le nombre de tokens qu'un modèle émet pour une image varie de l'un à l'autre :
ce tarif donne un ordre de grandeur, **pas** un classement fiable en dollars par image.

| # | Modèle | `image_output` ($/token) |
|---:|---|---:|
| 1 | `openai/gpt-5-image-mini` | 0,000008 |
| 2 | `google/gemini-2.5-flash-image` | 0,00003 |
| 3 | `google/gemini-3.1-flash-lite-image` | 0,00003 |
| 4 | `openai/gpt-5.4-image-2` | 0,00003 |
| 5 | `openai/gpt-5-image` | 0,00004 |
| 6 | `google/gemini-3.1-flash-image` | 0,00006 |
| 7 | `google/gemini-3-pro-image` | 0,00012 |

Le classement définitif se fait sur le **coût réel relevé dans `usage`** à chaque appel, pas sur
cette estimation. Le tableau ci-dessus ne sert qu'à donner l'ordre de départ et à dimensionner le
plafond de dépense.

### Restriction du périmètre — 2026-08-10

Le spike n'essaie que les **quatre premiers barreaux**. Les trois derniers — `openai/gpt-5-image`,
`google/gemini-3.1-flash-image` et `google/gemini-3-pro-image` — portaient les deux tiers de la
dépense pour des modèles qui ne seraient utilisés qu'en dernier recours : `gemini-3-pro-image` seul
pesait 38 % du total.

**Conséquence sur la portée du verdict, à assumer explicitement.** Si les quatre échouent, T13 ne
conclut pas « négatif au sommet de l'échelle » mais « négatif sur la moitié basse ». La décision
devient alors soit remonter d'un cran, soit clore — et non « l'hypothèse est morte ».

## Protocole

### L'échelle disparaît, la règle reste

T1 procédait par échelons — le moins cher d'abord, on monte à chaque échec, on s'arrête au premier
qui passe — parce qu'il avait 316 endpoints et qu'essayer tout le catalogue coûtait cher.

T13 en essaie quatre. La grille complète — **4 modèles × 4 photos × 2 passes = 32 images** —
coûte de l'ordre de **1 $** (1,57 $ au pire cas du garde-fou budgétaire). Marcher les barreaux un
par un ne fait économiser aucun argent à ce prix, et coûte de la discrimination : on ne saurait pas
si le modèle retenu est le seul à passer ou le pire des quatre qui passent.

Donc : **on lance la grille entière**, et la règle « le moins cher qui passe » s'applique au
tableau de résultats au lieu de l'ordre de marche. La décision est identique, sans machinerie de
parcours d'échelle.

### Deux générations par photo et par modèle

Les modèles d'image sont stochastiques : un mauvais tirage n'est pas un échec de modèle. Deux
passes séparées par couple (modèle, photo).

Le taux d'accord entre les deux passes est un livrable à part entière : il dit directement si le
bouton « régénérer » prévu en T14 sert à quelque chose. Deux passes qui divergent → régénérer a du
sens. Deux passes également fausses → régénérer est un bouton décoratif, et T14 s'en passe.

### Les trois barrières — ordre inversé le 2026-08-10

**Le cadrage initial mettait la fidélité au plat en premier et la qualité perçue en second. Il a
été inversé par florianlauer après examen des premiers rendus réels.** Le rendu préféré est celui
qui ne se lit plus comme une photo de photo, y compris quand il s'écarte du détail : sur `recadre1`,
`gpt-5-image-mini` redresse la prise de vue et produit une vraie photographie, mais il ajoute une
fourchette absente de l'originale, éclaircit la garniture et redessine les nervures du feuilletage.
L'ancienne barrière 1 l'éliminait ; le nouveau cadrage le retient.

Raison assumée : la photo est une **illustration affichée 200 px de haut**, pas une pièce
d'archive. À cette taille la texture d'une farce est invisible, tandis que l'aspect « page de
magazine rephotographiée » se voit immédiatement. Risque accepté explicitement : la vitrine
montrera parfois un plat approximatif dans son détail.

**Barrière 1 — éliminatoire. Est-ce une vraie photographie ?**
Le rendu ne doit plus donner l'impression d'une photo de photo : pas de trame d'impression, pas de
grain de papier, pas de perspective oblique de page, pas de bord de feuille. Redresser, recadrer et
remplacer le fond sont **autorisés** — la spec les demandait déjà (« corriger la perspective et le
cadrage »). Binaire, jugé à l'œil.

**Barrière 2 — éliminatoire, mais tolérante. Le plat reste-t-il reconnaissable ?**
Ce qui était la barrière 1 devient un plancher, pas un gabarit. Échec seulement si le plat devient
**méconnaissable** : autre plat, autre type de préparation, composition sans rapport. Un ustensile
ajouté, une garniture retouchée, un motif de pâte redessiné ne sont plus éliminatoires — ils sont
consignés comme écarts observés, parce qu'ils disent ce que le modèle s'autorise et que T14 devra
en tenir compte dans son écran de comparaison.

**Barrière 3 — de justification. Le gain se voit-il ?**
Jugé à **200 px de haut** (taille d'affichage actuelle en vitrine, cf. `DESIGN.md`) **et en
grand**, un agrandissement restant une possibilité qu'on se réserve. Trois issues distinctes :

| Constat | Conséquence sur T14 |
|---|---|
| Visible aux deux tailles | T14 tel que spécifié |
| Visible seulement en grand | T14, **plus** un agrandissement en vitrine — qui devient une contrainte de conception à instruire |
| Invisible aux deux tailles | T14 tombe, quels que soient les résultats des barrières 1 et 2 |

Les trois barrières se jugent sur les mêmes images. Aucune ne coûte d'appel supplémentaire.

### Prompt : versionné, non scellé, une seule réécriture

Le prompt est exporté avec un identifiant de version explicite (`v1`), pour que chaque rendu soit
attribuable.

Il n'est **pas scellé** avant l'ingestion des photos, contrairement au protocole de T1. T1 scellait
parce qu'un oracle transcrit à la main pouvait fuiter dans la rédaction du prompt. Ici les photos
sont prises par l'évaluateur lui-même, donc connues de lui par construction, et le critère est
« c'est le même plat » — un prompt ne peut pas fabriquer cette identité. Il n'y a rien à truquer,
donc rien à sceller.

En revanche la **règle de réécriture unique** de T1 est conservée : si `v1` échoue sur les quatre
modèles, on a droit à **un** `v2`, qui rejoue la grille entière. Au-delà, T13 est négatif. Sans
cette limite, on règlerait le prompt sur les quatre seules photos du jeu d'essai et le verdict ne
vaudrait rien hors de ces quatre photos.

Contenu de `v1`, dérivé du design : corriger la perspective et le cadrage ; retirer la trame
d'impression, le moiré, les reflets et le grain du papier ; restituer les couleurs si la source
est en noir et blanc. Interdiction explicite de modifier le plat, le dressage, la vaisselle ou les
ingrédients visibles, et d'ajouter quoi que ce soit.

#### La réécriture a été consommée le 2026-08-10 — `v2`

Le motif n'est pas un échec global de `v1` mais un **défaut commun aux quatre modèles sur les deux
plans larges** : sur `brut1` et `brut2`, aucun ne retire complètement le texte imprimé voisin pour
ne garder que la photo du plat. `v1` ne l'avait jamais demandé — il parlait de « cadrage » sans dire
que la colonne de texte devait disparaître — et son interdiction générale de toucher à quoi que ce
soit s'opposait au recadrage nécessaire.

`v2` change donc deux choses, toutes deux apprises des rendus de `v1` :

1. il nomme la source (« la photographie d'une page de magazine imprimée ») et exige que **seule la
   photo du plat subsiste** : aucun caractère imprimé, aucun titre, légende, numéro de page, filet
   de colonne, bord de feuille, ni la surface sur laquelle la page est posée ;
2. il remplace l'interdiction générale de `v1` par le seul plancher de **reconnaissabilité**, en
   accord avec l'ordre des barrières arrêté le même jour.

`v1` reste exporté (`PROMPT_V1`) : ses rendus sont sur le disque et doivent rester attribuables à
un texte. La version fait désormais partie du **chemin** du rendu, pas seulement du fichier annexe —
sans cela un rejeu écraserait les images contre lesquelles il doit être comparé, et le contrôle
d'idempotence lirait un rendu `v1` comme fermant une cellule `v2`.

#### Le quota a été dépassé le 2026-08-10 — `v3`, écrit, mesuré, **non retenu**

La règle disait « pas de `v3` ». florianlauer l'a levée après avoir vu des rendus encore penchés, puis
**a choisi `v2` après comparaison des deux séries de rendus**. Le prompt actif est donc `v2`, la seule
réécriture que la règle autorisait, et la réserve de validité ci-dessous n'a pas d'objet sur lui. Tout
est consigné ici plutôt que passé sous silence.

`v3` ne change qu'une chose : `v2` enfouissait « cadrer droit » dans une liste, et des cadres inclinés
continuaient de revenir. L'exigence d'aplomb est donc **sortie de la liste et détaillée** — bords
horizontaux et verticaux, plat vu de face ou de dessus, rien qui penche, perspective oblique de la
page redressée jusqu'à disparaître.

Mesuré sur les 8 cellules du modèle retenu : **7 franchissements de la barrière 1 contre 5 pour
`v2`**, l'inclinaison a disparu partout, et les deux gains tombent précisément sur les cellules qui
échouaient.

**Pourquoi il n'est pas retenu malgré ce gain.** Deux contreparties, toutes deux mesurées : `v3`
s'écarte davantage du plat d'origine — `recadre2` devient un cake dans un plat à four là où l'original
montre des tranches — et il coûte **23 % de latence en plus** (11,2 s contre 9,1 s). Sur une
illustration de 200 px, ce gain de fiabilité ne paie pas cet écart.

`v3` reste exporté (`PROMPT_V3`) comme **repli chiffré**, avec deux tests : l'un protège sa
formulation d'aplomb, l'autre vérifie qu'il n'est pas le prompt actif. Si T14 voit des cadres inclinés
en usage réel, il y a une alternative à activer sans nouvelle mesure.

**Ce que le dépassement aurait coûté en validité, si `v3` avait été retenu.** Trois itérations réglées
sur quatre photos, c'est exactement ce que la règle voulait empêcher : rien ne garantit que `v3`
généralise hors de ce jeu d'essai. En restant sur `v2`, cette réserve tombe pour le prompt actif — elle
ne vaut que pour le repli, et T14 la retrouverait en l'activant. La journalisation par tentative de T14
reste le juge en usage réel, et les rendus du spike servent de non-régression.

Le constat de `v2` reste vrai et n'est pas annulé par `v3` : le détourage du texte n'est pas
atteignable sur un gros plan déjà recadré, quel que soit le libellé. Là, c'est le cadrage d'entrée qui
décide, et T14 ne doit pas recadrer avant l'appel.

### Modes d'échec nommés

Un échec est une **issue consignée**, pas une exception qui interrompt la grille :

- **refus** — le modèle refuse d'éditer l'image. Attendu au moins sur la famille OpenAI, s'agissant
  de contenu de magazine. Un refus systématique d'une famille est un constat utile pour T14, pas un
  bug du banc ;
- **réponse sans image** — le modèle répond en texte, sans rien produire ;
- **troncature** — génération interrompue.

### Plafond de dépense

Plafond fixé à **10 $**, en dur, vérifié **avant** chaque appel, arrêt net au dépassement. Même
discipline que T1. Dimensionnement : la grille est estimée à ~3 $, une réécriture `v2` la rejoue
en entier donc ~6 $ au pire ; 10 $ laisse la marge d'une estimation de coût fausse d'un facteur
proche de deux sans laisser la dépense filer.

## Le banc

### Cadrage préalable — la normalisation ne doit pas faire le travail du modèle

T1 normalise ses pages à 2000 px sur le grand côté avant envoi. Appliquer une réduction plus
agressive ici serait un piège : **réduire une photo, c'est déjà supprimer la trame d'impression et
le moiré** — précisément les défauts que le prompt de restauration est censé corriger. Un banc qui
pré-réduit trop mesure une restauration qu'il a lui-même faite, et conclurait à tort qu'un modèle
est bon, alors que T14 pourrait obtenir le même effet avec un simple `resize`.

Donc la normalisation du spike est **exactement celle que la production appliquera** : 2000 px sur
le grand côté, sRGB, JPEG q80 — identique à celle des pages de T1.

**Contrainte induite sur T5.** `src/lib/compress.ts` doit normaliser de la même façon. S'il
normalise autrement, le verdict de T13 ne vaut plus pour la production. À rappeler dans T5.

### Arborescence

```
spike13/
  models.ts      les 7 barreaux et leurs tarifs catalogue
  prompt.ts      prompt de restauration v1, exporté avec son identifiant de version
  ingest.ts      copié de T1 : .rotate() EXIF, strip de toutes les métadonnées, 2000 px,
                 sRGB, q80, puis relecture du fichier écrit — s'il reste une métadonnée,
                 le script échoue
  budget.ts      copié de T1
  openrouter.ts  un appel : image + prompt → image. Relève coût réel et latence
  run.ts         la grille, reprise-safe
  review.ts      construit review.html
  fixtures/dishes/    photos sources normalisées
  fixtures/renders/   rendus bruts
  RESULTS.md     tableau et verdict, rempli à la main
```

### Emplacement

Nouveau worktree `.claude/worktrees/spike-t13-embellissement`, branche partant de **`main`**.

`ingest.ts`, `budget.ts` et le motif de page HTML de comparaison sont **recopiés** depuis la
branche `worktree-spike-t1-extraction`, pas hérités : aucun couplage à une branche qui n'est pas
mergée et qui bouge encore. `openrouter.ts` de T1 n'est pas réutilisable — il est écrit pour de la
sortie structurée stricte, T13 lit des images dans la réponse.

### `ingest.ts` — la barrière GPS

Reprise sans modification de la discipline de T1, parce que le dépôt est **public** et qu'une photo
de téléphone porte les coordonnées GPS du domicile :

1. `.rotate()` pour appliquer l'orientation EXIF ;
2. suppression de **toutes** les métadonnées ;
3. redimensionnement à 2000 px sur le grand côté, sans agrandissement ; sRGB ; JPEG q80 ;
4. **relecture des métadonnées du fichier écrit** — s'il en reste une, le script échoue.

Les originaux restent hors du dépôt, dans `~/Downloads/table-des-recettes-inbox/`. Seules les
sorties normalisées entrent dans le dépôt.

### `openrouter.ts` — le seul inconnu technique

La forme de la réponse d'OpenRouter en sortie image (`choices[].message.images[]`, data URI) n'est
**pas confirmée**. Elle est validée par un appel unique sur le modèle le moins cher **avant**
d'écrire la grille. Le harnais **échoue bruyamment** si la forme diffère, au lieu d'écrire un
fichier vide et de laisser croire à un échec de modèle.

Chaque appel relève le coût réel depuis `usage` et la latence.

### `run.ts` — la grille

Parcourt les 42 combinaisons. **Reprise-safe** : un rendu déjà présent sur disque n'est pas
rappelé, donc relancer le script ne redépense jamais. Le plafond de budget est vérifié avant chaque
appel.

### `review.ts` — la page de jugement

Construit `review.html` : un bloc par photo, originale et rendus côte à côte, chacun affiché à
**200 px de haut** avec bascule en **pleine taille**. Les trois barrières se jugent sur cette seule
page. Fichier local, référençant les images sur disque, non commité.

### Ce qui entre dans le dépôt

42 rendus représentent 40 à 80 Mo. Ils restent **gitignorés**.

Sont commités : les photos sources normalisées, les rendus **du seul modèle retenu** (3 photos × 2
passes = 6 images), le code du banc, et `RESULTS.md`.

Note d'arbitrage, déjà tranchée par précédent : les photos de plats sont du contenu de magazine et
le dépôt est public. T1 y a déjà commité huit pages entières de magazine ; T13 suit la même
politique. Ce point est signalé pour être révisable, pas pour être rouvert ici.

### Tests

Uniquement sur la logique pure. Le reste est de l'E/S et du jugement à l'œil, et n'est
délibérément pas testé.

- comptabilité du budget et déclenchement du plafond ;
- calcul du coût réel à partir d'une charge `usage` ;
- décodage de l'image dans une réponse, et reconnaissance des trois modes d'échec nommés ;
- bonne forme et bon ordre de la liste de modèles.

## Ordre d'exécution

**Étape 0 — humaine, faite le 2026-08-10.** Quatre photos de plats prises au téléphone depuis des
pages de magazine, déposées dans `~/Downloads/table-des-recettes-inbox/`. Ce sont de vraies prises
de vue : la perspective, les reflets, la trame d'impression et le grain du papier sont les défauts
mêmes que le banc doit mesurer.

**Deux rôles, décidés après examen des photos.** Elles se sont avérées cadrées **large** — colonne
de texte voisine et bout d'une autre photo dans le cadre, page de travers. Deux sont donc
recadrées sur le plat avant ingestion (`recadre1`, `recadre2`) et deux gardent le cadrage d'origine
(`brut1`, `brut2`). Le banc sépare ainsi deux questions qu'un lot unique aurait confondues :
savoir restaurer une trame d'impression, et savoir en plus recadrer et redresser sans inventer. Un
modèle qui passe sur les recadrées et échoue sur les brutes dit que T14 a besoin d'un recadrage à
l'upload.

**Contrainte de format découverte à l'ingestion.** Les originaux sont des HEIC d'iPhone, et
**sharp ne sait pas les décoder** : libvips 8.18.3 échoue avec « Security limit exceeded: Number of
references in iref box (48) exceeds the security limits of 16 references », sans contournement côté
sharp. Ils sont convertis en JPEG par `sips` avant ingestion. **Constat à répercuter sur T5** : le
garde-fou de format doit *refuser* le HEIC. Le mode de panne n'est pas seulement « le navigateur ne
décode pas hors Safari », c'est aussi « le serveur ne décode pas ».

**Étape 1 — socle, parallélisable.** `models.ts`, `prompt.ts`, `ingest.ts`, `budget.ts` et leurs
tests. Ne dépend pas de l'étape 0.

**Étape 2 — sonde de forme.** Un appel unique sur `openai/gpt-5-image-mini` pour confirmer la forme
de réponse, puis `openrouter.ts`.

**Étape 3 — la grille.** `run.ts` sur les 42 combinaisons, sous plafond.

**Étape 4 — jugement.** `review.ts`, puis lecture des trois barrières et rédaction de `RESULTS.md`.

## Livrables

1. ✅ Verdict de routabilité OpenRouter — **acquis** : pas de second fournisseur (voir plus haut).
2. Modèle d'édition retenu, figé en variable d'environnement.
3. Prompt de restauration versionné.
4. Verdict de la barrière 1 (vraie photographie) et de la barrière 2 (plat reconnaissable), puis
   constat de la barrière 3 avec sa conséquence sur T14. Les écarts de détail observés sont
   consignés même quand ils ne sont pas éliminatoires.
5. Taux d'accord entre les deux passes — verdict sur l'utilité du bouton « régénérer » de T14.
6. Rendus du modèle retenu, conservés comme fixtures.

## Non retenu

- **Marche par échelons** — remplacée par la grille complète : sept barreaux à 3 $ ne justifient
  pas la machinerie, et la grille donne une discrimination que la marche ne donne pas.
- **Scellement du prompt avant l'ingestion** — sans objet ici, faute d'oracle transcrit pouvant
  fuiter.
- **Réutilisation de `openrouter.ts` de T1** — écrit pour la sortie structurée stricte.
- **Notation quantitative de la qualité de rendu** — le critère est binaire et humain par décision
  de cadrage. Aucun score, aucune métrique perceptuelle.
- **Test des deux modèles `-preview`** — doublons de leurs équivalents stables.
- **Test des trois barreaux chers** — hors périmètre, arbitré le 2026-08-10 (voir plus haut).
- **Conversion HEIC dans le banc** — impossible avec sharp, et déjà « non retenu » au niveau du
  projet. La conversion reste un geste manuel `sips`, hors du harnais.
- **Génération d'une photo quand aucune n'existe** — déjà hors périmètre du projet.
