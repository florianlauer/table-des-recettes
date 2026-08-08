# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TanStack Start (SSR) déployé sur Vercel, Convex pour la base, le stockage de fichiers, le
planificateur et la réactivité, OpenRouter pour les appels modèle. Choix de l'utilisateur, arrêté
avant l'init et confirmé par revue d'architecture. Pas de scaffold en place à ce jour.

## Users

**Un foyer partagé.** Plusieurs personnes du même logement s'en servent régulièrement pour
cuisiner — pas seulement le propriétaire du corpus, et pas seulement à l'occasion d'un lien
envoyé.

Conséquence directe : l'index doit être navigable par quelqu'un qui **ne connaît pas le corpus**.
On ne peut pas supposer qu'un visiteur sait déjà qu'une recette existe ni sous quel nom elle a
été enregistrée. De même, une fiche recette doit tenir seule, ouverte à froid.

Un second rôle, tenu par une seule personne : l'administrateur qui numérise, corrige et publie.
Les deux rôles ne partagent aucune surface.

## Product Purpose

Numériser un corpus de recettes découpées dans des magazines et des livres de cuisine, et les
rendre consultables. Une photo de la coupure part vers un modèle de vision qui en extrait titre,
ingrédients et étapes en données structurées ; un humain corrige, puis publie.

Le succès se mesure à deux choses :

1. **Corriger une recette extraite prend moins de temps que la saisir à la main.** Si ce n'est
   pas vrai, le produit n'a pas de raison d'exister — c'est le critère d'arbitrage du spike
   d'extraction.
2. **On retrouve une recette connue en quelques secondes**, sans se souvenir de son intitulé
   exact.

Ce n'est pas une publication et ce n'est pas un réseau : ni comptes, ni commentaires, ni partage,
ni indexation par les moteurs. C'est une archive domestique consultable.

## Positioning

Le corpus est une collection physique personnelle, non reproductible et non achetable ailleurs.
Aucun site de recettes existant ne peut contenir ces recettes-là : elles n'existent que sur du
papier découpé. Le produit ne concurrence pas les sites de recettes, il remplace un classeur.

## Operating Context

**Consultation — cuisine, téléphone ou tablette.** L'écran est posé ou calé sur un plan de
travail, à distance variable, les mains sont mouillées ou grasses, la lumière est mauvaise. La
tablette peut être plus loin que le téléphone : la distance de lecture n'est pas constante. Le
mobile et la tablette sont les surfaces de référence ; le desktop est secondaire.

**Numérisation — deux régimes.** Un rattrapage massif d'abord : un stock existant d'environ
150 à 200 coupures à traiter en une fois, à l'ordinateur. Puis un filet d'eau : quelques recettes
par mois. L'administration doit encaisser le batch initial sans casser, mais n'a pas besoin
d'être confortable au quotidien — la file d'attente est une surface transitoire, pas permanente.

Les pages numérisées peuvent contenir plusieurs recettes : des coupures sont pré-découpées puis
recollées sur une seule feuille avant photographie. Une recette peut aussi s'étaler sur plusieurs
images.

## Capabilities and Constraints

- Extraction vision multi-recettes depuis une ou plusieurs images, en sortie structurée stricte.
- File de validation : toute recette extraite est un **brouillon** jusqu'à validation humaine.
  Rien n'est publié automatiquement.
- Consultation : filtre par type de plat et recherche sur le titre. Pas d'autre axe.
- Types de plat : entrée, plat, dessert, apéro, petit-déjeuner, autre.
- Sélecteur de portions recalculant les quantités **à l'affichage seulement**, best-effort : les
  lignes d'ingrédients qui ne s'y prêtent pas restent inchangées.
- Illustration optionnelle : une photo du plat peut être ajoutée puis « embellie » par un modèle
  d'édition d'image. Le résultat est un candidat, jamais publié sans validation.
- Photos de coupures : conservées le temps d'une fenêtre de rétention, puis purgées. Les photos
  de plat sont permanentes.
- Administration protégée par un secret partagé vérifié côté serveur, y compris sur les lectures.
- Contrainte de coût : chaque appel modèle est facturé. Une génération d'image coûte nettement
  plus qu'une extraction de texte. Aucune reprise automatique.
- Hébergement en offres gratuites : Vercel Hobby et Convex free tier. Volumes et quotas serrés.

**Absence structurelle assumée : aucune provenance.** Le magazine ou le livre d'origine n'est ni
extrait, ni stocké, ni affiché. Une recette est identifiée par son titre et son type, rien
d'autre. Aucun travail futur ne doit réintroduire un champ « source ».

**Environ la moitié du corpus n'aura jamais de photo de plat**, et c'est définitif. Ce n'est pas
un état transitoire à combler.

## Brand Commitments

Nom : **La table des recettes**. Français, systématiquement. Aucun autre engagement d'identité
n'est établi à ce stade.

## Evidence on Hand

- Le corpus physique : environ 150 à 200 coupures de magazines et de livres, non encore
  numérisées. Aucune recette en base à ce jour.
- Aucune photo de plat existante : elles seront ajoutées une par une, après coup, et resteront
  minoritaires.
- Aucune donnée de provenance, aucune donnée nutritionnelle, aucun temps de préparation, aucune
  notation, aucun commentaire. **Ces informations n'existent pas et ne doivent pas être
  fabriquées** pour remplir une maquette ou un état vide.
- Le compte OpenRouter existe. Le modèle d'extraction et le modèle d'embellissement ne sont pas
  encore choisis : ils sortiront des spikes bloquants T1 et T13.

## Product Principles

1. **Retrouver prime sur découvrir.** L'index est un répertoire, pas un fil d'inspiration. Toute
   fonctionnalité qui ralentit la recherche au profit de la flânerie perd l'arbitrage.
2. **La machine propose, l'humain publie.** Aucune extraction, aucune image générée n'atteint la
   vitrine sans validation explicite. Un succès partiel silencieux est traité comme un échec.
3. **Ne jamais inventer de donnée.** La ligne d'ingrédient telle qu'écrite dans le magazine fait
   foi ; toute structuration est une annotation optionnelle par-dessus, jamais un remplacement.
4. **L'absence n'est pas un défaut.** Une recette sans photo est complète. Le produit ne doit
   jamais dessiner le manque.
5. **Rien de facturé ne part sans intention.** Tout appel modèle est déclenché explicitement,
   jamais par une reprise automatique ni par un effet de bord d'interface.

## Accessibility & Inclusion

Aucun standard formel n'est imposé, mais un besoin d'usage réel est établi et contraignant : la
lecture se fait en conditions dégradées — distance variable selon téléphone ou tablette, mauvaise
lumière, écran taché, mains humides ou grasses, interaction imprécise.

Cela impose : un plancher de taille de texte sur tout contenu fonctionnel, des cibles tactiles
généreuses, et l'interdiction des interactions qui exigent de la précision ou une seconde main —
accordéons à déplier, panneaux à ouvrir, survol comme condition d'accès à une information.
