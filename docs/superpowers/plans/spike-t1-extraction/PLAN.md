# Plan: Spike T1 — validation de l'extraction vision multi-recettes

_Locked via grill — by Claude + florianlauer, 2026-08-08 · révisé après revues Codex rounds 1–4_

## Goal

Trancher, sur un banc d'essai jetable et hors application, l'hypothèse centrale du projet : un
modèle vision sait-il segmenter une page portant plusieurs coupures de magazine recollées et en
sortir du JSON strict fidèle ? Protocole d'échelle, du moins cher au meilleur : on part de
l'endpoint le moins cher satisfaisant *simultanément* entrée vision et sortie structurée stricte,
on monte d'un échelon à chaque échec, on s'arrête au premier qui passe. Livrables : modèle et
provider figés en variable d'environnement, schéma Zod canonique, prompt versionné, réponses
brutes conservées comme fixtures. Un verdict **négatif** au sommet de l'échelle est un résultat
valide et suffisant : il rouvre le design avant qu'une ligne d'application ne soit écrite.

Périmètre : **T1 entier**, en une passe, pas de découpage en sous-phases.

## Approach

L'ordre des étapes 0 → 1 → 1b est **contraignant** : le prompt doit être figé avant que la page
d'acceptation soit ouverte. L'inverse reviendrait à régler l'instrument sur l'épreuve.

### Étape 0 — Ingestion du jeu d'essai (bloquant, humain)

1. Photographier **quatre** pages réelles :
   - **A** — mono-recette ;
   - **B** — multi-recettes recollée, au moins trois recettes sur une vraie feuille de collage ;
   - **C** — difficile : colonnes, texte incrusté sur photo, reflets ou pliure ;
   - **D** — **page d'acceptation**, multi-recettes également.
   JPEG, grand côté ≥ 2000 px.
2. Les originaux restent **hors du dépôt**, dans `~/Downloads/table-des-recettes-inbox/`. Ils ne sont jamais
   commités : une photo de téléphone porte les coordonnées GPS du domicile, et le dépôt est public.
3. `spike/ingest.ts <page>` — normalise via `sharp` et écrit dans `spike/fixtures/pages/` :
   `.rotate()` (applique l'orientation EXIF, sans quoi une page shootée en paysage arriverait
   couchée au modèle), **suppression de toutes les métadonnées**, redimensionnement à 2000 px sur
   le grand côté sans agrandissement, sRGB, JPEG q80. Puis **relecture des métadonnées du fichier
   écrit** : s'il en reste, le script échoue. Seules les sorties normalisées entrent dans le
   dépôt ; c'est le seul endroit du spike où une image est transformée.
4. Ingérer **A, B et C seulement**. **D reste scellée dans l'inbox** jusqu'à l'étape 1b.
5. Noter à la main dans `spike/fixtures/pages/README.md` le **nombre réel de recettes** de A, B
   et C — seule vérité terrain de ces trois pages, et base du critère de segmentation.

### Étape 1 — Socle (parallélisable avec l'étape 0)

6. `npm init` à la racine. Dépendances : `tsx`, `zod` (v4), `dotenv`, **`sharp`** (décodage,
   auto-rotation, redimensionnement, recompression, lecture des métadonnées — rien de tout cela
   n'est faisable en Node nu). Node 22 est déjà fourni par `devenv.nix`. Clé dans `.env`
   (`OPENROUTER_API_KEY`), déjà gitignoré.
7. `src/lib/recipe-schema.ts` — schéma Zod **canonique**, celui dont T2 héritera :

   ```
   Recipe     = { title, type, servings, ingredients: Ingredient[], steps: string[] }
   Ingredient = { raw, quantity, unit, label }
   type       = "entree" | "plat" | "dessert" | "apero" | "petitDej" | "autre"
   Extraction = { recipes: Recipe[] }
   ```

   Racine = **objet**, pas tableau nu : le mode structuré strict exige un objet racine.
   Les champs non garantis (`servings`, `quantity`, `unit`, `label`) sont déclarés **`.nullable()`,
   pas `.optional()`** : le mode strict interdit l'optionnalité réelle et le modèle renverra `null`
   explicite. Un helper de normalisation `null → undefined` fait la jonction vers le modèle de
   domaine ; sans lui, le schéma refuserait sa propre sortie.
   Hors schéma par construction : `searchText`, `slug`, `imageId`, provenance, temps de
   préparation ou de cuisson.
8. `spike/json-schema.ts` — dérivation du JSON Schema depuis le Zod (`z.toJSONSchema()`), puis
   normalisation stricte : `additionalProperties: false` partout et **toutes** les clés dans
   `required`. Avec des champs déjà nullables côté Zod, la dérivation est fidèle sans bricolage.
9. `spike/prompt.ts` — prompt v1, exporté avec un identifiant de version explicite. **Commité.**
   Ce commit *est* le gel : il horodate le fait que le prompt a été écrit sans connaissance de la
   page d'acceptation.

### Étape 1b — Sceller l'oracle (strictement après le gel du prompt)

10. `prompt v1` commité, et pas avant : ingérer D (même normalisation, même vérification de
    métadonnées), l'ouvrir, transcrire à la main la vérité terrain dans
    `spike/fixtures/truth/d-acceptation.json`, **chronomètre en marche** → `T_saisie`, référence
    « saisie manuelle » de l'arbitrage final.
    **Champs transcrits — exactement l'ensemble d'identité** : `title`, `type`, `servings`,
    `ingredients[].raw` (toutes les lignes), `steps` (toutes, dans l'ordre). Rien de plus, rien de
    moins : c'est cet ensemble, et lui seul, qui sert à la fois d'oracle d'acceptation et de cible
    du chronomètre. Les sous-champs `quantity`, `unit` et `label` **ne sont pas transcrits** —
    conformément à la décision 10 ils restent observés et non notés, donc ni scorés ni chronométrés.
    Une seule page transcrite : ~20 min de travail humain, et T11 hérite d'une graine de
    non-régression réelle.
11. **Règle de péremption.** À partir de cet instant, D est connue de l'évaluateur. Si l'unique
    réécriture de prompt autorisée (étape 3) est déclenchée, `prompt v2` sera écrit par quelqu'un
    qui a lu D : **D est alors brûlée comme page d'acceptation** et remplacée par une page **D′**
    fraîchement shootée, ingérée et transcrite *après* le commit de `prompt v2`. Même mécanique de
    contingence qu'à l'étape 4 : aucun travail anticipé, et dans le cas nominal D′ n'existe jamais.

### Étape 2 — Établir l'échelle

12. `spike/rank-endpoints.ts` — l'échelle est faite de couples **`{model, providerSlug}`**, pas de
    modèles : le prix, la latence et le support du mode strict varient d'un endpoint à l'autre chez
    un même modèle.
    - `GET /api/v1/models` puis `GET /api/v1/models/:author/:slug/endpoints` pour les candidats.
    - Filtre : `input_modalities` contient `image` **ET** `supported_parameters` contient **tous
      les paramètres réellement envoyés** (`structured_outputs`, `response_format`, `temperature`,
      `max_tokens`) — sinon `require_parameters: true` rendra artificiellement indisponible un
      endpoint par ailleurs valide.
    - **Coût de classement** = `pricing.prompt × tokens_texte` + **`pricing.image × 1`** +
      **`pricing.request`** + `pricing.completion × 2500` — une sortie *représentative*, pas le
      plafond. Trier sur 8000 tokens classerait les pires cas et pourrait inverser l'ordre entre
      deux endpoints selon leur ratio prompt/completion, alors que le protocole demande « le moins
      cher », c'est-à-dire le coût attendu d'une extraction réelle. Les 8000 tokens ne servent
      qu'au calcul de budget (étape 15).
    - Un poste tarifaire absent ou inconnu n'est **pas** traité comme zéro : l'endpoint sort de
      l'échelle principale et rejoint la **file « prix incertain »**.
13. **Résorber la file « prix incertain » AVANT l'escalade**, pas après. Un endpoint au prix inconnu
    peut être le moins cher de tous : le sonder seulement au moment d'un verdict négatif le rendrait
    invisible dès qu'un endpoint connu passe, ce qui contredit frontalement « le moins cher qui
    passe ».
    - Au maximum **trois** endpoints incertains sont sondés, choisis par capacité annoncée.
    - **Appel-sonde** : une image, `max_tokens: 512`, dont le seul but est de faire renvoyer le
      coût réel par l'API. Ce coût comble les postes tarifaires manquants et l'endpoint est alors
      **inséré à sa vraie place dans l'échelle principale**.
    - **Borne de la sonde** : par construction on ne peut pas pré-vérifier le coût d'un appel dont
      le prix est inconnu. Politique de perte bornée : une **réserve forfaitaire de 0,25 €** est
      retenue contre le plafond avant chaque sonde ; si `dépense_cumulée + 0,25 € > plafond`, la
      sonde n'a pas lieu. Si le coût réel dépasse la réserve, l'endpoint est **exclu** et le
      dépassement est journalisé — on préfère perdre un candidat qu'une garantie de budget.
    - Un endpoint incertain non sondé (file pleine, budget épuisé) est consigné dans `RESULTS.md`
      comme **non évalué** : le verdict dit alors ce qu'il a réellement couvert.
14. Sortie figée dans `spike/ladder.<date>.json` : l'échelle unique après résorption, le
    `data_collection` relevé pour information, et la liste des endpoints exclus ou non évalués.
    Top 10 affiché. **C'est l'ordre d'escalade, sans arbitrage manuel.**
15. **Budget au pire cas, pas au cas nominal.** Par échelon : 6 appels d'escalade × 3 tentatives
    maximum + 2 passes d'acceptation × 3 tentatives, chacun facturé sur `max_tokens: 8000` de
    sortie. Multiplié par le nombre d'échelons envisagés, plus la file « prix incertain ». Le
    harnais tient un **compteur cumulatif de dépense réelle** et refuse un appel dès que
    `dépense_cumulée + coût_maximal_estimé_du_prochain_appel > 5 €` — vérifier la seule dépense
    déjà consommée laisserait toujours un dernier appel franchir le plafond. Le budget estimé au
    pire cas est affiché avant le premier appel.

### Étape 3 — Boucle d'escalade (pages A, B, C uniquement)

16. `spike/run.ts --model <id> --provider <slug>` — pour chaque page × **2 passes** = 6 appels par
    échelon. Les images sont lues **déjà normalisées** depuis `spike/fixtures/pages/` : aucune
    transformation ici, la normalisation a eu lieu une fois pour toutes à l'ingestion.
    - `temperature: 0`, `max_tokens: 8000` — plafond large, uniquement garde-fou de dépense : un
      cap serré transformerait une recette longue en troncature et ferait recaler un modèle
      innocent ;
    - `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` ;
    - `provider: { only: [providerSlug], allow_fallbacks: false, require_parameters: true }` —
      `allow_fallbacks: false` ne bloque que le **repli** après échec, pas la sélection initiale :
      sans `only`, deux passes peuvent partir chez deux hébergeurs et on mesure l'infrastructure ;
    - le provider effectivement servi est relu dans la réponse et comparé à celui demandé ;
    - **erreurs transitoires** (429, 5xx, timeout réseau, « no provider available » ponctuel) :
      timeout de 120 s, 3 tentatives maximum avec backoff exponentiel. Épuisées, la passe est
      marquée **inconclusive** — pas échouée : une panne d'hébergeur n'est pas un défaut de
      modèle ;
    - **échecs réels, jamais rejoués** : refus du modèle, troncature (`finish_reason !== "stop"`),
      réponse invalide contre le Zod. Ceux-là comptent contre le critère « sortie structurée » ;
    - écrit `spike/fixtures/runs/<model>/<provider>/<page>-<pass>.json` : réponse brute, objet
      parsé, usage, coût réel, latence, provider servi, `data_collection` de l'endpoint, versions
      de prompt et de schéma.
17. **Jugement à l'œil**, photo ouverte à côté de la sortie, contre les cinq critères
    (segmentation, titre, ingrédients, étapes, validité structurée). Consigné dans
    `spike/RESULTS.md`, une ligne par échelon × page, avec le **mode d'échec observé** et pas
    seulement un PASS/FAIL.
18. Échelon rejeté si un critère échoue **ou** si les deux passes divergent sur le nombre de
    recettes détectées — un pipeline non reproductible n'est pas exploitable. Un échelon dont une
    passe est *inconclusive* est rejoué plus tard, pas rejeté.
19. Échec → échelon suivant dans `ladder`. **Une seule réécriture de prompt** est autorisée sur
    toute l'escalade ; si elle est utilisée, elle produit `prompt v2` et l'escalade **repart de
    l'échelon le plus bas**, pour que tous les échelons soient jugés au même prompt. Comme
    l'auteur de `prompt v2` a nécessairement lu D à l'étape 1b, la règle de péremption s'applique :
    D est brûlée et remplacée par **D′**, shootée et transcrite après le commit de `prompt v2`.
20. Premier échelon qui passe A, B et C = **candidat**. On s'arrête et on passe à l'étape 4.

### Étape 4 — Acceptation sur la page D et verdict

L'acceptation distingue deux natures d'écart, faute de quoi le critère se mord la queue : exiger
une conformité *exacte* à l'oracle ne laisserait rien à corriger, `T_correction` vaudrait zéro, et
toute sortie réellement corrigeable serait déjà rejetée.

- **Barrières structurelles (`hard gates`)** — non éditables en un geste, elles condamnent
  l'échelon : nombre de recettes ≠ réel, ligne d'ingrédient **inventée**, ligne **fusionnée** ou
  **manquante**, étape manquante ou hors ordre, réponse invalide contre le schéma. Ces défauts
  obligent à relire toute la page contre l'original : la correction redevient une saisie.
- **Écarts éditables** — repérables et réparables sans quitter le texte : coquille, accent, casse,
  reformulation d'un titre, coupure de mot, `type` ou `servings` erronés. Ce sont eux, et eux
  seuls, que le chronomètre mesure. Tous portent sur des champs figurant dans l'ensemble
  d'identité transcrit à l'étape 1b — sans quoi l'état final serait invérifiable. Une unité mal lue
  *à l'intérieur* d'une ligne est une erreur de texte dans `raw`, donc déjà couverte ; le champ
  `unit`, lui, n'est ni transcrit ni chronométré.

21. **Deux passes** du candidat sur D. Les **deux** doivent franchir toutes les barrières
    structurelles. Un tir unique laisserait un coup de chance sélectionner l'endpoint — exactement
    ce que la double passe sur A/B/C sert à écarter. Les écarts éditables n'entrent pas ici.
22. **Arbitrage temps, chiffré** : corriger les écarts éditables de la première passe jusqu'à
    l'identité avec la vérité terrain, chronomètre en marche → `T_correction`. Succès si
    `T_correction < T_saisie`, même page, mêmes champs, **et** état final identique à l'oracle.
    Un ratio, pas une impression.
23. Échec sur la page d'acceptation → le candidat est rejeté et l'escalade reprend à l'échelon
    suivant. **Règle générale : une page d'acceptation fraîche par candidat.** L'évaluateur connaît
    désormais la page, ses pièges et sa vérité terrain ; tout `T_correction` rejoué dessus serait
    artificiellement bas. Le n-ième candidat est donc jugé sur la n-ième page — D, E, F, … —
    shootée, ingérée et transcrite au chronomètre **au moment où ce candidat se présente**, avec un
    protocole identique à chaque fois : mêmes champs d'identité, deux passes, mêmes barrières
    structurelles, même comparaison `T_correction < T_saisie` propre à cette page. Les pages déjà
    brûlées gardent leur valeur sur les barrières structurelles (elles ne dépendent pas de
    l'humain) et rejoignent le corpus de non-régression ; elles ne servent plus au chronomètre.
    Contingence pure, pas de travail anticipé : dans le cas nominal — premier candidat accepté —
    seule D existe. Coût réel de la règle : ~20 min de travail humain par candidat recalé, ce qui
    est aussi un frein sain à l'escalade sans fin.
24. `spike/RESULTS.md` conclut par : `OPENROUTER_MODEL` et `OPENROUTER_PROVIDER` retenus, versions
    de prompt et de schéma, coût et latence moyens par page, dépense totale du spike, `T_saisie`,
    `T_correction` et la liste des écarts éditables rencontrés.
25. Si aucun échelon ne passe jusqu'au sommet de l'échelle, **file « prix incertain » comprise** :
    **verdict négatif écrit noir sur blanc**, T1 clos, et réouverture du design avant tout autre
    travail — piste de repli à instruire : une photo = une recette, découpe manuelle avant envoi.

## Key decisions & tradeoffs

1. **T1 entier en une passe.** Pas de découpage en sous-phases : le spike ne vaut que par son
   verdict, et un demi-spike n'en produit aucun.
2. **Harnais `spike/` standalone, mais schéma Zod déjà canonique** dans `src/lib/recipe-schema.ts`.
   C'est le seul fragment d'application écrit avant le verdict, en tension avec « rien de
   l'application n'est écrit avant ce spike ». Assumé : un schéma jetable ferait diverger ce qui a
   été validé de ce qui sera implémenté, et T2 hérite du fichier au lieu de le réécrire.
3. **Échelle dérivée de l'API OpenRouter, au niveau endpoint** (`{model, provider}`), pas de liste
   en dur. Rejouable dans six mois, sans a priori sur qui sait lire une page de magazine.
   Contrepartie : le classement peut placer en tête des endpoints bon marché inaptes à l'OCR, et on
   brûle des tours. Accepté — c'est le protocole.
4. **Notation à l'œil sur A, B et C ; oracle transcrit sur la page d'acceptation.** Compromis entre
   le choix initial (tout à l'œil, non rejouable) et la rigueur complète (transcrire tout le jeu
   d'essai). Une page transcrite coûte ~20 min et donne à la fois l'oracle d'acceptation, la mesure
   du temps de saisie et la graine de non-régression dont T11 a besoin. Dans le cas nominal il n'y
   en a qu'une (D) ; voir la décision 20 pour les candidats suivants.
5. **Acceptation à deux étages : barrières structurelles puis écarts éditables.** Les premières
   condamnent l'échelon, les seconds sont ce que le chronomètre mesure. Sans cette séparation, le
   critère serait tautologique — exiger l'exactitude parfaite ne laisse rien à chronométrer, et
   toute sortie corrigeable est déjà rejetée. C'est aussi la définition opérationnelle de
   « corriger coûte moins cher que saisir » : un défaut qui force à relire toute la page contre
   l'original *est* une saisie.
6. **Arbitrage temps chiffré**, `T_correction < T_saisie`, mesuré **une seule fois par page
   d'acceptation** et jamais rejoué sur une page déjà vue. Le critère le plus structurant du projet
   ne repose plus sur une impression.
7. **Ordre contraignant : prompt figé avant ouverture de D**, et **règle de péremption** si le
   prompt est réécrit (D brûlée, remplacée par D′ transcrite après le commit de `prompt v2`). Le
   commit fait office d'horodatage. Sans cet ordre, l'auteur du prompt aurait lu la page
   d'acceptation avant de l'écrire, et l'indépendance du test serait fictive.
8. **Normalisation d'image en un seul point, à l'ingestion.** Les originaux ne franchissent jamais
   la frontière du dépôt ; seules les sorties `sharp` nettoyées y entrent, avec vérification
   automatique de l'absence de métadonnées. `run.ts` ne transforme plus rien — une seule
   implémentation, donc une seule chose à vérifier.
9. **Schéma = forme de production complète moins les champs dérivés.** `type` et `servings` sont
   inclus parce que le spike est le seul endroit où ils sont confrontés à une vraie page ; ils sont
   **observés, non bloquants**. Temps de préparation et de cuisson exclus : hors périmètre produit,
   définitivement (`PRODUCT.md:103`).
10. **`raw` obligatoire et seul noté ; `quantity`, `unit`, `label` demandés mais non notés.** T6
   s'informe gratuitement sans pouvoir faire échouer T1.
11. **Champs non garantis en `.nullable()`, pas `.optional()`**, plus une normalisation
    `null → undefined` vers le domaine. Le mode strict impose toutes les clés en `required` ; sans
    ce choix le schéma Zod refuserait la sortie qu'il a lui-même demandée.
12. **Prompt v1 figé, une seule réécriture pour toute l'escalade, qui repart du bas.**
13. **2 passes par photo partout**, y compris à l'acceptation. `temperature: 0`, `provider.only`
    figé, provider servi vérifié. Sans `only`, la sélection initiale reste dynamique et la mesure
    porte sur l'hébergeur.
14. **Retries bornés sur les seules erreurs transitoires**, passe marquée *inconclusive* plutôt
    qu'échouée. Un 429 ne doit pas éliminer un échelon.
15. **`max_tokens: 8000`, pas 2500.** Un plafond serré fabriquerait des troncatures et ferait
    recaler un modèle pour une faute qui serait la nôtre. Le contrôle de dépense passe par le
    compteur cumulatif, pas par l'étranglement de la sortie.
16. **Classement sur une sortie représentative (2500 tokens), budget sur le pire cas (8000).** Deux
    chiffres, deux usages : trier sur le plafond classerait des pires cas et pourrait inverser
    l'ordre entre deux endpoints. Le plafond de 5 € est appliqué en **pré-vérification** —
    `dépense_cumulée + coût_maximal_du_prochain_appel > plafond` refuse l'appel — sans quoi un
    dernier appel franchirait toujours la limite.
17. **Pas de contrainte ZDR sur l'échelle.** L'imposer amputerait le bas de l'échelle et
    contredirait le protocole ; et le contenu est de toute façon publié en clair sur un dépôt
    GitHub public par décision explicite — la rétention côté provider est une exposition
    strictement inférieure. `data_collection` est **relevé et journalisé** par endpoint, pas
    filtré.
18. **Dépôt public, fixtures commitées telles quelles.** Décision explicite de l'utilisateur après
    que le point a été soulevé ; le risque de diffusion de contenu protégé est acté et accepté.
    Ce qui n'est *pas* couvert par cette acceptation — métadonnées GPS des originaux — est traité
    séparément par la décision 8.

19. **La file « prix incertain » est résorbée avant l'escalade, pas après.** Un endpoint sans prix
    lisible peut être le moins cher de tous ; le sonder seulement au moment d'un verdict négatif le
    rendrait invisible dès qu'un endpoint connu passe, en contradiction directe avec « le moins
    cher qui passe ». Trois sondes au maximum, chacune adossée à une **réserve forfaitaire de
    0,25 €** — la seule façon d'appliquer un plafond dur à un appel dont on ignore le prix. Un
    dépassement exclut l'endpoint, une sonde impossible le marque **non évalué** dans `RESULTS.md` :
    le verdict énonce ce qu'il a réellement couvert.
20. **Une page d'acceptation fraîche par candidat.** D, E, F… Le chronomètre n'est jamais rejoué sur
    une page déjà vue. Coût : ~20 min de travail humain par candidat recalé — accessoirement un
    frein sain à l'escalade sans fin. Les pages brûlées restent opposables sur les barrières
    structurelles et rejoignent le corpus de non-régression.

## Risks / open questions

- **Non-régression encore partielle.** Seule la page D dispose d'un oracle. Un changement de
  modèle après T11 sera testable sur D, pas sur A/B/C, dont les fixtures restent des sorties sans
  vérité de référence. Mitigation retenue : `RESULTS.md` consigne le mode d'échec observé, pas un
  booléen.
- **La frontière « barrière structurelle / écart éditable » est un jugement.** La liste des deux
  catégories est fixée avant l'acceptation, mais un cas limite se présentera (un titre reformulé
  est-il une coquille ou une invention ?). Règle de tranchage retenue : dans le doute, c'est une
  barrière — se tromper dans ce sens coûte un échelon, se tromper dans l'autre valide un modèle qui
  ne tient pas.
- **Un seul évaluateur humain.** Le gel du prompt avant ouverture de D réduit la contamination mais
  ne l'élimine pas : la même personne écrit le prompt, juge A/B/C et chronomètre D. Un second
  relecteur serait la vraie parade ; disproportionné ici, et acté comme tel.
- **`supported_parameters` reste déclaratif.** Même filtré au niveau endpoint, un provider peut
  annoncer `structured_outputs` et échouer en pratique. Un tel échec est un vrai échec d'échelon —
  la distinction avec l'indisponibilité tient au code d'erreur, et cette frontière sera à
  reconnaître à la main au premier cas rencontré.
- **Le prix des tokens image reste approximatif.** `pricing.image` ne couvre pas toujours le
  découpage en tuiles pratiqué par certains modèles. Le classement est une approximation ; seul le
  compteur de dépense réelle protège vraiment, et c'est lui qui porte le plafond.
- **La page B conditionne tout le projet.** Une feuille de collage trop facile (recettes bien
  séparées, fond uni) validerait une hypothèse plus faible que celle du produit.
- **Le nombre réel de recettes de A, B et C est noté à la main.** Une erreur de saisie y rend le
  critère de segmentation faux sans que rien ne le signale.
- **Contenu protégé en clair sur un dépôt public** — acté comme accepté. Le même arbitrage se
  reposera à l'identique, et en pire, sur T9 (export git des recettes publiées).

## Out of scope

- **T13** (spike d'embellissement d'image) — hypothèse distincte, tourne en parallèle, hors de ce
  plan.
- **Convex, TanStack Start, toute UI** — rien n'est scaffoldé avant le verdict.
- `searchText`, `slug`, `imageId`, provenance — hors du schéma d'extraction, par construction.
- **Multi-images par scan** (T8) — le spike envoie une image par appel.
- **Auth, rate limit, idempotence** (T3, T4) — le harnais est mono-utilisateur, séquentiel et
  jetable. Les seuls retries prévus couvrent les erreurs réseau transitoires du spike lui-même.
- **Sélection de modèle dynamique à l'exécution** — exclue par le design : l'escalade se joue au
  spike, pas au runtime.
