# Journal de revue du plan : T12 — câbler Convex ↔ Vercel

Acte 1 (grill) terminé — plan verrouillé avec Florian en quatre rounds de questions.
`MAX_ROUNDS=5`, `PLAN_FILE=docs/superpowers/plans/2026-08-10-t12-deploiement/PLAN.md`.

## Acte 1 — ce que l'entretien a tranché

| Round | Décision retenue                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 1     | Déploiement réel, vitrine vide assumée ; projet Convex existant piloté au CLI ; previews Convex activées |
| 1     | Preset Nitro auto-détecté ; `robots.txt` + `X-Robots-Tag` en plus de la meta ; R5 testé en prod          |
| 2     | Config dans `vercel.json` ; prod créée en local d'abord ; CI rouge non bloquante ; même clé OpenRouter   |
| 3     | Previews gated par label GitHub via workflow, pas via `ignoreCommand` intelligent ; Node 22 épinglé      |
| 4     | Copie **iso** de la production dans chaque preview, en live — le dépôt public interdit le zip committé   |

Corrections apportées en cours d'entretien, consignées parce qu'elles changent le code :

- **`ignoreCommand` était inversé** dans ma recommandation du round 3. Sortie `0` ⇒ build
  **ignoré**. La forme correcte est `[ "$VERCEL_ENV" != production ]`.
- **Le jeton d'admin des previews doit être fort.** Le round 2 l'autorisait faible au motif qu'une
  preview serait vide ; la décision du round 4 (copie iso) rend ce motif faux.

## Round 1 — Codex (`gpt-5.6-sol`, effort `medium`, codex-cli 0.144.5) — VERDICT: REVISE

Dix constats, du critique au moyen.

1. **Critique — modèle de confiance GitHub Actions incohérent.** Les PR de forks ne reçoivent aucun
   secret (donc pas de fuite, mais un job qui échoue) ; une PR d'une branche interne reçoit les
   secrets et exécute son propre `package.json`, ses scripts d'installation et son build. Le trigger
   `synchronize` conserve le label, donc un commit poussé après approbation redéploie tout seul.
   _Fix proposé_ : réserver aux branches internes, environnement protégé avec approbation par SHA,
   pas de relance automatique sur `synchronize`.
2. **Critique — ce n'est pas la clé qui est exposée, c'est la production entière.** Le workflow
   déploie les fonctions contrôlées par la PR **puis** importe les données réelles. Une PR peut
   ajouter une query publique et exfiltrer le snapshot, indépendamment d'`ADMIN_TOKEN` ou de la
   protection Vercel. _Fix proposé_ : fixture synthétique ou export anonymisé.
3. **Élevé — la clé d'export n'est pas une clé « de lecture ».** `convex export` crée puis télécharge
   un backup ; une clé `deployment:deploy` est le mauvais outil.
   _Fix_ : clé limitée à `deployment:backups:create` / `:view` / `:download`.
4. **Élevé — les photos ne seraient pas copiées.** `convex export` exclut le file storage par défaut,
   ce qui contredisait la décision 8 et laissait les références `_storage` pendantes.
   _Fix_ : `--include-file-storage`.
5. **Élevé — « copie iso » faux pour les components.** `import` accepte `--component`, `export` non ;
   les tables du rate limiter ne sont pas clonées. _Fix_ : le déclarer au lieu de le supposer.
6. **Élevé — course destructive.** `--preview-create` supprime et recrée à chaque passage ; deux
   exécutions concurrentes peuvent détruire le backend pendant qu'une autre importe.
   _Fix_ : `--preview-name`, groupe `concurrency`, nom `pr-<numéro>`.
7. **Élevé — `$BRANCH` collisionne et peut être invalide.** _Fix_ : `pr-<numéro>` et SHA dans le
   commentaire.
8. **Moyen — export vide sous-spécifié, et `--replace-all` peut demander confirmation.**
   _Fix_ : valider le zip, `--yes`, ne jamais avaler un échec d'import.
9. **Moyen — outillage CI non reproductible.** `npx vercel` nu tire une version quelconque.
10. **Moyen — `permissions: pull-requests: write` manquant**, et le commentaire ne doit pas partir du
    job qui exécute le code de la PR.

Trois hypothèses ciblées ont été **confirmées correctes** : l'orientation de `ignoreCommand`,
l'absence de build distant avec `vercel deploy --prebuilt`, et la prise en charge de `NITRO_PRESET`
par le preset Vercel de Nitro 3.

### Réponse de Claude

**Vérifié avant d'agir**, parce que deux constats étaient décisifs et testables localement :
`npx convex export --help` confirme que `--include-file-storage` est nécessaire et que `--component`
n'existe pas sur `export` ; `npx convex import --help` confirme `--component`, `--replace-all` et
`-y/--yes`. Constats 4, 5 et 8 exacts.

**Retenu** : 1 (partiellement), 3, 4, 5, 6, 7, 8, 9 (sous une autre forme), 10.

- Le workflow passe à **trois jobs**. Le job 1 exporte avec une clé **limitée aux sauvegardes** et ne
  checkout que `base.sha` ; le job 2 exécute le code de la PR sans jamais voir la clé de production ;
  le job 3 commente avec `pull-requests: write`, sans checkout. C'est la partie de 1, 3 et 10 qui
  supprime réellement une exposition.
- `synchronize` **retiré** des triggers, garde-fou `head.repo.full_name == github.repository` ajouté,
  `concurrency` par numéro de PR, `--preview-name "pr-$PR"` au lieu de `--preview-create`, `--yes`,
  inspection du zip avant import, SHA dans le commentaire.
- `--include-file-storage` ajouté, et la décision 8 réécrite : les photos ne sont pas gratuites.
- Nouvelle décision 9 : l'état des components ne se copie pas, et c'est le comportement souhaitable.

**Rejeté, avec la raison.**

- **Constat 2, dans sa recommandation** (fixture synthétique ou export anonymisé). Le mécanisme
  décrit est exact et il reste vrai après révision — c'est pourquoi il ouvre désormais la section
  des risques, en premier et sans euphémisme. Mais la copie iso a été choisie explicitement par le
  mainteneur, deux fois, après qu'on lui ait exposé le besoin d'une clé de production. Ce plan
  applique donc les atténuations disponibles et **consigne le risque résiduel** au lieu de renverser
  la décision. Elle se renverse si le contenu devient sensible autrement que par le droit d'auteur.
- **L'environnement GitHub protégé du constat 1.** Sur un dépôt à un seul mainteneur, il ajoute un
  clic pour s'approuver soi-même. Poser le label est déjà l'acte volontaire par SHA, et retirer
  `synchronize` suffit à ce qu'il le reste. Consigné en décision 19 du plan final.
- **Le `vercel` en `devDependencies` du constat 9.** Le fond est juste, la forme contredit une
  décision explicite de l'entretien (garder le CLI hors du dépôt). Retenu sous la forme
  `npx --yes vercel@54`, qui épingle sans ajouter de dépendance.

## Round 2 — Codex — VERDICT: REVISE

« La révision corrige les anciens findings 1, 3–7 et 10. Le risque de copie iso est désormais décrit
honnêtement. » Quatre problèmes restants, dont **deux introduits par la révision elle-même**.

1. **Critique — `snapshot.zip` devient publiquement téléchargeable.** Le dépôt est public, et un
   artefact d'exécution GitHub est téléchargeable par quiconque a accès en lecture au dépôt. Le
   découpage en trois jobs faisait donc transiter la base complète — scans, brouillons et fichiers
   `_storage` — par un support public, y compris quand le déploiement échoue.
   _Fix proposé_ : chiffrer avant `upload-artifact`, ou ne pas produire l'artefact.
2. **Élevé — le job qui exécute la PR reçoit inutilement `VERCEL_TOKEN`.** `VERCEL_PROJECT_ID` ne
   restreint pas les permissions du jeton, qui vaut pour toute l'équipe Vercel.
   _Fix_ : un quatrième job, sans checkout, seul détenteur du jeton.
3. **Élevé — « export vide ⇒ saut de l'import » conserve des données périmées.** Avec
   `--preview-name`, le backend est réutilisé : si une exécution antérieure a importé des données
   et que la production est ensuite vidée, le saut laisse l'ancien snapshot en place.
   _Fix_ : `--preview-create` avec concurrence sérialisée, ou effacement explicite.
4. **Faible — `vercel@54` n'est pas reproductible** : il résout la dernière 54.x, pas 54.14.0.

### Réponse de Claude

**Les quatre sont retenus.** Les deux premiers sont des régressions de ma propre révision, et le
troisième est une conséquence exacte du correctif que j'avais appliqué au round 1 — Codex a suivi la
chaîne jusqu'au bout.

- **Le snapshot n'est plus un artefact du tout.** Plutôt que de le chiffrer, le job `data` exporte
  **et** importe dans la même exécution : la base ne touche aucun support durable. Plus court qu'un
  chiffrement, et sans clé supplémentaire à transporter entre deux jobs.
- **Quatre jobs** : `build` (seul à exécuter le code de la PR, seule la clé de preview),
  `data` (clé de sauvegarde + clé de preview, checkout de `base.sha`), `publish` (seul détenteur de
  `VERCEL_TOKEN`, aucun checkout), `comment` (droit d'écriture sur la PR, aucun checkout).
- **Retour à `--preview-create`**, avec `cancel-in-progress: false` au lieu de `true`. C'est
  l'inverse du correctif du round 1, et c'est justifié : la course que `--preview-create` ouvrait se
  ferme par la sérialisation, tandis que la classe « données périmées » que `--preview-name`
  ouvrait ne se ferme pas sans écrire un effacement vérifié. Le saut d'import redevient
  provablement inoffensif, puisque le backend vient d'être recréé vide.
- **`vercel@54.14.0`**, version exacte.

Nouveau risque consigné en échange : avec une file plutôt qu'une annulation, deux poses de label
rapprochées peuvent faire recréer par la seconde exécution le backend que la première vient de
peupler. Le SHA porté par le commentaire du job 4 rend le cas visible.

## Round 3 — Codex — VERDICT: REVISE

Quatre constats, tous retenus.

1. **Critique — le workflow « de confiance » était contrôlé par la PR.** Sur `pull_request`, GitHub
   exécute le fichier de workflow **tel que la PR l'écrit**. Une PR pouvait donc réécrire
   `preview.yml` et déplacer les secrets vers un job qu'elle contrôle : le découpage en quatre jobs
   était décoratif, et l'affirmation « un seul job exécute du code de la PR » était fausse.
   _Fix_ : `pull_request_target`, checkout explicite de `head.sha` dans `build` seulement, avec
   `persist-credentials: false`.
2. **Élevé — les deux clés Convex n'étaient reliées à rien.** Le CLI ne lit que `CONVEX_DEPLOY_KEY` ;
   `CONVEX_BACKUP_KEY_PROD` et `CONVEX_DEPLOY_KEY_PREVIEW` ne sélectionnaient aucun déploiement.
   _Fix_ : deux steps, chacun mappant son secret sur `CONVEX_DEPLOY_KEY`.
3. **Moyen — `publish` n'attendait pas l'import.** Un échec de `data` laissait quand même une
   preview publique en ligne. _Fix_ : `needs: [build, data]`.
4. **Moyen — le CLI Convex du job `data` n'était pas reproductible.** _Fix_ : `npm ci
--ignore-scripts` dans le checkout de confiance.

### Réponse de Claude

**Les quatre appliqués tels quels.** Le premier invalidait la prémisse de tout le découpage des deux
rounds précédents — un job n'est « de confiance » que si la définition du workflow l'est aussi, et
seul `pull_request_target` le garantit. Le deuxième était un bug d'exécution pur : le plan nommait
des secrets sans dire comment le CLI les trouve, et il ne les aurait pas trouvés.

Le graphe final : `build` (checkout `head.sha`, clé de preview seule) → `data` (checkout
`base.sha`, `npm ci --ignore-scripts`, deux steps à un secret chacun) → `publish`
(`needs: [build, data]`, jeton Vercel seul, aucun checkout) → `comment` (`needs: publish`, droit
d'écriture sur la PR, aucun checkout).

## Round 4 — Codex — VERDICT: APPROVED

« Les quatre findings du round 3 sont correctement traités. Je ne vois plus de défaut matériel
bloquant l'implémentation. » Neuf points validés explicitement, dont la répartition des secrets
entre les quatre jobs, le confinement du snapshot au runner du job `data`, la sérialisation des
recréations, et le fait que « le risque résiduel — du code PR explicitement approuvé pouvant lire
la copie des données — est désormais délibéré, circonscrit et documenté ».

Cinq raffinements non bloquants, **tous intégrés au plan** plutôt que laissés à l'implémentation :
`retention-days: 1` sur l'artefact de build, `timeout-minutes` sur les quatre jobs, un smoke check
entre l'import et la publication, l'épinglage des actions tierces par SHA, et l'abandon facultatif
d'une exécution en file dont le `head.sha` n'est plus la tête de la PR.

## Après approbation — un ajout demandé par Florian

Question posée après le verdict : quels sont exactement les risques de la copie iso ? Sept ont été
énumérés, et trois leviers proposés. Florian en a retenu un : **activer la protection de
déploiement Vercel sur les previews**.

Vérifié avant d'écrire : _Vercel Authentication_ en portée _Standard Protection_ est disponible sur
le plan Hobby, protège les URL de preview et de déploiement, et laisse le domaine de production
public. _Password Protection_ et _Trusted IPs_ sont réservées à Enterprise, donc hors de portée.

Ajouté au plan : l'étape 3.4, la décision 10, un critère de vérification à l'étape 4 (la production
doit répondre **sans** session Vercel — la protection ne doit pas avoir débordé), une ligne dans le
commentaire de PR pour que le mur d'authentification ne passe pas pour une panne, et la réécriture
du risque correspondant. C'est aussi la seule exception assumée à la décision « rien dans
l'interface » : la protection de déploiement n'a pas de champ `vercel.json`.

Ce que ça ne change pas, et qui reste écrit noir sur blanc dans les risques : les URL de stockage
Convex ne passent pas par Vercel, et le code de la PR lit la base depuis l'intérieur.

## Résolution

Convergence au round 4 sur 5. Le plan est passé de deux jobs implicites à quatre jobs dont la
frontière de confiance est explicite, et trois trous ont été fermés qu'aucune relecture par le seul
auteur n'aurait trouvés : l'artefact public, le `VERCEL_TOKEN` inutilement exposé, et surtout le
fait qu'un workflow déclenché par `pull_request` est écrit par la PR elle-même.
