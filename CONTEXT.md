# La table des recettes

Archive domestique de recettes découpées dans des magazines et des livres de cuisine, numérisées
par extraction vision puis corrigées à la main avant d'être rendues consultables par le foyer.

## Language

**Coupure** :
L'extrait papier d'origine — une page de magazine ou de livre, éventuellement recomposée en
collant plusieurs découpes sur une même feuille avant photographie.
_Avoid_: source, article, découpe

**Scan** :
Une ou plusieurs photographies de coupures soumises ensemble à l'extraction. Un scan porte le
cycle de vie de l'**extraction**, pas celui de la validation.
_Avoid_: upload, import, capture

**Brouillon** :
Une recette issue d'une extraction, pas encore validée par un humain. Elle n'a pas de **slug**,
n'est jamais visible en vitrine, et n'est comptée nulle part côté public.
_Avoid_: recette en attente, draft, recette non publiée

**Recette publiée** :
Une recette validée à la main et rendue consultable. Elle a **toujours** un slug, et c'est le
seul état que la vitrine connaît. Quand ce document dit « recette » sans qualificatif dans un
contexte public, il s'agit de celle-ci.
_Avoid_: recette live, recette active

**Slug** :
L'identifiant d'URL d'une recette publiée, dérivé de son titre et figé au moment de la
publication. Sa fixation est ce qui empêche un lien envoyé dans le foyer de casser quand le titre
est corrigé plus tard.
_Avoid_: permalien, identifiant

**Ligne brute** :
Une ligne d'ingrédient telle qu'elle est écrite sur la coupure. Elle fait foi. La quantité,
l'unité et le libellé qui l'accompagnent sont des **annotations** optionnelles posées par le
modèle, jamais un remplacement.
_Avoid_: ingrédient normalisé, ingrédient parsé

**Annotation** :
Le triplet optionnel `quantity` / `unit` / `label` attaché à une ligne brute. Son absence est
normale et fréquente : beaucoup de lignes réelles n'entrent dans aucun triplet.
_Avoid_: structure, parsing

**Recalcul de portions** :
L'ajustement des quantités affichées pour un nombre de personnes différent de celui de la
coupure. Il est *best-effort* : il ne s'applique qu'aux lignes brutes portant une annotation de
quantité, et il ne modifie jamais les données stockées.
_Avoid_: conversion, mise à l'échelle

**Vitrine** :
Les surfaces publiques, non indexées : l'index `/` et la fiche `/recette/$slug`. Elle ne voit que
des recettes publiées.
_Avoid_: front, site public, showcase

**Groupe** :
Un bloc de l'index rassemblant les recettes publiées partageant la même initiale. Sa lettre
apparaît une seule fois, dans la marge.
_Avoid_: section, catégorie

**Embellissement** :
Le passage d'une photo de plat par un modèle d'édition d'image pour en retirer le contexte
« photo d'une photo ». Son résultat est un **candidat** tant qu'un humain ne l'a pas accepté, et
la photo d'origine n'est jamais remplacée.
_Avoid_: retouche, amélioration, restauration
