# Brief — surfaces publiques

Issu de `/impeccable shape` du 2026-08-08. Périmètre : `/` et `/recette/$slug`.
Autorité visuelle : [`DESIGN.md`](../../DESIGN.md). Contexte produit : [`PRODUCT.md`](../../PRODUCT.md).

---

## 1. Métier et audience

Deux publics sur les mêmes pages, avec des cartes mentales opposées. **Celui qui connaît le
corpus** cherche une recette précise dont il a le nom approximatif en tête. **Celui qui ne le
connaît pas** — un autre membre du foyer — ne sait ni ce qui existe, ni sous quel intitulé. Les
deux arrivent depuis un téléphone ou une tablette posée dans la cuisine, mains prises, à une
distance de lecture qui varie de 35 à 70 cm.

Mode : `/` est **Operate**, on vient accomplir une tâche — retrouver. `/recette/$slug` est
**Read**, on vient comprendre et exécuter.

## 2. Résultat et preuve

`/` réussit quand une recette connue est atteinte en quelques secondes sans se rappeler son titre
exact, **et** quand un inconnu du corpus peut le parcourir sans se perdre.
`/recette/$slug` réussit quand on cuisine du début à la fin sans toucher l'écran plus d'une fois.

Ce que le produit possède réellement : environ 150 à 200 recettes, dont la moitié sans photo,
définitivement. Aucune provenance, aucun temps de préparation, aucune note, aucun commentaire.
Rien de tout cela ne doit être inventé pour meubler une maquette ou un état vide.

## 3. Direction retenue

Autorité visuelle : `DESIGN.md`, sans amendement de palette ni de typographie. Deux conséquences
structurelles nouvelles.

**La marge gauche ne porte que la lettre du groupe alphabétique.** Les numéros de ligne visibles
sur la maquette de référence sont supprimés : un numéro de rang ne désigne rien dans une liste
groupée par lettre, et un numéro stable afficherait une colonne de nombres en désordre pour un
usage que rien n'établit. La marge garde sa raison d'être — la lettre — et le filet vertical qui
la sépare de la colonne principale reste.

**L'échelle typographique devient fluide**, calibrée sur la distance de lecture et non sur des
paliers d'appareil : la distance varie continûment dans une cuisine, les breakpoints non.

Piège à éviter explicitement — une échelle indexée sur la largeur de viewport donne au desktop la
plus grande taille, alors que le desktop est la surface **la plus proche** de l'œil. L'échelle
croît donc du téléphone à la tablette paysage, puis **plafonne**. Le desktop hérite du plafond,
légèrement généreux, ce qui est sans conséquence puisqu'il est secondaire.

Ordre de grandeur, pour fixer l'intention : ingrédients à ~18 px sur téléphone, ~21-22 px sur
tablette, plafonnés à ~22 px au-delà d'environ 1100 px de large.

## 4. Portée et limites

Deux surfaces : `/` et `/recette/$slug`. Écrans d'administration **hors périmètre** — leur forme
dépend du résultat des spikes T1 et T13, qui n'ont pas tourné.

Restent intouchés : la palette, les deux familles typographiques, le refus de la vignette, le
refus de la photo d'ouverture, l'absence de mode sombre, l'absence de provenance.

Anti-objectifs explicites : aucune grille de cartes ; aucun tri par date sur `/` ; aucun
onboarding, aucune visite guidée, aucun état vide pédagogique ; aucune donnée fabriquée.

## 5. États et amplitudes

|                         | minimum | typique | maximum       |
| ----------------------- | ------- | ------- | ------------- |
| Recettes dans l'index   | 0       | 203     | ~400 à terme  |
| Recettes par lettre     | 0       | 8-15    | ~35 (C, P, T) |
| Ingrédients par recette | 3       | 8-12    | ~25           |
| Étapes                  | 1       | 4-7     | ~15           |
| Longueur de titre       | 8 car.  | ~25     | ~60           |

États matériels à traiter : index vide au tout début, sans pédagogie, une simple ligne
factuelle ; recherche sans résultat ; recette sans photo ; recette sans `servings`, donc sans
sélecteur de portions ; ligne d'ingrédient non recalculable ; titre long passant sur deux lignes
sans casser le rythme du groupe.

## 6. Interaction et disposition

**Regroupement alphabétique sur `/`.** Chaque groupe s'ouvre par un filet fort et sa lettre posée
dans la marge, composée en display. Les lignes du groupe suivent, la marge restant vide en face
d'elles. L'ordre alphabétique est le seul ordre de `/`.

**Recherche tolérante.** Insensible aux accents et aux pluriels, et portant aussi sur les
ingrédients, pas seulement sur le titre.

Conséquence non négociable : si une ligne remonte à cause d'un ingrédient, **la raison doit être
visible**. La ligne d'ingrédient ayant produit la correspondance s'affiche sous le titre, en
petit sans, terme mis en évidence. Sans cela l'utilisateur voit un résultat qui ne contient pas
son mot et conclut à un bug.

**Recherche active** : le regroupement alphabétique se dissout, les photos disparaissent, les
résultats deviennent une liste plate et compacte. C'est le régime de recherche pure déjà posé
dans `DESIGN.md`.

**Sur la fiche** : rien qui exige de la précision ou une seconde main. Pas d'accordéon, pas de
panneau, pas de survol porteur d'information. Le sélecteur de portions est la seule commande,
cible tactile généreuse. Les lignes non recalculables restent affichées telles quelles et le
signalent discrètement, plutôt que de disparaître ou de mentir.

## 7. Contraintes et décisions ouvertes

Contraignant : offres gratuites Vercel Hobby et Convex ; `noindex` ; secret admin vérifié y
compris sur les lectures ; français uniquement, pas de localisation ; lisibilité en conditions
dégradées, avec plancher de taille sur tout texte fonctionnel.

Ouvert — à ne pas inventer par un implémenteur :

- **Le seuil de plafonnement de l'échelle fluide** (~1100 px) est une estimation, à vérifier sur
  la tablette réelle.
- **La recherche par ingrédient dépasse le périmètre de la spec technique**, qui prévoit le titre
  seul. L'index de recherche Convex doit être élargi — à répercuter dans la spec.
- Aucun tri par date n'est prévu sur `/`. Si le besoin de voir les dernières recettes ajoutées
  apparaît, sa place est l'administration, pas la vitrine.

Aucun changement du modèle de données n'est induit par ce brief.
