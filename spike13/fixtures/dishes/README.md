# Jeu d'essai — photos de plats

Quatre photos de plats prises au téléphone depuis des pages de magazine. Les originaux restent
dans `~/Downloads/table-des-recettes-inbox/` et ne sont jamais commités : ils portent les
coordonnées GPS du domicile et le dépôt est public.

Ingérées par `npm run ingest13 -- <role> [source]`, qui applique la normalisation de production
(2000 px sur le grand côté, sRGB, JPEG q80, orientation EXIF appliquée) et échoue si une
métadonnée survit.

Les originaux sont arrivés en **HEIC**, que sharp ne sait pas décoder — libvips 8.18.3 échoue avec
« Security limit exceeded: Number of references in iref box (48) exceeds the security limits of 16
references ». Ils ont été convertis avant ingestion :

```
sips -s format jpeg -s formatOptions 95 <fichier>.HEIC --out <fichier>.jpg
```

## Deux rôles

`recadre*` est recadrée sur le plat avant ingestion. `brut*` garde le cadrage large de la prise de
vue : titre de rubrique, légende et colonne de texte voisine dans le champ. Le banc sépare ainsi
deux questions qu'un lot unique aurait confondues — savoir restaurer une trame d'impression, et
savoir en plus recadrer sans inventer.

La photo la plus facile et la plus difficile sont toutes deux **recadrées** : sans ça, « recadré
passe / brut échoue » aurait pu n'être qu'un artefact de difficulté plutôt qu'un effet du cadrage.

| Rôle       | Source              | Sujet                                                 | Difficulté                                        | Défauts à corriger                                                                  |
| ---------- | ------------------- | ----------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `recadre1` | `IMG_1640` recadrée | Galette feuilletée, pomme et pomme de terre           | Facile — bien éclairée, sujet net                 | Trame d'impression, grain du papier, léger reflet                                   |
| `recadre2` | `IMG_1638` recadrée | Cake aux fruits confits, deux bols d'ingrédients      | **Dure** — délavée, grain lourd, faible contraste | Grain marqué, couleurs ternes, scène encombrée                                      |
| `brut1`    | `IMG_1637`          | Fonds d'artichauts au thon, plat ovale à décor floral | Moyenne                                           | Titre de rubrique et légende à écarter, colonne voisine, courbure de page, trame    |
| `brut2`    | `IMG_1639`          | Terrine rustique de poulet, bardée, entamée           | Moyenne                                           | Reflets marqués en haut à gauche, page de travers, colonne de texte à droite, grain |
