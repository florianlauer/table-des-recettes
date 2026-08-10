# Résultats — Spike T1

## Protocole

- Prompt : `v2` (une seule réécriture, celle que le plan autorisait — voir amendement 3)
- Schéma : `1`
- Devise du harnais : USD
- Échelle figée : `spike/ladder.2026-08-09.json` — 412 barreaux, 220 endpoints exclus, 0 non évalué
- Échelle précédente archivée : `spike/ladder.2026-08-09.v1-sans-raisonnement.json` — 316 barreaux,
  avant la correction du filtre `temperature` (amendement 4). Conservée parce que les numéros de
  barreaux cités dans le journal de marche s'y réfèrent.
- Endpoints à prix incertain non évalués : aucun — la file de sondes n'a jamais été sollicitée
- Endpoints exclus après sonde : aucun — aucun appel payant en phase de tri des prix

## Escalade

Les pages E, F, G et H sont les pages de réserve : le modèle ne les avait jamais vues et aucune
vérité terrain n'en a été transcrite.

| Modèle                          | Provider           | Pages         | Passes | Échecs | Réparations de schéma | Pages instables |
| ------------------------------- | ------------------ | ------------- | ------ | ------ | --------------------- | --------------- |
| `google/gemini-3-flash-preview` | `google-ai-studio` | A B C E F G H | 14     | 0      | 0                     | 1 (B)           |
| `google/gemini-2.5-flash-lite`  | `google-ai-studio` | A B C E F G H | 14     | 0      | 2                     | 0               |
| `openai/gpt-5.6-luna`           | `openai`           | A B C E F G H | 14     | 0      | 0                     | 7               |
| `mistralai/ministral-8b-2512`   | `mistral`          | A B C E F G H | 14     | 0      | 0                     | 6               |
| `qwen/qwen3.5-9b`               | `siliconflow`      | A B (partiel) | 3      | 0      | 0                     | 2 sur 3         |
| `qwen/qwen3.5-35b-a3b`          | `deepinfra`        | A B C E F G H | 14     | 6      | 0                     | 4               |
| `qwen/qwen3-vl-32b-instruct`    | `alibaba`          | A B C E F G H | 14     | 0      | 0                     | 5               |
| `qwen/qwen3.6-flash`            | `alibaba`          | A B C E F G H | 14     | 14     | —                     | —               |

Modes d'échec observés :

- `qwen3.5-9b` — 17 t/s mesurés, jusqu'à 934 s pour un appel. Écarté après trois appels. Imputable
  au modèle et à son provider.
- `ministral-8b-2512`, `qwen3.5-9b` — les quatre recettes de la page B rendues avec une seule étape
  chacune, toute la prose fusionnée. Même faute que `llama-4-scout`, déjà condamné. Imputable aux
  modèles.

**Deux verdicts d'échec ne sont pas imputables aux modèles** et sont retirés du comparatif :

- `qwen3.6-flash` (14 échecs) et `qwen3.5-35b-a3b` (6 troncatures) ont été mesurés alors que le
  harnais n'envoyait aucun contrôle de raisonnement. Les deux consommaient leur budget de sortie à
  réfléchir avant d'écrire. Vérifié depuis : `reasoning: { enabled: false }` fonctionne sur ces deux
  endpoints et ramène le raisonnement à 0 token. **Ils n'ont pas été rejugés** — le modèle était
  déjà retenu et la mesure n'aurait rien changé au choix.
- Les deux modèles `-thinking` (`qwen3-vl-8b-thinking` @alibaba,
  `qwen3-vl-30b-a3b-thinking` @siliconflow) refusent la coupure : `400 — Reasoning is mandatory for
this endpoint and cannot be disabled`, et `effort: "low"` est mesurablement inopérant (615 tokens
  de raisonnement avec, 518 sans). Leurs 5 000 à 9 000 tokens de réflexion par appel, leurs
  0,013–0,022 USD et leurs 48–93 s sont leur nature. Non retenus, sans reproche de qualité : seule
  la page A a été jouée.

## Acceptation

**Le protocole d'acceptation prévu n'a pas été exécuté** (amendement 1). Il reposait sur une vérité
terrain transcrite à la main depuis une page fraîche D, puis sur le chronométrage de `T_correction`
contre `T_saisie`. La transcription manuelle a été refusée ; le jugement s'est fait à l'œil sur les
sept pages, photo et extraction côte à côte.

Conséquences à assumer :

- `spike/accept.ts` et sa machinerie de classification restent en place mais **dormants** : aucune
  vérité terrain ne les alimente. Le ratio `T_correction / T_saisie` n'existe pas.
- La page D est ingérée (`spike/fixtures/pages/d.jpg`) mais **aucun modèle ne l'a jamais vue** et
  aucune vérité terrain n'en a été transcrite (`spike/fixtures/truth/` ne contient qu'un README).
  Elle reste donc utilisable telle quelle si l'on veut un jour mesurer ce ratio.
- Ce qui remplace la mesure : deux passes par page, et l'égalité stricte de leurs textes comme
  critère objectif. C'est cette colonne, et non le prix, qui a séparé les huit modèles.

## Verdict

- `OPENROUTER_MODEL` : `google/gemini-3-flash-preview`
- `OPENROUTER_PROVIDER` : `google-ai-studio`
- Version du prompt : `v2`
- Version du schéma : `1`
- Coût moyen par appel : 0,004518 USD — 12 recettes extraites de 7 pages
- Latence moyenne par appel : 6,1 s
- Dépense totale du spike : 0,256 USD sur un plafond de 5
- Verdict T1 : **positif**

Sur les sept pages : segmentation exacte partout, y compris la page à quatre recettes et la page à
deux versions sans titre distinct ; comptes d'ingrédients et d'étapes conformes à ce que la page
imprime ; aucune réparation de schéma nécessaire ; aucun texte éditorial ni accord mets-vins versé
dans les étapes.

Sept modèles moins chers ont été passés sur exactement les mêmes pages. Aucun ne fait mieux : deux
échouent en masse, quatre rendent une extraction différente à chaque appel sans rien casser de
visible, et le seul parfaitement stable corrompt en silence (`1 vingtaine` lu `1 vinaigre`).

## Réserves ouvertes pour T2

1. **Page B — instabilité sur l'étiquette de section.** Une passe sur deux, `Pour la pâte :` et
   `Pour la salade :` entrent dans la ligne d'ingrédient au lieu d'être écartées. Sans conséquence
   sur les comptes, mais le texte de la ligne n'est pas reproductible.
2. **Page E — déduction d'ingrédients, acceptée mais non déclarée.** La page n'imprime aucune liste ;
   le modèle en reconstitue une, correcte et complète, dans l'ordre de la prose. Le comportement est
   **validé** : une fiche sans liste d'ingrédients ne servirait pas à faire les courses.

   Le prompt v2 l'interdit pourtant explicitement (« ne déduis aucune ligne »). Il n'est pas modifié
   ici : le faire invaliderait les sept pages mesurées avec v2, qui fondent le verdict ci-dessus.
   **La première révision de prompt en T2 doit déclarer la règle** — reconstituer la liste depuis les
   étapes quand la page n'en imprime pas, et le signaler dans la sortie. Tant que la règle n'est pas
   écrite, le comportement reste imprévisible : rien ne garantit qu'une autre page sans liste ne
   produira pas un tableau vide.

3. **`strict: true` n'est pas contraignant sur OpenRouter.** Vérifié sur deux providers du même
   modèle, qui ont rendu `"6 à 8 personnes"` dans un champ déclaré `number`. `repairExtraction()`
   dans `src/lib/recipe-schema.ts` couvre le cas ; la validation doit rester défensive à la
   réception.
4. **`max_tokens` borne raisonnement + réponse** chez les modèles à raisonnement. Un budget de sortie
   calculé sur la seule taille de la réponse produit une troncature systématique.

## Rejeu sous prompt v3 / schéma 2 — 2026-08-10

Le verdict ci-dessus a été mesuré sous prompt v2. Le prompt v3 y ajoute la règle de déduction
d'ingrédients et le champ `ingredientsInferred`. Les sept pages ont donc été rejouées, deux passes
chacune : 14 appels, 0,0713 USD (0,0051 par appel, contre 0,0045 sous v2 — le prompt est plus long),
7,5 s en moyenne, **14 succès, zéro réparation de schéma, zéro nouvelle tentative**. Sortie brute dans
`spike/runs-v3/`, hors de l'archive v2 qu'elle sert à comparer.

`npx tsx spike/compare-v3.ts <archive v2> <sortie v3>` rend :

| Page | Deux passes  | Contre l'archive v2 |
| ---- | ------------ | ------------------- |
| A    | stable       | identique           |
| B    | stable       | prose identique     |
| C    | stable       | identique           |
| E    | stable       | déduction attendue  |
| F    | **instable** | prose identique     |
| G    | **instable** | déduction attendue  |
| H    | stable       | identique           |

**Aucune régression de contenu sur les sept pages.** Rien n'est perdu, rien n'est inventé, aucun
titre ne bouge, aucun compte de recettes ne change. Trois constats en revanche :

1. **La page G n'imprime aucune liste d'ingrédients non plus.** Le plan supposait E seule dans ce
   cas ; la vérification à l'œil de `g.jpg` le démentit — sa recette entière est un bloc de prose à
   puces sous « LA RECETTE ». `ingredientsInferred: true` y est donc **correct**, et l'archive v2
   n'est pas davantage une référence sur G que sur E. Le comparateur porte les deux pages.
2. **La liste déduite est instable là où la liste imprimée ne l'est pas.** G rend 16 lignes en passe 1
   et 13 en passe 2, avec « un filet d'huile d'olive » compté deux fois. C'est la limite mesurée de
   la fonctionnalité : sans lignes imprimées, il n'y a pas de frontière à recopier. Les cinq pages à
   liste imprimée restent, elles, parfaitement stables.
3. **La liste déduite de E contient une ligne qui n'est pas un ingrédient** — `1 mn sur feu doux`,
   une durée — et compte les œufs trois fois : `4 œufs`, puis `3 jaunes d'œufs`, puis
   `blancs d'œufs`. Le prompt v3 dit d'où reconstituer la liste, pas ce qui n'en fait pas partie.
   **Une révision v4 devrait interdire les durées, les températures et les fractions d'un ingrédient
   déjà listé.** Coût d'un nouveau rejeu de contrôle : 0,071 USD.

Deux divergences volontairement classées « à l'œil » plutôt qu'en échec, parce qu'aucune lecture de
la page ne les tranche :

- **Le redécoupage des étapes de la page B.** v2 coupait la prose phrase par phrase (13, 10 et 13
  étapes) ; v3 la groupe (6, 6 et 6). Le texte concaténé est **identique au caractère près**, et la
  page n'imprime qu'un seul bloc de prose sous « Préparation. » — sans marqueur d'étape éditorial,
  les deux découpages se valent. Le comparateur échoue donc sur la prose, pas sur les frontières.
- **L'espace français devant `!`.** L'unique divergence de la page F entre ses deux passes est
  `Déguster!` contre `Déguster !`. Elle suffit à faire tomber l'égalité stricte des deux passes, qui
  est le discriminant du spike, donc elle est signalée — mais elle ne change aucune donnée.

L'instabilité de la page B relevée en réserve 1 ci-dessus **ne s'est pas reproduite** : `Pour la
pâte :` est écarté dans les quatre passes archivées comme dans les deux passes v3.
