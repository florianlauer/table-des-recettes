# Table des recettes — Design

Date : 2026-08-08
Statut : validé, passé en revue d'ingénierie (Claude + Codex), prêt pour le plan d'implémentation

## Intention

Numériser des recettes découpées dans des magazines et des livres de cuisine, puis les
consulter sur un site personnel. Une photo de la page passe par un modèle vision qui en
extrait le titre, les ingrédients et les étapes ; l'utilisateur corrige ce que le modèle a
mal lu, puis publie.

Le site a deux faces :

- une **vitrine publique** sans authentification, en lecture seule ;
- un **espace d'administration** protégé par un secret partagé, où se fait la numérisation.

## Phase 0 — Spike d'extraction (bloquant)

Rien de l'application n'est écrit avant ce spike. Toute l'architecture repose sur une
hypothèse jamais vérifiée : qu'un modèle vision sait segmenter une feuille portant plusieurs
extraits de magazine recollés et en sortir du JSON propre. Si l'hypothèse est fausse, le
modèle de données, la file de validation et le cycle de vie des photos sont tous à revoir.

**Protocole — échelle de modèles, du moins cher au meilleur.** On ne compare pas des candidats
en parallèle : on monte les échelons jusqu'au premier qui passe, et on s'arrête là.

1. **Jeu d'essai** : trois photos réelles — une page mono-recette, une page multi-recettes
   recollée, une page difficile (colonnes, texte sur photo).
2. **Échelon le plus bas** : le modèle le moins cher satisfaisant _simultanément_ deux
   contraintes — entrée **vision** et **sortie structurée stricte**. Beaucoup de modèles bon
   marché ne cochent qu'une des deux cases ; le bas de l'échelle est défini par cette
   intersection, pas par le prix seul.
3. **Évaluation contre les critères ci-dessous.** Si l'échelon échoue, on monte d'un cran et on
   recommence. Le premier échelon qui passe est retenu.

### Critères de succès (mesurables)

Sur les trois pages du jeu d'essai :

| Critère           | Seuil                                                                     |
| ----------------- | ------------------------------------------------------------------------- |
| Segmentation      | Nombre de recettes détectées = nombre réel, sur les trois pages           |
| Titre             | Exact, sans reformulation                                                 |
| Ingrédients       | Toutes les lignes présentes, aucune inventée, aucune fusionnée            |
| Étapes            | Toutes présentes, dans l'ordre                                            |
| Sortie structurée | Réponse valide contre le schéma du premier coup, sans refus ni troncature |

Critère d'arbitrage final, celui qui compte vraiment : **corriger une recette extraite doit
prendre moins de temps que la saisir à la main.** Si ce n'est pas le cas, le modèle n'a pas sa
place, quel que soit son prix.

Sorties du spike, toutes réutilisées en production : le modèle et le provider retenus, le
schéma JSON réel, le prompt, et les réponses brutes conservées comme **fixtures de test**.

### Choix du modèle en production

**Un seul modèle, figé en variable d'environnement.** Aucune escalade à l'exécution : le
runtime ne porte ni logique de repli, ni sélection dynamique, ni état supplémentaire.

Ce choix est révisable sans rien réécrire. La journalisation par tentative (modèle, provider,
version de prompt et de schéma, usage, coût, latence) donne la donnée réelle : si le taux
d'échec ou le volume de correction manuelle dérive après quelques dizaines de recettes, on monte
d'un échelon en changeant la variable d'environnement, et les fixtures du spike servent de
non-régression.

### Volet 2 — embellissement d'image

Même raisonnement, hypothèse différente : un modèle d'édition d'image sait-il **restaurer** une
photo de plat prise en photo dans un magazine — corriger la perspective, retirer la trame
d'impression et les reflets, restituer les couleurs — **sans réinventer le plat** ?

Même échelle, même règle : on part du modèle d'édition d'image le moins cher et on monte
seulement si le résultat ne passe pas.

1. Deux ou trois photos réelles de plats, prises depuis une page de magazine.
2. Échelon le plus bas d'abord (famille Gemini image de Google, ou équivalent), avec un prompt
   de restauration explicite.
3. Critère de succès, jugé à l'œil mais binaire : **le plat est-il reconnaissable comme le
   même ?** Dressage, vaisselle et ingrédients visibles préservés. Un rendu plus beau mais
   montrant un autre plat est un échec, pas un compromis.
4. Si l'échelon échoue, on monte d'un cran. Le premier qui passe est figé en variable
   d'environnement, comme pour l'extraction.

**À vérifier en premier :** la couverture d'OpenRouter en modèles à _sortie image_ est plus
étroite que sa couverture en texte et en vision. Si le modèle retenu n'y est pas routable, il
faut une clé API Google directe — donc un second secret et un second fournisseur dans la
section déploiement. Ce point conditionne l'architecture de la fonctionnalité, il se tranche
au spike, pas à l'implémentation.

## Décisions de cadrage

| Sujet             | Décision                                                                                         | Raison                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visibilité        | Public mais `noindex`                                                                            | Contenu issu d'œuvres protégées : accessible à qui a le lien, invisible des moteurs. Le SSR est conservé pour pouvoir indexer un jour sans réécriture.                                                                         |
| Filtres           | Type de plat + recherche sur le titre **et les ingrédients**                                     | Chaque filtre supplémentaire est de la correction manuelle à chaque scan. Les ingrédients, eux, sont déjà extraits : les rendre cherchables ne coûte rien à la saisie et sert le membre du foyer qui ne connaît pas le corpus. |
| Photos            | Rétention limitée (30 à 90 jours) puis purge                                                     | Aucune archive permanente, mais une fenêtre pour rattraper une recette que le modèle a manquée sur une page qu'il a par ailleurs bien traitée.                                                                                 |
| Portions          | Ligne brute canonique + structure optionnelle                                                    | La ligne du magazine fait foi ; le recalcul est un confort d'affichage, pas le format d'archivage.                                                                                                                             |
| Authentification  | Secret partagé, vérifié côté serveur                                                             | Un seul utilisateur. Ni comptes, ni sessions, ni fournisseur d'identité.                                                                                                                                                       |
| Sauvegarde        | Export automatique versionné dans git                                                            | Les corrections manuelles sont la donnée la plus coûteuse à reproduire, et la seule qui subsiste après purge des photos.                                                                                                       |
| Illustration      | Photo du plat optionnelle, uploadée à part, embellie sur demande et validée à la main            | Découplée du scan pour rester possible après publication. Le modèle invente forcément (couleurs, hors-champ) : l'originale est conservée et rien n'est publié sans acceptation explicite.                                      |
| Choix des modèles | Un seul modèle par usage, le moins cher qui passe les critères, figé en variable d'environnement | L'escalade se joue au spike, pas à l'exécution : le runtime ne porte aucune logique de repli. Révisable en changeant une variable, avec les fixtures du spike comme non-régression.                                            |

## Stack

- **TanStack Start** (SSR) déployé sur Vercel, offre Hobby — usage personnel, donc conforme.
- **Convex** pour la base, le stockage de fichiers, l'ordonnanceur et la réactivité.
- **OpenRouter** pour l'extraction vision, appelé exclusivement depuis une action Convex.

Convex n'est pas un choix par défaut : ce projet est un pipeline asynchrone, et les quatre
briques nécessaires sont natives — _actions_ (appel HTTP sortant avec secrets serveur),
_scheduler_ (extraction en tâche de fond), _file storage_ (photos temporaires), _réactivité_
(la file de validation se met à jour seule quand une extraction se termine).

Réserves assumées : TanStack Start a un écosystème plus jeune que Next.js et son déploiement
Vercel passe par Nitro, encore en développement actif ; Convex implique un couplage fort
(requêtes en TypeScript, pas en SQL). La revue extérieure a proposé de supprimer entièrement
Convex et le SSR au profit d'un script local plus site statique. **Écarté** : le flux de
capture mobile et l'espace d'administration exigent un backend, et l'apprentissage de
TanStack Start fait partie de l'objectif.

### Déploiement

À câbler explicitement, ce n'est pas un détail de fin de projet :

- `npx convex deploy --cmd 'npm run build'` orchestre le déploiement du backend puis le build
  du front avec la bonne URL Convex injectée ;
- clés de déploiement distinctes pour la production et les previews ;
- les previews Vercel utilisent des **backends Convex vides et séparés** : leurs variables
  d'environnement (secret d'administration, clé OpenRouter) doivent être configurées à part,
  sinon les previews échouent silencieusement.

## Modèle de données

Deux tables. Le statut d'**extraction** vit sur le scan, le statut de **validation** vit sur la
recette — un scan peut produire plusieurs recettes, les deux cycles sont donc distincts.

### `scans`

| Champ             | Type                                              | Note                                                                               |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `imageStorageIds` | `Id<"_storage">[]`                                | 1 à N images traitées ensemble (recette à cheval sur deux pages) ; vidé à la purge |
| `status`          | `"pending" \| "extracting" \| "done" \| "failed"` |                                                                                    |
| `attemptId`       | `string?`                                         | identifiant de la tentative en cours ; garantit l'idempotence                      |
| `startedAt`       | `number?`                                         | horodatage de la réservation                                                       |
| `attempts`        | `number`                                          | nombre d'extractions tentées                                                       |
| `error`           | `string?`                                         | message lisible en cas d'échec                                                     |
| `purgeAfter`      | `number?`                                         | date de purge des images, posée à la publication                                   |
| `createdAt`       | `number`                                          |                                                                                    |

Index : `by_status`, `by_purge_after`.

### `recipes`

| Champ                 | Type                                                                  | Note                                                                                                                               |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `scanId`              | `Id<"scans">?`                                                        | absent si saisie manuelle                                                                                                          |
| `title`               | `string`                                                              |                                                                                                                                    |
| `slug`                | `string?`                                                             | figé à la publication : dérivé du titre, unique, suffixé en cas de collision                                                       |
| `type`                | `"entree" \| "plat" \| "dessert" \| "apero" \| "petitDej" \| "autre"` |                                                                                                                                    |
| `servings`            | `number?`                                                             | portions d'origine ; absent = pas de curseur                                                                                       |
| `ingredients`         | `Ingredient[]`                                                        | voir ci-dessous                                                                                                                    |
| `steps`               | `string[]`                                                            | une entrée = une étape                                                                                                             |
| `searchText`          | `string`                                                              | dénormalisé, maintenu à l'écriture : titre + `raw` des ingrédients, normalisé sans accents. Porte l'index de recherche plein texte |
| `status`              | `"review" \| "published"`                                             |                                                                                                                                    |
| `publishedAt`         | `number?`                                                             |                                                                                                                                    |
| `imageStorageId`      | `Id<"_storage">?`                                                     | photo du plat, uploadée à part — **permanente**, jamais purgée                                                                     |
| `beautifiedStorageId` | `Id<"_storage">?`                                                     | candidat embelli, ou version acceptée                                                                                              |
| `beautifiedAccepted`  | `boolean`                                                             | faux tant que tu n'as pas validé le rendu                                                                                          |
| `beautifyStatus`      | `"idle" \| "generating" \| "review" \| "failed"`                      |                                                                                                                                    |
| `beautifyAttemptId`   | `string?`                                                             | même discipline d'idempotence que l'extraction                                                                                     |
| `beautifyError`       | `string?`                                                             |                                                                                                                                    |

```ts
type Ingredient = {
  raw: string // la ligne telle qu'écrite dans le magazine — canonique, toujours présente
  quantity?: number // annotation, absente si la ligne ne s'y prête pas
  unit?: string // "g", "ml", "cuillère à soupe", … ; absent pour les unités nues
  label?: string // "farine", "œufs", "gousses d'ail"
}
```

**La ligne brute fait foi, la structure est une annotation.** Beaucoup de lignes réelles
n'entrent dans aucun triplet : « 2 à 3 gousses », « 1/2 à 3/4 de sachet », « une boîte de
400 g », « beurre ou margarine », « pour la pâte : ». Forcer la structure obligerait le modèle
à normaliser arbitrairement, et l'original serait perdu — définitivement, une fois les photos
purgées. Ici, le modèle annote ce qu'il peut et laisse le reste.

Index : `by_status_type`, `by_slug`, `by_scan`, et un index de recherche plein texte filtré sur
`status`.

**La recherche porte sur le titre et sur les ingrédients**, pas sur le titre seul : un membre du
foyer qui ne connaît pas le corpus cherche « courgette », pas un intitulé qu'il n'a jamais lu.
Convex n'indexe qu'un champ texte par index de recherche ; il faut donc un champ dénormalisé
`searchText` maintenu à l'écriture, concaténant le titre et les `raw` des ingrédients, et c'est
lui qui porte l'index. La normalisation — accents retirés, casse repliée — se fait à l'écriture
sur ce champ **et** sur la requête, pas à la lecture.

L'interface doit pouvoir dire **pourquoi** une recette remonte : la requête renvoie donc, à côté
de la recette, la ligne d'ingrédient qui contient le terme, quand la correspondance ne vient pas
du titre.

### Source unique de vérité

La forme d'une recette est décrite **une seule fois**, dans un schéma **Zod**. En dérivent le
JSON schema envoyé à OpenRouter, la validation de la réponse du modèle, et les types du
formulaire de correction.

Réserve à traiter à l'implémentation : Convex impose ses propres validateurs `v` pour le
schéma de table et les signatures de fonctions. Le pont doit être choisi explicitement
(`convex-helpers` / `zodOutputToConvex`, avec ses limites sur les transforms et les valeurs par
défaut), sinon la « source unique » reste une intention et une seconde représentation
réapparaît en douce.

## Flux d'ingestion

```
capture → upload (scan pending) → [bouton] worker → extraction → file de validation → publication
                                       │                ↓ échec                              ↓
                                       │             failed → relance                  purgeAfter posé
                                       └── réserve UN scan à la fois (attemptId)              ↓
                                                                                     purge des images
```

1. **Capture.** Sur mobile, l'appareil photo, une page à la fois. Sur desktop, plusieurs
   fichiers d'un coup pour rattraper le stock initial — et ceux-là forment **un scan par fichier**,
   parce que ce sont des pages sans rapport les unes avec les autres. Les pages du lot sont des
   feuilles sur lesquelles plusieurs extraits ont été recollés : **un scan peut contenir plusieurs
   recettes**. Un scan peut aussi porter **plusieurs images** (jusqu'à quatre) quand elles se lisent
   ensemble — les deux pages d'une recette qui continue au verso sont envoyées dans un seul appel au
   modèle. Ce regroupement est un geste explicite depuis l'écran de correction, jamais le défaut
   d'une sélection multiple.
2. **Compression côté client** avant l'envoi (~1500 px de large, JPEG), avec un **plafond en
   octets** en plus du plafond en pixels — l'egress Convex se compte en octets, pas en pixels.
   **Garde-fou format :** après décodage, vérifier que l'image a des dimensions non nulles. Un
   HEIC d'iPhone se décode dans Safari mais pas dans Chrome ni Firefox : sans cette
   vérification, une image vide part au modèle, l'appel est facturé, et la réponse est
   « aucune recette détectée » sans le moindre indice sur la cause. Le fichier est refusé avec
   un message nommant le format et la marche à suivre (réglage iPhone « Le plus compatible »,
   ou export en JPEG). Couvre aussi les fichiers corrompus et les non-images.
3. **Upload** vers le stockage Convex, création d'un `scan` en `pending`. **L'upload ne
   planifie rien.**
4. **Worker.** Le bouton « lancer la file » démarre un worker qui **réserve un seul scan à la
   fois** : une mutation atomique fait passer un scan `pending` en `extracting` et y pose un
   `attemptId` et un `startedAt`. Le worker enchaîne, un scan après l'autre.

   Cette réservation est ce qui rend la sérialisation réelle. Planifier une extraction à chaque
   upload, comme le faisait la version précédente de cette spec, déclenche trente actions
   simultanées sur un lot de trente fichiers — le contraire de ce qui est recherché, et un
   rate limit OpenRouter garanti.

5. **Extraction.** Une action Convex envoie les images du scan au modèle vision d'OpenRouter en
   **sortie structurée** (`strict: true`, `require_parameters: true`), avec **modèle et provider
   figés**. La réponse est validée contre le schéma Zod. Les refus et les réponses tronquées
   sont traités comme des échecs, pas comme des réponses vides.
6. **Finalisation atomique.** L'écriture des recettes et le passage du scan à `done` se font
   dans **une seule mutation**, rejetée si l'`attemptId` du scan ne correspond plus à celui de
   la tentative.

   Sans cela, une action qui meurt après avoir écrit deux recettes sur trois laisse un état
   partiel : la relance repaie l'appel et crée des doublons. Les actions Convex s'exécutent au
   plus une fois et ne sont pas réessayées automatiquement — l'idempotence est à la charge de
   l'application.

7. **Journalisation par tentative.** Modèle, provider, version du prompt et du schéma, usage,
   coût et latence sont stockés à chaque tentative. Sans ces traces, une régression de qualité
   d'extraction est indiagnosticable a posteriori.
8. **File de validation.** Liste réactive : les recettes apparaissent d'elles-mêmes à mesure que
   les extractions se terminent, sans rechargement.

   **Relance manuelle, pas de surveillance automatique** (choix assumé) : plutôt qu'un cron de
   rattrapage, l'écran de file **affiche en permanence le nombre de scans `pending` et
   `extracting`** et propose un bouton de relance. Le blocage doit rester visible sans effort —
   c'est ce qui rend le bouton utilisable.

9. **Correction.** Images d'origine et champs éditables côte à côte (empilés sur mobile).
   L'écran permet aussi d'**ajouter une recette** que le modèle a manquée sur la page et de
   **supprimer** un faux positif : une page mal segmentée se rattrape au lieu d'imposer de
   supprimer le scan et de refaire la photo.
10. **Publication.** La recette passe en `published`, son `slug` est figé — et n'est jamais
    recalculé ensuite, même si le titre change : c'est l'adresse que la vitrine a distribuée. La
    dépublication est possible et conserve le slug. Quand plus aucune recette du scan n'est en
    `review` **et qu'au moins une est publiée**, `purgeAfter` descend à sept jours ; sinon il
    remonte au plafond. Un scan vidé de ses recettes est un scan raté, pas un scan traité, et sa
    photo est la seule chose qui permette de le rattraper.

## Illustration des recettes (optionnel)

Une recette peut porter une photo du plat. C'est **facultatif par recette** et **découplé du
flux de scan** : l'image s'ajoute au moment de la correction comme des mois après la
publication, sur une recette déjà en ligne.

```
upload photo du plat ──► [bouton embellir] ──► génération ──► comparaison avant/après
      │                                              ↓ échec            │
      │                                           failed → relance      ├─ accepter → publiée
      └── originale conservée, permanente                               ├─ rejeter → candidat supprimé
                                                                        └─ régénérer → nouvel appel
```

1. **Upload.** La photo d'origine est stockée **définitivement** — contrairement aux scans, elle
   n'est jamais purgée. Elle passe par le même garde-fou de format et de taille que les scans.
2. **Embellissement.** Un bouton explicite déclenche une action Convex qui envoie l'image à un
   modèle d'édition, avec un prompt de **restauration** : corriger la perspective et le cadrage,
   retirer la trame d'impression, le moiré, les reflets et le grain du papier, restituer les
   couleurs si la source est en noir et blanc. Interdiction explicite dans le prompt de modifier
   le plat, le dressage, la vaisselle ou les ingrédients visibles, et d'ajouter des éléments.
3. **Comparaison obligatoire.** Le résultat est un **candidat**, jamais publié automatiquement.
   L'écran affiche l'originale et le rendu côte à côte ; tu acceptes, tu rejettes, ou tu
   régénères.
4. **Affichage en vitrine.** Version embellie si acceptée, sinon l'originale, sinon rien.

**Pourquoi la validation humaine est non négociable.** Ce n'est pas de la restauration pure :
recoloriser une photo noir et blanc, c'est inventer des couleurs ; élargir un cadrage, c'est
inventer le hors-champ. Le modèle hallucinera — parfois joliment, parfois en changeant le plat.
Conserver l'originale et exiger une acceptation explicite est ce qui rend l'hallucination sans
conséquence.

**Coût et idempotence.** Une génération d'image coûte nettement plus qu'une extraction de texte.
Donc : aucune reprise automatique, régénération toujours déclenchée à la main, `beautifyAttemptId`
sur le même principe que l'extraction pour qu'une tentative périmée ne puisse pas écraser un
résultat accepté, et le rate limit d'administration couvre cette fonction comme les autres.

**Conséquences sur le reste du plan.** La vitrine n'est plus purement typographique : elle
mélange des recettes illustrées et non illustrées, ce qui devient une contrainte de conception
à part entière. Et ces images sont le premier stockage permanent du projet — environ 60 Mo pour
200 recettes, très en deçà du gigaoctet gratuit, mais ce n'est plus « zéro stockage ».

## Recalcul des portions

Sur la fiche recette, un sélecteur de nombre de personnes applique un facteur
`cible / servings`. Le recalcul est **best-effort** : il s'applique aux lignes annotées d'une
`quantity` et laisse les autres telles quelles.

- une ligne **sans `quantity` est affichée inchangée** (« une pincée de sel », « 2 à 3
  gousses ») ;
- les quantités sont arrondies pour rester lisibles : pas de `1,3333 œuf`. Une ligne **sans
  `unit`** est dénombrable (œufs, gousses) : arrondi à l'entier, minimum 1. Une ligne **avec
  `unit`** est arrondie à l'entier si le résultat dépasse 10, au demi sinon ;
- si `servings` est absent, le sélecteur n'est pas affiché ;
- le calcul est **purement à l'affichage**. Les données stockées ne sont jamais modifiées.

## Surfaces

**Vitrine**

- `/` — liste des recettes publiées groupée par lettre, filtre par type, recherche sur le titre
  et les ingrédients.
- `/recette/$slug` — fiche : ingrédients avec sélecteur de portions, étapes.

Aucune provenance n'est conservée : le magazine ou le livre d'origine n'est ni extrait, ni
stocké, ni affiché. Une recette n'est identifiée que par son titre et son type.

**Administration**

- `/admin` — page unique : saisie du secret, capture, file de validation et liste des scans. La
  découpe en quatre routes qu'annonçait cette spec n'a pas eu lieu ; elle n'aurait rien débloqué et
  la page tient. Capture : appareil photo (mobile) ou sélection multiple (desktop), **un scan par
  fichier**. File réactive, compteurs `pending` / `extracting` visibles en permanence, bouton de
  lancement et de relance.
- `/admin/scan/$id` — écran de correction, **clé par scan** et non par recette : le geste central
  est « cette page a été mal segmentée », qui porte sur la page. Pages d'origine en tête, recettes
  du scan empilées dessous ; édition des champs, ajout et suppression de recettes, ajout et retrait
  d'une page, relance de l'extraction, publication.

## Sécurité

**Le secret d'administration est une variable d'environnement Convex, vérifiée côté serveur
dans chaque fonction d'administration — mutations, actions, et queries.** Le contrôle côté
client sert uniquement au confort de navigation ; il n'est jamais la protection réelle.

Les **queries comptent**. La file de validation, les brouillons, les compteurs et les URLs
d'images passent tous par des queries Convex, qui sont publiques par défaut : une garde limitée
aux mutations et aux actions laisserait l'intégralité des brouillons lisible par quiconque
connaît les noms de fonctions. Toutes les fonctions d'administration passent par un helper
unique `requireAdmin(ctx, token)`, appelé en première ligne — une règle du type « ne pas
oublier de vérifier » finit toujours par sauter une fonction.

Le risque principal reste budgétaire : sans garde, quiconque trouve `/admin` peut déclencher
des extractions, donc dépenser la clé OpenRouter. Mesures retenues :

- secret **aléatoire fort** (pas une phrase mémorisable), généré une fois ;
- **rate limit** sur les fonctions d'extraction et de relance ;
- rotation par changement de la variable d'environnement, qui invalide immédiatement tous les
  jetons distribués.

Limite assumée : ce jeton est de fait le secret racine, stocké en `localStorage`, sans
expiration ni périmètre, lisible par toute injection de script. Un vrai système d'identité ou
un échange contre une session courte serait plus solide ; c'est disproportionné pour un site
personnel à un seul utilisateur, et le confort de ne pas se réauthentifier à chaque session
mobile est un critère explicite.

La clé OpenRouter n'existe que dans l'environnement Convex et n'est jamais transmise au
navigateur. Si l'embellissement d'image impose une clé Google directe (voir spike, volet 2),
elle suit exactement le même régime : variable d'environnement Convex, jamais côté client, et à
configurer séparément sur les backends de preview.

## Sauvegarde

Une tâche planifiée exporte les recettes publiées en JSON et **commite le résultat dans un
dépôt git**. Deux bénéfices : une copie hors de Convex, et un historique des corrections
recette par recette.

Motif : l'offre gratuite Convex ne fournit que des sauvegardes manuelles conservées sept jours.
Une fois les photos purgées, les recettes corrigées à la main sont la seule copie d'un travail
long à reproduire — et le seul scénario du projet où tout est perdu d'un coup.

## Gestion des erreurs

- **Extraction en échec** → `scan` en `failed`, **images conservées**, relance manuelle en un
  clic. Aucune reprise automatique en boucle : chaque tentative coûte de l'argent. La relance
  incrémente `attemptId`, ce qui neutralise une tentative précédente encore en vol.
- **Réponse hors schéma, refus, ou troncature** → traités comme un échec d'extraction, la
  réponse brute est consignée dans `error` pour diagnostic.
- **Page illisible** → l'écran de correction accepte une recette entièrement vide : la saisie
  manuelle reste toujours possible.
- **Aucune recette détectée** → `failed`, message « aucune recette détectée », **images
  conservées**, relançable. « Je n'ai rien trouvé » et « je n'ai pas su lire » sont
  indiscernables : supprimer les images ici détruirait sans trace la seule copie numérique
  d'une page valide. Une photo réellement vide se supprime à la main.
- **Format d'image non décodable** (HEIC hors Safari, fichier corrompu) → refusé à l'upload,
  avant toute création de scan et tout appel facturé.

## Tests

Périmètre volontairement étroit — projet personnel, un seul utilisateur.

- Validation et normalisation de la sortie du modèle, **sur les fixtures produites par le spike
  de phase 0** : c'est le point qui cassera. Inclut zéro / une / plusieurs recettes par scan,
  les lignes d'ingrédients atypiques, et les réponses hors schéma.
- **Idempotence de la finalisation** : une finalisation portant un `attemptId` périmé est
  rejetée ; une relance après échec partiel ne produit pas de doublon.
- Recalcul des portions : facteur, arrondis avec et sans unité, lignes sans `quantity`,
  `servings` absent.
- Cycle de vie des images : `purgeAfter` posé seulement quand plus aucune recette du scan n'est
  en `review` ; purge effective à l'expiration.
- Génération de slug et résolution des collisions.
- Garde-fou d'upload : image valide acceptée, image non décodable refusée.
- `requireAdmin` : jeton valide, invalide, absent — sur une query autant que sur une mutation.
- Embellissement : un candidat n'est jamais affiché en vitrine tant que `beautifiedAccepted`
  est faux ; un rejet supprime le candidat et laisse l'originale intacte ; une finalisation
  portant un `beautifyAttemptId` périmé est rejetée.
- Affichage vitrine : recette avec version acceptée, avec originale seule, et sans aucune image.

Pas de tests end-to-end, pas de tests de composants d'affichage.

## Hors périmètre

Comptes utilisateurs, favoris, notes, listes de courses, import depuis une URL, recadrage d'une
photo de plat directement dans le scan (l'upload séparé a été retenu, il découple la
fonctionnalité de la purge), galerie de plusieurs photos par recette, génération d'une photo de
plat quand aucune n'existe (ce serait de l'invention pure, pas de la restauration),
tags libres, multilingue, application mobile native, pagination de la vitrine
(sans objet à 200 recettes), cron de surveillance de la file (relance manuelle retenue),
conversion HEIC dans le navigateur (détection et refus retenus), fusion de recettes entre
plusieurs scans (le scan multi-images couvre le cas réel).

**Signalé par la revue extérieure et non retenu :** un test d'intégration bout en bout du
pipeline (`upload → extraction simulée → finalisation → publication → purge`). L'argument est
défendable — les tests unitaires ci-dessus ne couvrent ni l'upload, ni le stockage, ni
l'enchaînement réel — mais le périmètre de test a été délibérément restreint. À reconsidérer si
le pipeline se met à casser en usage.

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status       | Findings                   |
| ------------- | --------------------- | ------------------------------- | ---- | ------------ | -------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 0    | —            | —                          |
| Codex Review  | `/codex review`       | Independent 2nd opinion         | 0    | —            | —                          |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 1    | CLEAR        | 15 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 0    | —            | —                          |
| DX Review     | `/plan-devex-review`  | Developer experience gaps       | 0    | —            | —                          |
| Outside Voice | `/plan-eng-review`    | Cross-model plan challenge      | 1    | issues_found | 18 findings (codex)        |

**CODEX :** 18 constats. 5 appliqués directement (auth sur les queries, plafond en octets,
`strict`/`require_parameters` et journalisation par tentative, section déploiement, réserve sur
le pont Zod↔Convex), 5 portés en tensions arbitrées, 2 écartés (abandon de Convex et du SSR —
décision de stack déjà tranchée), 1 signalé et non retenu (test d'intégration du pipeline).

**CROSS-MODEL :** 5 tensions, toutes résolues. Rétention des photos → fenêtre limitée puis
purge. Modèle d'ingrédient → ligne brute canonique. Atomicité de l'extraction → `attemptId` et
finalisation en mutation unique. Cardinalité des scans → scan multi-images plus ajout et
suppression de recettes. Sauvegarde → export automatique versionné dans git.

**Deux contradictions internes de la spec initiale, trouvées par la voix extérieure :** l'upload
planifiait une extraction par fichier tout en prétendant les sérialiser, et la garde
d'administration ne couvrait pas les queries Convex, publiques par défaut. Les deux sont
corrigées.

**VERDICT :** ENG CLEARED — prêt pour le plan d'implémentation, phase 0 (spike) bloquante.

**AJOUT DE PÉRIMÈTRE POST-REVIEW (2026-08-08)** — illustration des recettes : photo du plat
optionnelle, uploadée séparément, embellie par un modèle d'édition d'image et validée à la main.
Non passée par la revue d'ingénierie. Trois points hérités par construction (validation humaine
obligatoire, `beautifyAttemptId` pour l'idempotence, garde-fou de format à l'upload) ; deux
points ouverts qui se tranchent au spike volet 2 : la routabilité du modèle via OpenRouter, et
le fait que la vitrine mixe désormais recettes illustrées et non illustrées, ce qui change le
brief de conception visuelle.

NO UNRESOLVED DECISIONS
