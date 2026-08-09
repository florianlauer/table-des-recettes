# Les queries publiques rendent un type `PublishedRecipe`, jamais un document brut

Un **brouillon** n'a légitimement pas de **slug** — celui-ci est figé au moment de la publication,
après correction du titre — donc le champ reste `slug: v.optional(v.string())` en base. Mais une
**recette publiée** en a toujours un, et cet invariant n'existait que dans la prose de la spec :
le code voyait `string | undefined` partout et chaque consommateur inventait sa propre parade,
dont un `?? ""` qui fabriquait un lien vers `/recette/`.

Nous avons donc décidé que les queries de la **vitrine** ne rendent jamais un document Convex
brut. Elles rendent un type de sortie explicite où `slug: string` est obligatoire, et une recette
publiée dépourvue de slug lève au lieu de dégrader silencieusement. La frontière entre les deux
concepts du glossaire devient une frontière de types, pas une convention.

## Considered Options

Rendre `slug` obligatoire en base a été écarté : un brouillon acquerrait alors un slug avant
correction de son titre, et « figé à la publication » deviendrait faux.

Filtrer les recettes sans slug à l'affichage a été écarté plus fermement : une recette publiée
disparaîtrait de l'index sans que rien ne le signale, et la revue d'architecture a déjà fait
corriger deux échecs muets de cette famille.

## Consequences

Chaque query publique porte un type de sortie explicite plutôt que de laisser fuiter la forme du
document. C'est du code en plus, et c'est aussi ce qui empêche les champs d'administration
(`beautifyAttemptId`, `beautifyError`, `scanId`) de partir vers le client par simple oubli.
