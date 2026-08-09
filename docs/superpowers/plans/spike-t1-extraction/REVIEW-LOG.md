# Plan Review Log — Spike T1 : extraction vision multi-recettes

Scope : **T1 uniquement**. Plan associé : [`PLAN.md`](./PLAN.md).
Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.
Reviewer : `gpt-5.6-sol` (config Codex, effort medium) — codex-cli 0.144.5.
Thread Codex : `019fe365-2c37-7bf0-8010-59adb07e4eda`.

> Note d'organisation : ces fichiers vivaient d'abord à la racine (`PLAN.md`,
> `PLAN-REVIEW-LOG.md`) et sont entrés en collision avec un autre agent travaillant sur le scope
> « socle et vitrine ». Déplacés ici, sous un dossier par scope.

## Act 1 — décisions arrachées au grill

1. Périmètre = T1 entier, pas de découpage en sous-phases.
2. Jeu d'essai inexistant → étape de collecte des photos incluse et bloquante.
3. Harnais `spike/` standalone, mais schéma Zod déjà canonique dans `src/lib/recipe-schema.ts`.
4. Échelle de modèles dérivée de l'API OpenRouter, pas de liste en dur.
5. Notation à l'œil (contre ma recommandation de vérité terrain + scoring auto) — conséquence sur
   la non-régression T11 consignée en risque.
6. Arbitrage temps jugé à l'œil, sans chronomètre.
7. Champs confort : tranché par les docs — `type` et `servings` inclus mais non bloquants ; temps
   de préparation/cuisson hors périmètre produit définitivement (`PRODUCT.md:103`).
8. Prompt v1 figé, une seule réécriture autorisée, qui repart de l'échelon le plus bas.
9. Plafond = haut de l'échelle ; échec au sommet = verdict négatif et replanification.
10. 2 passes/photo, `temperature: 0`, provider figé et journalisé.
11. Dépôt public + fixtures de contenu protégé : soulevé par Claude, arbitré par l'utilisateur —
    on laisse public, risque accepté.

---

## Round 1 — Codex

Le plan contient encore des problèmes matériels.

1. **Provider non figé.** `allow_fallbacks: false` n'empêche pas OpenRouter de choisir
   initialement différents providers ; sans `order` ou `only`, le routage reste dynamique, donc les
   deux passes ne mesurent pas nécessairement le même endpoint.
   Fix — Construire l'échelle en couples `{model, providerEndpoint}` et envoyer
   `provider.only: [providerSlug]` avec `allow_fallbacks: false`.

2. **Conflit Zod/JSON Schema sur les champs optionnels.** Transformer `servings?`, `quantity?`,
   etc. en propriétés obligatoires nullable produit des `null` que le schéma Zod optionnel
   d'origine refusera.
   Fix — Déclarer ces champs `.nullable()` dans le schéma d'extraction Zod, puis convertir
   explicitement `null` en absence dans la couche domaine.

3. **Le pipeline d'image est impossible avec les dépendances prévues.** Node, `tsx`, Zod et dotenv
   ne décodent, réorientent, redimensionnent ou recompressent pas un JPEG.
   Fix — Ajouter `sharp` et spécifier `autoRotate()`, suppression EXIF, redimensionnement sans
   agrandissement, espace colorimétrique et JPEG q80.

4. **Le classement de coût est faux.** La formule ignore `pricing.image`, `pricing.request` et les
   différences par endpoint ; elle suppose aussi 2500 tokens de sortie sans imposer `max_tokens`.
   Fix — Classer les endpoints avec tous les postes tarifaires, fixer `max_tokens: 2500`, isoler
   les prix inconnus et calculer un plafond de dépense avant l'escalade.

5. **Le filtre de capacité ne correspond pas à la requête.** L'échelle exige seulement vision et
   `structured_outputs`, mais chaque appel impose aussi `temperature` ; avec
   `require_parameters: true`, un modèle autrement valide peut devenir artificiellement
   indisponible.
   Fix — Filtrer tous les paramètres effectivement envoyés ou supprimer ceux qui ne sont pas
   indispensables.

6. **Le benchmark est contaminé par le réglage du prompt.** `prompt v2` est conçu après
   observation des trois seules pages puis évalué sur ces mêmes pages ; repartir du bas ne restaure
   pas l'indépendance du test.
   Fix — Séparer des pages de calibration du prompt et au moins deux pages d'acceptation tenues
   hors vue jusqu'au verdict.

7. **Les « fixtures de test » n'ont pas d'oracle.** Seul le nombre de recettes est transcrit ;
   conserver les sorties du modèle comme fixtures ne permet pas de détecter ultérieurement une
   omission, fusion ou hallucination.
   Fix — Transcrire une vérité terrain minimale par recette — titre, lignes d'ingrédients et
   étapes — pour les pages d'acceptation.

8. **Le critère produit principal n'est pas mesuré.** « Manifestement plus rapide » à l'œil ne
   permet ni seuil, ni comparaison entre modèles, ni reproduction du verdict.
   Fix — Chronométrer sur une page tenue à part la correction de l'extraction puis la saisie
   manuelle, avec les mêmes champs et une règle de succès chiffrée.

9. **Les erreurs d'infrastructure peuvent fausser la qualité du modèle.** Les retries sont exclus
   alors que 429, timeout et panne provider doivent rendre une passe inconclusive, pas éliminer un
   échelon.
   Fix — Ajouter timeout et 2–3 retries bornés avec backoff pour les seules erreurs transitoires,
   sans retry des refus ou sorties invalides.

10. **La confidentialité des scans n'est pas traitée.** Le provider le moins cher peut conserver ou
    exploiter les images, et les JPEG committés peuvent exposer des métadonnées EXIF ;
    l'acceptation du risque copyright ne couvre pas ces risques.
    Fix — Nettoyer les métadonnées avant stockage et imposer `provider.zdr: true` plus
    `data_collection: "deny"` dans le filtre et chaque requête.

VERDICT: REVISE

### Claude's response — round 1

**Accepté et intégré**

- **#1 provider non figé** — juste et important. `allow_fallbacks:false` ne bloque que le repli
  après échec, pas la sélection initiale. L'échelle passe au niveau **endpoint**
  `{model, provider}` et chaque appel envoie `provider.only: [slug]`, avec vérification du provider
  effectivement servi dans la réponse.
- **#2 conflit null/optional** — réel. Les champs non garantis passent en `.nullable()` côté Zod
  (plus `.optional()`), avec normalisation `null → undefined` vers le domaine. Sans ça le schéma
  refusait la sortie qu'il avait lui-même demandée.
- **#3 pipeline image impossible** — exact, `sharp` manquait. Ajouté, avec `.rotate()` : une page
  shootée en paysage serait arrivée couchée au modèle et aurait fait recaler des échelons pour une
  faute de harnais.
- **#4 classement de coût (partiel)** — `pricing.image` et `pricing.request` ajoutés, prix inconnu
  marqué `incertain` au lieu d'être compté zéro, plafond de dépense calculé avant l'escalade.
- **#5 filtre de capacité** — le filtre porte désormais sur tous les paramètres réellement envoyés.
- **#9 erreurs transitoires** — timeout 120 s + 3 tentatives avec backoff sur 429/5xx/réseau, passe
  marquée *inconclusive* et non *échouée*. Refus, troncatures et sorties invalides restent des
  échecs jamais rejoués.
- **#10 EXIF (partiel)** — métadonnées supprimées avant envoi et avant stockage : les photos de
  téléphone portent le GPS du domicile et le dépôt est public.

**Accepté sous forme réduite**

- **#6, #7, #8** — Codex retrouve indépendamment la recommandation que le grill avait écartée
  (vérité terrain + chrono). Le protocole complet (pages de calibration + ≥2 pages d'acceptation,
  transcription de tout le jeu d'essai) est disproportionné pour un spike d'une demi-journée sur un
  projet mono-utilisateur. Forme retenue : **une seule 4ᵉ page D**, tenue hors de vue, dont la
  vérité terrain est transcrite au chronomètre. Elle règle les trois points d'un coup — oracle
  d'acceptation, `T_saisie` pour l'arbitrage chiffré, graine de non-régression pour T11 — pour
  ~20 min de travail humain. Coût assumé : A, B et C restent jugés à l'œil et sans oracle.
  **À valider par l'utilisateur au sign-off** : cela revient partiellement sur ses réponses 5 et 6
  du grill.

**Rejeté**

- **#4, volet `max_tokens: 2500`** — un plafond serré fabriquerait des troncatures sur une page
  multi-recettes et ferait recaler un modèle pour une faute qui serait la nôtre, alors que la
  troncature est précisément un critère d'échec. Retenu : `max_tokens: 8000`, garde-fou de dépense
  seulement.
- **#10, volet `provider.zdr: true` + `data_collection: "deny"`** — l'imposer comme filtre ampute
  le bas de l'échelle et contredit le protocole « le moins cher qui passe ». Surtout, le contenu
  est publié en clair sur un dépôt GitHub public par décision explicite de l'utilisateur : la
  rétention côté provider est une exposition strictement inférieure à celle déjà acceptée.
  `data_collection` est relevé et journalisé par endpoint, pas utilisé comme filtre.

---

## Round 2 — Codex

La révision corrige l’essentiel des dix remarques précédentes : provider pinning, schéma nullable, `sharp`, coût détaillé, filtres de capacité, oracle, chronométrage, retries et EXIF. Quatre problèmes matériels restent.

1. **Le budget est sous-estimé.** Le calcul suppose 2500 tokens, 6 appels par échelon et aucune relance, alors que l’exécution autorise 8000 tokens, jusqu’à trois tentatives et des appels supplémentaires sur D ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:75), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:80), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:91)).  
Fix — Calculer le pire cas avec 8000 tokens, retries et acceptations D, puis imposer un plafond cumulatif vérifié avant chaque appel.

2. **D n’est pas réellement tenue hors de vue.** Elle est photographiée et transcrite avant la création ou le gel du prompt ; son contenu peut donc influencer `prompt v1` ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:22), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:32)).  
Fix — Faire préparer D par une autre personne, ou geler définitivement le prompt avant que son évaluateur ouvre et transcrive D.

3. **L’acceptation repose sur un tir unique.** Un résultat chanceux sur D peut sélectionner un endpoint que les deux passes sur A/B/C avaient justement pour objectif de tester en reproductibilité ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:121)).  
Fix — Exécuter deux passes indépendantes sur D et exiger que les deux respectent l’oracle et le seuil de correction.

4. **La réutilisation de D biaise le chronométrage.** Après le premier candidat, l’évaluateur connaît déjà la page, la vérité terrain et les erreurs typiques ; les candidats suivants obtiennent artificiellement un meilleur `T_correction` ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:128), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:131)).  
Fix — Prévoir une page d’acceptation fraîche par candidat ou mesurer le temps avec des évaluateurs indépendants n’ayant jamais vu D.

5. **La suppression EXIF n’est garantie que pour la copie envoyée.** Les originaux sont rangés dans les fixtures avant le passage par `sharp`, malgré l’affirmation qu’ils seront nettoyés avant stockage ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:29), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:87)).  
Fix — Ingérer les photos hors dépôt, écrire uniquement les sorties Sharp nettoyées dans `spike/fixtures/pages`, puis vérifier automatiquement l’absence de métadonnées.

VERDICT: REVISE
### Claude's response — round 2

Les cinq points sont fondés et tous intégrés. Deux méritaient de l'être sans discussion.

- **#5 métadonnées EXIF** — c'était une **contradiction interne** du plan : l'étape 0 rangeait les
  originaux dans `spike/fixtures/pages/` (donc dans un dépôt public) tandis que l'étape 3 promettait
  un nettoyage « avant stockage » qui n'existait que pour la copie envoyée au modèle. Corrigé à la
  racine : les originaux vivent hors dépôt (`~/table-des-recettes-inbox/`), un script `ingest.ts`
  écrit dans les fixtures **uniquement** les sorties `sharp` nettoyées, puis relit le fichier écrit
  et échoue s'il reste des métadonnées. Effet de bord bienvenu : `run.ts` ne transforme plus
  d'image, la normalisation n'a plus qu'une seule implémentation.
- **#2 page D pas réellement hors de vue** — vraie faille de protocole, pas un détail : je faisais
  transcrire D à l'étape 0, donc l'auteur du prompt l'avait lue avant de l'écrire. L'ordre devient
  contraignant — A/B/C ingérées, prompt v1 écrit **et commité** (le commit fait office
  d'horodatage), *puis seulement* D est désélée et transcrite (nouvelle étape 1b). La parade
  complète (préparation de D par un tiers) reste hors de portée d'un projet mono-utilisateur ; le
  résidu est consigné en risque assumé.
- **#1 budget sous-estimé** — le calcul mélangeait 2500 tokens d'estimation et 8000 d'exécution, et
  ignorait retries et passes d'acceptation. L'estimation passe au pire cas (8000 tokens × 3
  tentatives × appels d'escalade **et** d'acceptation), et surtout un **compteur cumulatif de
  dépense réelle** est vérifié avant chaque appel contre un plafond dur de 5 €. Une estimation
  a priori ne protège de rien ; un compteur, si.
- **#3 acceptation sur un tir unique** — incohérent avec la double passe exigée sur A/B/C. Deux
  passes sur D, les deux doivent satisfaire l'oracle.
- **#4 réutilisation de D biaise le chrono** — accepté sous forme de contingence plutôt que de
  travail anticipé. L'oracle de D reste valide pour un second candidat (il ne dépend pas de
  l'humain), mais le **chronomètre n'est pas rejoué** : si un second candidat atteint
  l'acceptation, une page fraîche E est shootée et transcrite à ce moment-là. Dans le cas nominal —
  premier candidat accepté — elle n'existe jamais.

---

## Round 3 — Codex

Les findings round 2 sur le budget, les deux passes, l’EXIF et la fraîcheur des pages suivantes sont largement traités. Quatre problèmes matériels restent.

1. **D contamine encore `prompt v2`.** D est ouverte et transcrite à l’étape 1b, puis une réécriture du prompt reste autorisée pendant l’escalade ; l’affirmation selon laquelle D reste hors de vue pendant tout le réglage est donc fausse ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:72), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:131)).  
Fix — Ne desceller et transcrire D qu’après le gel définitif de la dernière version du prompt, ou confier D à un évaluateur distinct.

2. **L’arbitrage temporel est devenu tautologique.** Les deux sorties de D doivent satisfaire exactement l’oracle ; elles ne nécessitent alors aucune correction et `T_correction` vaut pratiquement zéro, tandis qu’une sortie nécessitant une correction est déjà rejetée ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:140), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:144)).  
Fix — Séparer les hard gates structurels des erreurs éditables, puis chronométrer la correction de ces erreurs avec un seuil d’exactitude final explicite.

3. **Le classement ne mesure plus le modèle “le moins cher”.** Utiliser systématiquement 8000 tokens pour trier les endpoints classe leur pire cas, pas le coût attendu d’une extraction réelle, et peut changer l’ordre selon le ratio prompt/completion ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:91)).  
Fix — Utiliser une sortie représentative, par exemple 2500 tokens, pour le classement et réserver 8000 tokens au calcul de budget maximal.

4. **Le plafond de 5 € n’est pas réellement dur.** Vérifier uniquement la dépense déjà consommée avant l’appel autorise un dernier appel à faire dépasser le plafond ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:96)).  
Fix — Refuser l’appel lorsque `dépense_cumulée + coût_maximal_estimé_du_prochain_appel > plafond`.

5. **Le sommet de l’échelle reste indéfini pour les prix inconnus.** Les endpoints `prix incertain` sont “rangés à part”, sans dire s’ils sont testés, dans quel ordre, ou s’ils doivent passer avant un verdict négatif ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:91)).  
Fix — Définir explicitement leur exclusion justifiée ou une queue manuelle bornée à parcourir avant de conclure négativement.

VERDICT: REVISE
### Claude's response — round 3

Cinq points, tous fondés, tous intégrés. Aucun rejet ce tour-ci.

- **#2 arbitrage temporel tautologique** — la meilleure trouvaille des trois rounds. Exiger que les
  deux passes sur D satisfassent *exactement* l'oracle ne laissait rien à corriger (`T_correction`
  ≈ 0) tandis que toute sortie réellement corrigeable était déjà rejetée : le critère se mordait la
  queue. L'acceptation passe à **deux étages** — *barrières structurelles* (recette manquante,
  ligne inventée, fusionnée ou manquante, étape hors ordre, schéma invalide) qui condamnent
  l'échelon, et *écarts éditables* (coquille, accent, casse, unité mal lue, `type`/`servings`
  faux) qui sont seuls chronométrés. Bénéfice inattendu : cette frontière est la définition
  opérationnelle du critère produit — un défaut qui force à relire toute la page contre l'original
  **est** une saisie, pas une correction.
- **#1 D contamine encore `prompt v2`** — ma propre affirmation « D reste hors de vue pendant tout
  le réglage » était fausse dès lors que D est ouverte à l'étape 1b. Ajout d'une **règle de
  péremption** : si la réécriture de prompt est déclenchée, D est brûlée et remplacée par D′,
  shootée et transcrite après le commit de `prompt v2`.
- **#3 classement au pire cas** — j'avais sur-corrigé au round 2 en passant le tri à 8000 tokens.
  Deux chiffres pour deux usages : **2500 tokens** (sortie représentative) pour trier l'échelle,
  **8000** pour le budget.
- **#4 plafond pas réellement dur** — exact, off-by-one. La vérification devient
  `dépense_cumulée + coût_maximal_du_prochain_appel > plafond`, sinon un dernier appel franchit
  toujours la limite.
- **#5 file « prix incertain » indéfinie** — vrai trou : « rangé à part » ne disait ni si on les
  testait, ni dans quel ordre. Règle explicite : exclus de l'échelle principale, mais **trois au
  maximum sont sondés avant qu'un verdict négatif soit prononçable**. Sans ça, « aucun échelon ne
  passe » voudrait dire « aucun échelon dont je savais lire le prix » — pas le même verdict.

---

## Round 4 — Codex

Les cinq findings du round 3 sont corrigés. Trois nouveaux problèmes matériels apparaissent.

1. **L’oracle ne couvre pas les champs chronométrés.** `d-acceptation.json` ne transcrit que titre, lignes d’ingrédients et étapes, mais les écarts éditables incluent `unit`, `type` et `servings`; l’identité finale avec l’oracle est donc impossible à vérifier pour ces champs ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:74), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:167)).  
Fix — Inclure tous les champs éditables dans l’oracle, ou retirer `unit`, `type` et `servings` du scoring et du chronométrage.

2. **La file “prix incertain” viole le protocole du moins cher.** Elle n’est sondée qu’avant un verdict négatif ; si un endpoint connu passe, un endpoint incertain potentiellement moins cher n’est jamais évalué ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:102), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:107)).  
Fix — Sonder les trois endpoints incertains avant l’escalade, récupérer leur coût réel, puis les insérer à leur place dans l’échelle principale.

3. **Le plafond dur est incompatible avec un prix inconnu.** Le coût maximal du prochain appel ne peut pas être pré-vérifié pour l’appel-sonde d’un endpoint précisément classé “prix incertain”; ce probe peut franchir les 5 € avant que son coût réel soit retourné ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:109), [PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:116)).  
Fix — Exclure tout endpoint sans borne tarifaire vérifiable, ou obtenir une borne externe avant le probe et appliquer la même pré-vérification.

4. **La contingence ne couvre que le second candidat.** Une page E est prévue après l’échec du premier candidat, mais aucun protocole ne définit une page F puis les suivantes si plusieurs candidats échouent successivement ([PLAN.md](/Users/florianlauer/Documents/perso/table-des-recettes/docs/superpowers/plans/spike-t1-extraction/PLAN.md:178)).  
Fix — Généraliser la règle en “une page d’acceptation fraîche par candidat” avec nommage, oracle, deux passes et chronométrage identiques.

VERDICT: REVISE
### Claude's response — round 4

Quatre points, tous fondés, tous intégrés. Aucun rejet.

- **#1 l'oracle ne couvre pas les champs chronométrés** — incohérence que j'avais moi-même
  introduite au round 3 : je listais `unit`, `type` et `servings` parmi les écarts éditables alors
  que l'oracle ne transcrivait que titre, ingrédients et étapes. L'état final était donc
  invérifiable sur ces champs. Correction : l'oracle transcrit **exactement l'ensemble d'identité**
  — `title`, `type`, `servings`, `ingredients[].raw`, `steps` — et c'est le même ensemble qui sert
  d'oracle et de cible du chronomètre. `unit` sort de la liste éditable : une unité mal lue vit
  dans le texte de `raw` (déjà couvert), et le champ `unit` lui-même reste observé-non-noté
  conformément à la décision sur T6.
- **#2 la file « prix incertain » viole le protocole du moins cher** — juste, et c'est une faute de
  raisonnement de ma part au round 3 : sonder ces endpoints *avant un verdict négatif* les rend
  invisibles dès qu'un endpoint connu passe, alors qu'un prix inconnu peut être le plus bas de
  l'échelle. Ils sont désormais **sondés avant l'escalade** et insérés à leur vraie place dans
  l'échelle unique.
- **#3 plafond dur incompatible avec un prix inconnu** — vraie impasse logique : on ne peut pas
  pré-vérifier le coût maximal d'un appel dont le prix est précisément inconnu. Politique de perte
  bornée retenue : `max_tokens: 512` sur la sonde, **réserve forfaitaire de 0,25 €** retenue contre
  le plafond avant chaque sonde, exclusion de l'endpoint si le coût réel dépasse la réserve. On
  préfère perdre un candidat qu'une garantie de budget. Une sonde impossible marque l'endpoint
  **non évalué** dans `RESULTS.md` — le verdict énonce ce qu'il a réellement couvert.
- **#4 la contingence ne couvre que le second candidat** — exact, la règle était écrite pour un
  cas particulier. Généralisée : **une page d'acceptation fraîche par candidat** (D, E, F…), même
  protocole à chaque fois. Effet de bord bienvenu : ~20 min de travail humain par candidat recalé
  est un frein sain à l'escalade sans fin. Les pages brûlées restent opposables sur les barrières
  structurelles et rejoignent le corpus de non-régression.

---

## Round 5 — Codex

Les quatre findings du round 4 sont traités :

- L’oracle et le chronométrage portent désormais sur le même ensemble de champs.
- Les endpoints au prix incertain sont sondés avant l’escalade puis insérés dans l’échelle.
- Leur exposition financière est bornée et les candidats non évalués sont explicitement consignés.
- Une page fraîche est prévue pour chaque candidat successif selon un protocole généralisé.

Le protocole distingue correctement les hard gates des erreurs éditables, protège l’indépendance du jeu d’acceptation après `prompt v2`, fixe le provider, borne les retries et empêche un verdict négatif avant d’avoir atteint le périmètre déclaré. Les limites restantes sont documentées et ne rendent pas le spike inexécutable ni son verdict trompeur.

VERDICT: APPROVED
---

## Résolution

**APPROVED au round 5 sur 5.** Bilan des deux actes :

- **Act 1 (grill)** a fixé le périmètre (T1 entier), l'emplacement du harnais, la dérivation de
  l'échelle depuis l'API plutôt qu'une liste en dur, et a fait remonter deux points que le
  document de tâches ne posait pas : l'inexistence du jeu d'essai, et le fait que le dépôt est
  public.
- **Act 2 (Codex, 5 rounds, 19 findings)** a corrigé trois défauts qui auraient invalidé le verdict
  du spike : le provider non réellement figé (on aurait mesuré l'infrastructure), l'arbitrage
  temporel tautologique (`T_correction ≈ 0` par construction), et la file « prix incertain »
  sondée trop tard (« aucun échelon ne passe » aurait voulu dire « aucun dont je savais lire le
  prix »). Plus deux contradictions internes du plan : EXIF nettoyé seulement pour la copie
  envoyée, et oracle ne couvrant pas les champs chronométrés.
- **Deux rejets argumentés** maintenus contre Codex : `max_tokens: 2500` (fabriquerait les
  troncatures qui servent de critère d'échec) et le filtre ZDR obligatoire (ampute le bas de
  l'échelle, et le contenu est déjà publié en clair par décision de l'utilisateur).

**Reste à valider par l'utilisateur** : les rounds 1 et 3 ont partiellement inversé deux réponses
du grill — « notation à l'œil » et « arbitrage sans chronomètre ». Le plan retenu garde le jugement
à l'œil sur A/B/C mais introduit une page d'acceptation transcrite et chronométrée. Coût : ~20 min
de travail humain par candidat. C'est le seul écart assumé entre le plan et les décisions du grill.

---

## Act 3 — Build

Builder : Codex `gpt-5.6-sol` (effort medium), thread `019fe5e3-067c-7393-9a41-5cbab759af47`.
Worktree `worktree-spike-t1-extraction`. Spec gelée par le commit `f459f46`.
Preuve : `npm run verify` (`tsc --noEmit` + vitest, réseau mocké). `MAX_FIX_ROUNDS=2`.

### Round 0 — build initial

Codex a produit le harnais complet : 18 fichiers, ~1 700 lignes de TypeScript, 18 tests verts.
Schéma Zod canonique, dérivation JSON Schema stricte, prompt v1 français, `ingest.ts` (rotation
EXIF + suppression des métadonnées + vérification par relecture), `budget.ts` (compteur persistant
et pré-vérification), `rank-endpoints.ts` (échelle par endpoint, résorption de la file « prix
incertain » par sondes bornées), `run.ts` (escalade A/B/C), `accept.ts` (barrières / éditables),
templates humains. Aucune photo ni vérité terrain fabriquée, aucun appel réseau réel.

### Claude's verdict — round 0

Diff lu intégralement, `npm run verify` rejoué moi-même. Cinq problèmes.

**Deux à conséquence de verdict** — les plus graves, parce qu'ils fabriquent un faux négatif :
1. Un provider servi différent du provider demandé, et un `usage.cost` absent, étaient classés
   `failure`, donc **imputés au modèle**. Le plan est explicite : seuls refus, troncature et
   réponse invalide comptent contre l'échelon. Un caprice de routage aurait recalé un modèle qui
   lit parfaitement la page.
2. La comparaison de provider était une égalité de chaînes brutes : `provider.only` prend un slug
   (`"deepinfra"`) quand la réponse renvoie un nom d'affichage (`"DeepInfra"`). En l'état,
   potentiellement **tous** les appels réels tombaient en `provider_mismatch`.

**Une infidélité au modèle de données** :
3. `servings` et `quantity` typés `string`, alors que la spec design impose `number?` pour les
   deux. Ce fichier est celui dont T2 hérite et sur lequel T6 fait de l'arithmétique de portions.

**Deux points de rigueur** :
4. `accept.ts` n'émettait aucun verdict, alors que la spec exige que **les deux** passes franchissent
   toutes les barrières.
5. Un seuil de similarité unique (0,6) tranchait en silence la frontière barrière / éditable que le
   plan désigne comme un jugement humain, avec la règle « dans le doute, c'est une barrière ».

### Round 1 — Codex fix

Les cinq corrections appliquées et vérifiées ligne à ligne. 24 tests verts. `HarnessError` ajoutée
pour les conditions de harnais, providers normalisés avant comparaison, types numériques propagés
jusqu'à l'oracle, verdict `ACCEPTÉ`/`REJETÉ` avec code de sortie, bande d'incertitude 0,60–0,85
comptée comme barrière et remontée séparément pour arbitrage humain.

### Claude's verdict — round 1

Corrections bonnes. Mais une **décision supplémentaire prise seul par Codex** — « les erreurs HTTP
non transitoires lèvent également `HarnessError` » — sur-appliquait la consigne et retournait la
règle du plan : *« un provider peut annoncer `structured_outputs` et échouer en pratique. Un tel
échec est un vrai échec d'échelon. »* Comme l'échelle est triée par prix, le premier endpoint bon
marché refusant le mode strict aurait avorté le spike au lieu de le faire monter d'un cran — soit
exactement le résultat que tout le protocole existe pour éviter.

### Round 2 — Codex fix

Erreurs non transitoires scindées en deux : `unsupported_request` (400/404/422 dont le message
nomme une capacité **et** la refuse → échec d'échelon, jamais rejoué, l'escalade continue) contre
`HarnessError` (401/403/402 et tout cas non attribuable avec certitude → arrêt). Le classifieur
exige les deux signaux à la fois, donc l'inclassable avorte par défaut — le bon défaut : une
mauvaise attribution corromprait le verdict. 28 tests verts.

### Claude's verdict — round 2

Vérifié : classifieur conservateur conforme, `npm run verify` rejoué par moi, 28 tests, 6 fichiers.
Aucun problème matériel restant. Build accepté, en attente du gate humain sur le diff.

### Post-build — deux bugs révélés par le catalogue réel

Question de l'utilisateur : « quelle est la liste des modèles qu'on va tester ? ». Elle n'existait
pas — par construction, l'échelle se dérive de l'API. En la calculant pour de vrai sur le catalogue
public OpenRouter (2026-08-09, sans clé), **125 modèles** passent le filtre vision + sortie
structurée stricte, de `google/gemma-4-26b-a4b-it:free` (0 USD) à `anthropic/claude-opus-4.1:batch`
(0,105 USD/page) — une amplitude de ×350. L'exercice a fait tomber deux bugs qu'aucun test hors
réseau ne pouvait attraper.

1. **L'échelle serait née avec 3 barreaux au lieu de 123.** `pricing.request` est absent des 125
   modèles et `pricing.image` de 100 : OpenRouter omet la clé au lieu d'écrire `"0"`. `parsePricing`
   renvoyait `null` dès qu'un des quatre postes manquait, donc **tout** le catalogue tombait dans la
   file « prix incertain », plafonnée à trois sondes. La règle « un poste absent n'est pas zéro »
   reste juste pour un prix vraiment inconnu ; ici l'absence de `request` *signifie* zéro et celle
   de `image` signifie « facturée en tokens de prompt ». Le garde-fou ne porte plus que sur `prompt`
   et `completion`.
2. **`provider.only` recevait une valeur non routable.** `providerSlug()` prenait `provider_name`
   (`"Google"`, un nom d'affichage) alors que le slug de routage vit dans `tag`
   (`"google-vertex/global"` → `google-vertex`). Pire, la réponse renvoie le nom d'affichage : la
   vérification du provider servi comparait donc deux registres différents et aurait levé une
   `HarnessError` sur chaque appel. L'échelle porte désormais les deux identifiants — `providerSlug`
   pour router, `providerName` pour vérifier.

Fixtures de test réécrites sur les formes réelles du catalogue plutôt que sur des formes
supposées — c'est précisément l'écart entre les deux qui avait laissé passer les bugs. 31 tests.

Décision produit prise au passage : **pas de traduction dans le prompt d'extraction**. Traduire est
une reformulation, ce que les critères de succès interdisent ; la vérité terrain de la page
d'acceptation étant transcrite depuis la page, une sortie traduite échouerait l'identité sur tous
les champs et rendrait l'arbitrage temps immesurable. Le prompt v1 reste gelé.
