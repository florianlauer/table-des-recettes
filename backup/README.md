# Sauvegarde des recettes

Ce répertoire contient la sauvegarde éditoriale versionnée des recettes Convex. Le workflow GitHub
Actions l’actualise chaque dimanche à 03 h UTC et peut aussi être lancé manuellement.

La sauvegarde refuse de s’exécuter tant que la base ne contient aucune recette. Ce refus est le
garde-fou qui empêche une réponse vide d’effacer le miroir existant, pas une panne du mécanisme. Le
premier passage réussi exige donc au moins une recette dans la base.

Chaque recette occupe un fichier JSON. Les clés gardent toujours cet ordre : `id`, `creationTime`,
`title`, `type`, `servings`, `ingredients`, `ingredientsInferred`, `steps`, `status`, `slug`,
`publishedAt`, `imageStorageId`, `beautifiedStorageId`. Les valeurs facultatives sont écrites à
`null`, jamais omises, afin que les diffs ne changent que lorsque la donnée change.

Le nom vient du slug réduit aux lettres ASCII minuscules, chiffres et tirets. Quand le slug manque,
devient vide ou vaut `LAST_RUN`, l’identifiant Convex sert de repli. Une collision entre deux noms
arrête la sauvegarde au lieu d’écraser une recette.

`LAST_RUN.json` est le manifeste obligatoire du snapshot. Il indique la version du format, la date
de génération, le nombre total de recettes et les comptes par statut. La restauration le valide
avant de lire les recettes, puis vérifie que les fichiers correspondent exactement à ses comptes.

## Restaurer

La cible par défaut est le déploiement de développement :

```sh
npm run restore
```

La production exige deux options et conserve la confirmation interactive de Convex :

```sh
npm run restore -- --prod --confirm-replace
```

La commande reconstruit un JSONL, recalcule `searchText`, remet `beautifiedAccepted` à `false` et
`beautifyStatus` à `idle`, puis lance `convex import --table recipes --replace`. Elle remplace toute
la table `recipes` de la cible.

Après l’import, le script relit la cible avec `convex run export:backupPayload`. Il compare les
comptes par statut au manifeste, puis le digest canonique des recettes attendues et restaurées ; les
identifiants d’images sont neutralisés dans ce calcul puisqu’ils ne peuvent pas être restaurés.

La sauvegarde ne contient pas les octets des images, les scans ni les tickets de téléversement. Les
identifiants d’images restent visibles pour la traçabilité, mais ne sont pas restaurés. Les liens de
scan et l’état de génération des images sont également perdus.
