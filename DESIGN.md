# DESIGN.md — La table des recettes

Système de design, source de vérité. Issu de `/design-consultation` du 2026-08-08, trois
directions indépendantes confrontées (art direction interne, sous-agent, Codex) puis arbitrée.

Référence visuelle figée : [`docs/design/index-reference.png`](./docs/design/index-reference.png).
Elle montre `/` appliquant le système, groupé par lettre, avec deux lignes illustrées.

Deux réserves sur cette image :

- Le générateur ne disposait pas de Fraunces. Le rendu typographique y est plus froid et plus
  contrasté que le résultat réel. **Juger la composition, pas la police.**
- Le filtre actif affiché est « Entrées » alors que la liste contient plats et desserts.
  Incohérence de la maquette, pas du système.

Brief des surfaces publiques : [`docs/design/brief-surfaces-publiques.md`](./docs/design/brief-surfaces-publiques.md).

---

## Thèse

**Un répertoire de cuisine relié, réimprimé aujourd'hui.** Papier blanc franc, encre noire dense,
une seule couleur. Ce n'est pas une publication, c'est une archive : on n'y vient pas pour
découvrir, on y vient pour retrouver.

Deux priorités, dans cet ordre :

1. **« on dirait un vrai livre de cuisine »** — objet éditorial, imprimé, patrimonial ;
2. **« ce sont mes recettes, retrouvées tout de suite »** — téléphone posé sur le plan de
   travail, mains sales, lumière de cuisine.

Les deux ne se disputent pas la même surface. `/` est une surface de **recherche** : dense,
utilitaire. `/recette/$slug` est une surface de **lecture** : généreuse, éditoriale.

---

## Couleur

> **Amendement du 2026-08-09.** La version initiale posait un fond neutre `#F8F8F8` et l'ocre
> comme couleur unique. À l'usage, la vitrine rendue s'est révélée éteinte, et pour une raison
> identifiable : l'encre et les filets sont des bruns chauds posés sur un papier gris froid.
> Cette discordance est ce qui faisait « clinique ». Trois choses changent — un papier chaud,
> une encre par type de plat, une reliure ocre. Ce qui ne change pas : aucun dégradé, aucun
> faux grain, aucun blob, aucune couleur qui ne porte pas d'information.

Papier **blanc cassé chaud**, à la teinte de l'encre et à très faible chroma. Toujours pas de
parchemin jauni, toujours pas de faux grain.

```css
:root {
  --paper:        #F7F3EA;
  --surface:      #FFFDF8;

  --ink:          #2E2723;
  --ink-muted:    #6E645C;

  --ochre:        #9A5B2B;
  --ochre-hover:  #7C4720;
  --on-ochre:     #FFFFFF;

  --rule:         #C6BDB4;
  --rule-strong:  #8A7F74;
  --focus:        #9A5B2B;
}
```

### Une encre par type de plat

```css
:root {
  --ink-entree:   #57683F;  /* vert laurier    85° — 5.49:1 */
  --ink-plat:     #9A5B2B;  /* ocre, la marque 26° — 4.86:1 */
  --ink-dessert:  #96455F;  /* prune          341° — 5.72:1 */
  --ink-apero:    #3D6B78;  /* bleu ardoise   193° — 5.31:1 */
  --ink-petitDej: #82631A;  /* miel brûlé      42° — 5.06:1 */
  --ink-autre:    #6E645C;  /* gris chaud — le fourre-tout reste neutre */
}
```

**Cette couleur est une information de balayage, pas une décoration** — c'est la seule raison
pour laquelle elle passe l'anti-slop. Elle n'est jamais portée que par le **mot qui nomme le
type** : la colonne de droite d'une ligne d'index, la ligne de type sous le titre d'une fiche,
le filtre actif. Jamais un aplat, jamais une pastille, jamais une bordure, jamais un fond de
ligne.

Les six encres tiennent entre **4.86:1 et 5.72:1** sur `--paper`. Cet écart resserré est
délibéré : dans une colonne d'étiquettes, une couleur nettement plus sombre que les autres
serait lue comme une hiérarchie qui n'existe pas. Les teintes, elles, sont écartées (26°, 42°,
85°, 193°, 341°, plus un neutre) — c'est l'écart de teinte qui rend le balayage possible, pas
l'écart de valeur.

Le type reste **écrit en toutes lettres**. La couleur double l'information, elle ne la remplace
jamais : sous mauvaise lumière et sur écran taché, un code purement chromatique échouerait
exactement là où `PRODUCT.md` exige qu'il tienne.

Un composant ne fait **jamais** correspondre un type à une couleur en JavaScript : il pose
`data-type="plat"` et le jeton `--type-ink` se résout en CSS.

### L'ocre

Le filet sous le titre du site, les lettres de groupe dans la marge de l'index, la reliure en
tête de page, et le type « plat » dont il est l'encre. **Jamais comme décoration**, jamais en
remplissage de bouton.

**Pas de mode sombre.** Décision assumée : l'objet est un imprimé sur papier blanc ; une version
inversée en fait un autre objet. Révisable si l'usage nocturne en cuisine se révèle réel.

---

## Typographie

- **Display — Fraunces**, 500–600. Titre du site, noms de recettes, titres de section.
  Jamais pour un contrôle.
- **Texte courant — Atkinson Hyperlegible Next**, 400–600. Ingrédients, étapes, filtres,
  recherche, métadonnées, légendes.

Le choix d'Atkinson n'est pas esthétique, il est fonctionnel : elle est dessinée pour la
lisibilité dégradée — à un mètre, sous mauvaise lumière, écran taché. C'est la condition d'usage
réelle du site.

**Plancher dur : aucun texte fonctionnel sous 15 px.**

### L'axe `opsz` de Fraunces est porteur — ne pas le retirer

Mesuré le 2026-08-09 en téléchargeant réellement les `woff2` servis pour le français
(latin + latin-ext) :

| Requête Google Fonts | Poids |
|---|---|
| avec `opsz`, graisses 400..700 — l'actuelle | 175,8 kB |
| avec `opsz`, graisses resserrées 500..600 / 400..600 | **175,8 kB** |
| sans `opsz` | 120,4 kB |

Deux pièges, tous deux vérifiés plutôt que supposés :

**Resserrer les graisses ne gagne rien du tout.** Zéro octet. Google sert la plage variable
entière quelle que soit la plage demandée. C'est le geste évident, et il est inutile.

**Les 55,4 kB d'écart viennent uniquement de l'axe `opsz`**, soit −44 % sur Fraunces. Mais cet
axe est appliqué automatiquement par le navigateur (`font-optical-sizing: auto`) et c'est lui
qui fait tenir Fraunces de 15 à 72 px. Sans lui, les titres sont des lettres dessinées pour un
petit corps puis agrandies : plus larges, moins contrastées. **Décision : on garde `opsz`.** La
page mesure LCP 444 ms, CLS 0,0007, TTFB médian 100 ms — il n'y a pas de problème de performance
à échanger contre la voix d'affichage, et `display=swap` fait que les polices ne bloquent pas le
premier rendu.

### Une seule échelle, fluide

Pas de paliers d'appareil. La lecture se fait à une distance qui varie continûment — 35 cm avec
un téléphone en main, 70 cm avec une tablette calée sur un plan de travail — et des breakpoints
ne savent pas représenter un continuum.

**Le piège à ne pas reproduire** : une échelle indexée sur la largeur de viewport donne au
desktop les plus grandes tailles, alors que le desktop est la surface **la plus proche** de
l'œil. L'échelle croît donc du téléphone à la tablette paysage, puis **plafonne à 1100 px**. Le
desktop hérite du plafond, légèrement généreux — sans conséquence, c'est la surface secondaire.

Chaque palier interpole entre sa valeur à 390 px de large et sa valeur à 1100 px.

```css
:root {
  --type-meta:     clamp(0.9375rem, 0.869rem + 0.282vw, 1.0625rem);  /* 15 → 17 px */
  --type-control:  clamp(1.0625rem, 0.994rem + 0.282vw, 1.1875rem);  /* 17 → 19 px */
  --type-body:     clamp(1.125rem,  0.988rem + 0.563vw, 1.375rem);   /* 18 → 22 px */
  --type-lead:     clamp(1.1875rem, 1.016rem + 0.704vw, 1.5rem);     /* 19 → 24 px */
  --type-letter:   clamp(1.75rem,   1.338rem + 1.69vw,  2.5rem);     /* 28 → 40 px */
  --type-section:  clamp(1.5rem,    1.294rem + 0.845vw, 1.875rem);   /* 24 → 30 px */
  --type-title:    clamp(2.25rem,   1.426rem + 3.38vw,  3.75rem);    /* 36 → 60 px */
  --type-masthead: clamp(2.5rem,    1.401rem + 4.51vw,  4.5rem);     /* 40 → 72 px */
}
```

Les interlignes, eux, sont fixes : ils dépendent du rôle, pas de la taille.

| Rôle | Palier | Famille / graisse | Interligne |
|---|---|---|---|
| Titre du site | `--type-masthead` | Fraunces 600 | `1.0` |
| Titre de recette, fiche | `--type-title` | Fraunces 600, `letter-spacing: -0.02em` | `1.02` |
| Titre de section | `--type-section` | Fraunces 600 | `1.1` |
| Lettre de groupe, index | `--type-letter` | Fraunces 600 | `1.0` |
| Titre de recette, index | `--type-lead` | Fraunces 500 | `1.15` |
| Étapes | `--type-lead` | Atkinson 400, `max-width: 68ch` | `1.6` |
| Ingrédients | `--type-body` | Atkinson 400 | `1.5` |
| Contrôles | `--type-control` | Atkinson 600, cible tactile 48 px minimum | `1.25` |
| Recherche, filtres, type de plat, légendes | `--type-meta` | Atkinson 400 | `1.45` |

---

## Composition

### Premier écran de `/`

Le masthead reste purement typographique :

1. « La table des recettes » en grand, en haut à gauche.
2. Un filet ocre fin directement dessous.
3. « 203 recettes » en petit sans, sous le filet.
4. Recherche : uniquement le texte « Rechercher une recette » posé sur un filet fort pleine
   largeur. **Pas de carte, pas d'ombre, pas de loupe, pas de bordure de champ.**
5. Filtres sur une seule ligne typographique : `Toutes 203  Entrées 31  Plats 94  Desserts 52
   Apéro 26`. L'actif est imprimé dans **l'encre de son type** et en graisse 600 ; « Toutes »
   actif reste en ocre. **Aucune pastille, aucun bouton.**

### La reliure

> **Amendement du 2026-08-09** — remplace « aucun bandeau coloré ».

Un aplat ocre plein, pleine largeur, **collé au bord haut du viewport** : la tranche de toile
d'un livre relié. `position: fixed`, 10 px en desktop, 7 px sous 640 px. Il encadre l'objet à
n'importe quelle profondeur de défilement.

C'est **le seul aplat de couleur du système**, et il ne touche aucun contenu : il borde la
fenêtre, il ne coiffe pas le titre. Un bandeau posé derrière le masthead resterait interdit —
ce serait un en-tête de site, pas la tranche d'un livre.
6. L'index commence avant le milieu de l'écran. Huit recettes visibles au premier écran sur
   desktop, quatre titres au minimum sur mobile.

### Premier écran de `/recette/$slug`

**Aucune photo d'ouverture.** Décision convergente des trois directions : le premier écran donne
immédiatement le titre, le type, les portions et les ingrédients. Cela réduit le défilement avec
les mains sales, et empêche une fiche sans photo de sembler amputée.

> **Amendement du 2026-08-09.** La répartition initiale laissait la colonne de gauche vide du
> titre jusqu'au bas de page, et « Préparation » ne commençait qu'après ce trou. Les étapes
> remontent donc dans la colonne de gauche, et la photo passe dans celle de droite, sous les
> ingrédients — elle y reste « après les ingrédients », comme prévu.

Desktop, la page forme une double page. Le retour occupe seule la première ligne, pleine
largeur, **hors des deux colonnes** — placé dans l'une d'elles, son espacement décalait cette
colonne vers le bas et l'autre démarrait plus haut :

- à gauche : titre, type de plat, puis tout « Préparation » ;
- à droite : portions, ingrédients, puis la photo éventuelle ;
- les deux colonnes démarrent sur la même ligne, à hauteur du haut du titre.

La colonne de gauche donne aux étapes une justification d'environ 40 signes — une colonne de
lecture, pas une ligne de pleine page. C'est plus étroit que les 68 signes visés en pleine
largeur, et c'est voulu : à deux colonnes, la mesure courte est la bonne.

Mobile : titre, portions, ingrédients, puis étapes en paragraphes numérotés, le numéro dans la
marge, et **la photo en toute fin de fiche**. Aucun accordéon, aucun panneau à ouvrir, aucun
bloc flottant.

> **Amendement du 2026-08-09.** La photo se trouvait entre les ingrédients et « Préparation ».
> Ce sont les deux seuls blocs que l'on lit *en séquence*, poêle en main : une illustration n'a
> rien à faire entre eux. Elle ferme désormais la fiche. Desktop est inchangé — la colonne de
> droite garde ingrédients puis photo, où rien n'est interrompu.
>
> C'est la seule surface où l'ordre visuel s'écarte de l'ordre du DOM. Le prix est nul ici :
> l'image est décorative (`alt=""`) et non focalisable, donc ni le clavier ni un lecteur d'écran
> ne perçoivent le déplacement. **Cette dérogation ne vaut que pour une image décorative** ;
> aucun bloc porteur de texte ou de cible ne doit être déplacé par `order`.

---

## Grille mixte — la mécanique

**La règle centrale, non négociable : la donnée est typographique, la photo est une
illustration.** Environ la moitié des recettes n'auront jamais d'image, et ce sont des photos de
magazine restaurées par un modèle, donc hétérogènes en cadrage et en colorimétrie. Toute grille
qui suppose une image par recette est disqualifiée.

### L'index

- **Une colonne, toujours.** Pas de grille de cartes, à aucun breakpoint.
- **Aucune vignette par recette, jamais.** C'est ce qui garantit que toutes les recettes ont
  exactement la même présence documentaire. Une recette sans photo n'est pas une recette
  incomplète.
- **Aucun numéro de ligne.** Un numéro de rang ne désigne rien dans une liste groupée par lettre,
  et un identifiant stable afficherait une colonne de nombres en désordre pour un usage que rien
  n'établit.
- Marge gauche : **88 px** en desktop, séparée du corps par un filet vertical qui court sur toute
  la hauteur de l'index ; **44 px** sur mobile, sans filet vertical. Elle ne porte que la lettre
  de groupe, et reste vide en face des lignes.
- Hauteur de ligne **constante**, plancher **48 px**. Ordre : titre, puis type de plat aligné à
  droite.
- Filet horizontal `--rule` entre chaque ligne.

**La ligne entière est la cible.** Comme dans un répertoire imprimé, on désigne l'entrée, pas les
mots : toute la surface de la ligne — y compris la photo et la ligne d'ingrédient — ouvre la
recette. Mécanique : un `::after` en `inset: 0` sur le lien de titre, la ligne en `position:
relative`. **Ne pas** envelopper la ligne dans une balise `<a>` — le lien avalerait la photo et
la ligne d'ingrédient, et son nom accessible deviendrait illisible ; ici il reste le seul titre.

L'anneau de focus se dessine alors **sur la ligne**, pas sur le texte : l'indicateur doit montrer
la cible réelle.

Coût assumé : le texte d'une ligne d'index n'est plus sélectionnable. Sur une surface dont le
seul travail est d'ouvrir une recette, la cible vaut plus que la sélection.

### Regroupement alphabétique

L'ordre alphabétique est **le seul ordre de `/`**. Il n'y a pas de tri par date : celui qui
connaît le corpus cherche un titre, celui qui ne le connaît pas a besoin d'un repère de balayage,
et aucun des deux n'a besoin de savoir ce qui a été ajouté en dernier.

- Chaque groupe s'ouvre par un filet `--rule-strong` pleine largeur.
- La lettre est posée **dans la marge**, en display, alignée sur la première ligne de son groupe.
  Elle apparaît une seule fois ; la marge reste vide en face des lignes suivantes.
- Un groupe peut ne contenir qu'une ligne. Aucun groupe vide n'est dessiné.

### La photo appartient à sa ligne

**Aucune planche détachée.** Une photo posée entre deux lignes, ou pire côte à côte avec une
autre, oblige à lire une légende pour savoir à quelle recette elle appartient. Sur une surface
dont le travail est de retrouver un plat, ce coût d'appariement est inacceptable.

La photo est donc **à l'intérieur du bloc fileté de sa propre recette**, directement sous son
titre. La ligne illustrée est simplement plus haute.

- Le titre reste exactement à sa place habituelle. La partie textuelle d'une ligne illustrée est
  **identique** à celle d'une ligne non illustrée.
- La photo occupe la colonne principale, alignée à gauche, jamais la marge.
- **Hauteur fixe : 200 px desktop, 160 px mobile.** Largeur libre selon le ratio
  (`height: 100%; width: auto; max-width: 100%`). Ratio d'origine conservé, **aucun recadrage
  automatique du plat**.
- Une photo de plat en 4:3 fait donc environ 270 px de large sur une colonne de 900 : elle lit
  comme une planche rapportée, pas comme une bannière.
- Angles droits, filet de 1 px en `--rule-strong`, aucune ombre.
- **Aucune légende.** Le titre est trente pixels au-dessus ; la répéter serait du bruit.
- **Toutes les recettes illustrées montrent leur photo.** Pas de cadence, pas de sélection, pas
  de règle à expliquer.
- Une ligne sans photo est une ligne **complète et normale** : rien n'y manque, aucun espace
  n'est réservé, aucun cadre vide n'est dessiné.
- **Recherche textuelle active → toutes les photos disparaissent.** L'index devient purement
  textuel et compact. Les photos servent la flânerie, jamais la recherche.

**Pourquoi ce n'est pas une vignette.** Une vignette impose une colonne d'images où l'absence se
lit comme un manque — le carré vide crie. Ici l'image est un supplément posé sous une ligne déjà
complète : son absence ne laisse aucune trace.

### Hétérogénéité des photos

L'égalisation est d'abord **structurelle** : hauteur commune, filet identique, fond blanc entre
elles. C'est l'espace blanc qui isole les différences plutôt que de prétendre les effacer.

Une égalisation **colorimétrique** (clamp de saturation, voile papier en `multiply`) reste
disponible si les photos réelles se battent visiblement entre elles — à ne mettre en place
qu'après avoir vu une vingtaine de photos restaurées, pas avant.

---

## Recalcul de portions — signaler les échecs

Le recalcul est *best-effort* : certaines lignes ne portent aucune annotation de quantité et
restent affichées telles quelles. **Ces lignes doivent le dire.** Une quantité qui n'a pas bougé
alors que tout le reste a changé passerait autrement pour une erreur.

Le marqueur est une **dague `†`** placée en fin de ligne, en `--ochre`, avec une note unique sous
la liste d'ingrédients. Elle n'apparaît que lorsque le facteur diffère de 1.

Le choix de la dague plutôt qu'un simple grisé n'est pas décoratif : `PRODUCT.md` pose la
lisibilité en conditions dégradées comme contrainte contraignante, et un signal porté par la
seule couleur échoue précisément là — mauvaise lumière, écran taché, distance variable. La dague
est une marque typographique de note, pas un pictogramme : elle ne heurte aucune règle anti-slop.

---

## Recherche

La recherche est **tolérante** : insensible aux accents et aux pluriels, et elle porte aussi sur
les ingrédients, pas seulement sur le titre. Un membre du foyer qui ne connaît pas le corpus tape
« courgette », pas un titre qu'il n'a jamais lu.

**La raison d'une correspondance doit être visible.** Si une ligne remonte parce qu'un de ses
ingrédients contient le terme cherché, la ligne d'ingrédient concernée s'affiche sous le titre,
en `--type-meta`, terme mis en évidence. Sans cela l'utilisateur voit un résultat qui ne contient
pas son mot et conclut à un bug. Une correspondance sur le titre seul n'affiche rien de plus :
la raison est déjà sous ses yeux.

**Régime de recherche active** — l'index change d'état, il ne se contente pas de filtrer :

- le regroupement alphabétique se dissout, les lettres de marge disparaissent ;
- toutes les photos disparaissent ;
- les résultats deviennent une liste plate et compacte, dans l'ordre de pertinence.

Les photos servent la flânerie, jamais la recherche.

**Sans résultat** : une ligne factuelle, pas une illustration, pas une suggestion, pas un
encouragement.

---

## Résistance

Trois états qui ne sont pas des écrans à dessiner mais des contrats à tenir.

**Échec de chargement.** Convex injoignable rejette le loader ; sans filet, la route part dans le
vide et la page est blanche en production. Une ligne qui nomme ce qui a échoué — « Les recettes
n'ont pas pu être chargées. » — et le seul recours utile, « Réessayer », qui réinvalide le
routeur. Rendu **côté serveur**, donc pas de page blanche puis bascule. Pas d'illustration, pas
d'excuse, pas de message technique : la ligne factuelle du régime « sans résultat ».

**Chargement.** Une ligne, « Chargement… », en `--type-meta`. Elle n'apparaît qu'au-delà du délai
du routeur, jamais sur un chargement rapide. **Pas de roue qui tourne, pas de squelette** — ce
serait un pictogramme décoratif et une fausse carte.

### Ce que la couleur et la position ne disent pas

`PRODUCT.md` pose la lecture en conditions dégradées comme contrainte. Le corollaire vaut aussi
pour ce qui est lu à voix haute :

- **Chaque groupe de l'index est un titre `<h2>`** — la lettre visible dans la marge *est* ce
  titre, et sa section la désigne par `aria-labelledby`. L'ordre alphabétique est le seul ordre
  de `/` ; sans cela il n'existe pas du tout pour un lecteur d'écran.
- **Tout changement déclenché par un contrôle s'annonce.** Le compteur de portions (`aria-live`
  + `aria-atomic`, pour lire « 6 personnes » et non « 6 ») et le nombre de résultats de la
  recherche, qui se reconstruit 250 ms après une frappe, en silence.
- **Aucun signe typographique ne porte seul un sens.** La dague `†` est masquée aux technologies
  d'assistance et doublée d'un texte lu en fin de ligne. Un attribut `title` ne compte pas : il
  n'est pas fiable au lecteur d'écran et **inatteignable au toucher**, qui est la surface
  principale.

---

## Anti-slop

Interdits, sans exception :

- dégradés, blobs, faux grain de papier, ombres diffuses ;
- coins arrondis, sauf éventuellement les boutons `−` et `+` du sélecteur de portions ;
- cartes, et a fortiori carte dans une carte ;
- pictogrammes décoratifs, tuiles d'icône, loupe dans le champ de recherche ;
- centrage général de la page ;
- label en capitales répété au-dessus de chaque section ;
- Inter, Roboto, Arial, Helvetica, `system-ui`, Open Sans, Lato, Montserrat, Poppins ;
- pastilles de filtre, boutons à fond plein, ombre au survol ;
- **toute couleur qui ne porte pas d'information.** Les encres de type sont admises parce
  qu'elles nomment le type et rien d'autre ; le jour où l'une d'elles sert à décorer un filet,
  un fond de ligne ou une bordure, elle sort du système.

Une seule exception d'aplat : la reliure en tête de page, qui borde la fenêtre et ne coiffe
aucun contenu.

Les filets, la typographie, le blanc et les photographies réelles portent toute la composition.

---

## Écarts assumés par rapport aux normes du domaine

**Pas de vignette par recette.** La norme lie chaque recette à une miniature. Ici elle créerait
deux classes de contenu — recettes « finies » et recettes « incomplètes » — sur un corpus où
l'absence de photo est définitive et sans remède.

**Pas de photo d'ouverture sur la fiche.** La norme occupe le premier écran avec une grande image
du plat. Ici le premier écran donne le titre, les portions et les ingrédients : ce qu'on vient
réellement chercher quand on cuisine.

---

## Provenance

Aucune. Le magazine ou le livre d'origine n'est ni extrait, ni stocké, ni affiché. Une recette
est identifiée par son titre et son type, rien d'autre. Toute maquette ou composant qui suppose
un champ « source » est hors système.
