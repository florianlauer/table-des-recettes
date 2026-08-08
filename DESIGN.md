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

Fond neutre, pas de parchemin jauni, pas de faux grain de papier. La chaleur vient de l'ocre
seul, pas d'un beige généralisé.

```css
:root {
  --paper:        #F8F8F8;
  --surface:      #FFFFFF;

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

L'ocre ne sert qu'à trois choses : le filet sous le titre du site, les lettres de groupe dans la
marge de l'index, l'état actif d'un filtre. **Jamais comme décoration**, jamais en aplat de fond,
jamais en remplissage de bouton.

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

Aucun bandeau coloré. Le masthead est purement typographique :

1. « La table des recettes » en grand, en haut à gauche.
2. Un filet ocre fin directement dessous.
3. « 203 recettes » en petit sans, sous le filet.
4. Recherche : uniquement le texte « Rechercher une recette » posé sur un filet fort pleine
   largeur. **Pas de carte, pas d'ombre, pas de loupe, pas de bordure de champ.**
5. Filtres sur une seule ligne typographique : `Toutes 203  Entrées 31  Plats 94  Desserts 52
   Apéro 26`. L'actif est imprimé en ocre. **Aucune pastille, aucun bouton.**
6. L'index commence avant le milieu de l'écran. Huit recettes visibles au premier écran sur
   desktop, quatre titres au minimum sur mobile.

### Premier écran de `/recette/$slug`

**Aucune photo d'ouverture.** Décision convergente des trois directions : le premier écran donne
immédiatement le titre, le type, les portions et les ingrédients. Cela réduit le défilement avec
les mains sales, et empêche une fiche sans photo de sembler amputée.

Desktop, la page forme une double page :

- à gauche : retour discret, titre, type de plat ;
- à droite : portions, puis ingrédients ;
- le début de « Préparation » apparaît en bas du premier écran ;
- la photo éventuelle arrive **ensuite**, comme une planche insérée entre les ingrédients et la
  préparation.

Mobile : titre, portions, ingrédients, puis étapes en paragraphes numérotés, le numéro dans la
marge. Aucun accordéon, aucun panneau à ouvrir, aucun bloc flottant.

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
- Hauteur de ligne **constante**. Ordre : titre, puis type de plat aligné à droite.
- Filet horizontal `--rule` entre chaque ligne.

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

## Anti-slop

Interdits, sans exception :

- dégradés, blobs, faux grain de papier, ombres diffuses ;
- coins arrondis, sauf éventuellement les boutons `−` et `+` du sélecteur de portions ;
- cartes, et a fortiori carte dans une carte ;
- pictogrammes décoratifs, tuiles d'icône, loupe dans le champ de recherche ;
- centrage général de la page ;
- label en capitales répété au-dessus de chaque section ;
- Inter, Roboto, Arial, Helvetica, `system-ui`, Open Sans, Lato, Montserrat, Poppins ;
- pastilles de filtre, boutons à fond plein, ombre au survol.

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
