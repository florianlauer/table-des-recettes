# Plan : T12 — câbler Convex ↔ Vercel, previews comprises

_Verrouillé par grill — Claude + Florian, 2026-08-10_

## Goal

Le dépôt sait se déployer. Un push sur `main` met la vitrine en ligne et pousse les fonctions
Convex sur un déploiement `prod` qui n'existe pas encore aujourd'hui ; une PR portant le label
`preview` obtient un frontend Vercel jetable branché sur un backend Convex neuf, chargé d'une
**copie iso de la base de production**. La vitrine servie en prod sera **vide** — rien ne sait
encore publier un brouillon (reliquat R3) — et c'est assumé : ce plan livre la chaîne, pas son
contenu. Il lève au passage le reliquat R5, en observant si le composant `@convex-dev/rate-limiter`
monte sur un déploiement de production.

## État de départ constaté

Vérifié le 2026-08-10 sur `main` à `e94e02f`, pas supposé :

- **Convex** : le projet existe, mais seulement en `dev` (`CONVEX_DEPLOYMENT` commence par `dev:`).
  Aucun déploiement `prod`, donc aucune variable d'environnement de production.
- **Le build** : `vite build`, avec le plugin `nitro()` **sans preset épinglé** (`vite.config.ts:25`).
  Le README documente une sortie Node générique (`node dist/server/index.mjs`).
- **Les variables** : le frontend lit `VITE_CONVEX_URL` (`src/router.tsx:45`) et **jette** si elle
  manque. Le backend lit `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_PROVIDER`
  (`convex/extract.ts:221-223`), `ADMIN_TOKEN` (`convex/auth.ts:14`), `ALLOW_DEV_IMAGES`
  (`convex/devImages.ts:10`) et `ALLOW_DESTRUCTIVE_SEED` (`convex/seed.ts:260`).
- **Sans clé OpenRouter, l'extraction dégrade proprement** : `extractImage` rend un échec
  `transport` « Configuration OpenRouter incomplète » avant tout appel réseau. Mais cette
  catégorie est **retryable** (décision 11 du plan d'ingestion), donc un scan lancé sans clé
  consomme ses tentatives avant de s'arrêter.
- **Aucun artefact Vercel** dans le dépôt : pas de `vercel.json`, pas de `public/`, et `.vercel/`
  n'est pas dans le `.gitignore`.
- **Le `noindex` existe déjà** en balise meta rendue par le SSR (`src/routes/__root.tsx:18`).
- **Le dépôt GitHub est public** (`gh repo view` : `visibility=PUBLIC`).
- **Le CLI Vercel 54.14.0** est installé globalement, hors `devenv.nix`.
- **`seed:run`** est une `internalMutation` sans argument (`convex/seed.ts:252`), donc appelable
  telle quelle par `--preview-run`.

Et côté documentation des fournisseurs, vérifié aussi :

- Les preview deployments Convex sont en **bêta**, disponibles sur le plan gratuit, **expirés
  automatiquement à 5 jours**, et chaque déploiement compte dans la limite de l'équipe.
- Les variables d'un déploiement de preview ne viennent pas de la prod mais des **« project
  environment variable defaults »**.
- `vercel.json` accepte `buildCommand`, `headers` et `ignoreCommand`. **`ignoreCommand` inverse
  l'intuition** : sortie `0` ⇒ le build est **ignoré**, sortie `1` ⇒ le build **a lieu**.
- `vercel.json` n'a **pas** de champ de version de Node ; le mécanisme versionné est
  `engines.node` dans `package.json`.
- `npx convex import <zip>` **préserve `_id` et `_creationTime`**, donc les références entre
  tables survivent à la copie.

## Approach

### 1. Préparer le dépôt (aucun service touché)

1. `.gitignore` : ajouter `.vercel/`, que le CLI écrit dès le premier `vercel link`.
2. `package.json` : ajouter `"engines": { "node": "22.x" }`, aligné sur `devenv.nix` (`nodejs_22`)
   et sur la CI de T15.
3. `public/robots.txt` : `User-agent: *` / `Disallow: /`. Vite recopie `public/` dans la sortie.
4. `vercel.json` :

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "buildCommand": "npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL",
     "ignoreCommand": "[ \"$VERCEL_ENV\" != production ]",
     "headers": [
       {
         "source": "/(.*)",
         "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
       }
     ]
   }
   ```

   `--cmd-url-env-var-name` est passé explicitement plutôt que laissé à l'inférence : le nom est
   alors écrit à côté de son unique lecteur (`src/router.tsx:45`), et une inférence qui changerait
   de comportement entre deux versions du CLI ne casserait pas le build en silence.

   L'`ignoreCommand` sort `0` — donc **ignore** — dès que l'environnement n'est pas la production.
   Il éteint les previews déclenchées par git ; celles qu'on veut passeront par l'étape 5, qui ne
   déclenche aucun build distant.

5. `README.md` : remplacer la section « Deploy with Nitro » par la procédure réelle — Vercel est
   détecté automatiquement par Nitro, le build de production est celui de `vercel.json`, et la
   sortie Node générique reste vraie hors Vercel.

**Point d'arrêt** : `npm run check`, `npm run lint`, `npm run typecheck`, `npm test`. Relecture,
commit manuel.

### 2. Créer le déploiement Convex `prod`, en local

Dans cet ordre, depuis le checkout principal :

1. `npx convex deploy` — sans clé, avec les identifiants de la session connectée. C'est ce
   passage qui crée le déploiement `prod` et qui **répond à R5** : soit le composant
   `@convex-dev/rate-limiter` déclaré dans `convex/convex.config.ts` monte, soit la commande
   échoue et on débogue ici, dans un terminal, sur un backend qui ne contient rien.
2. `npx convex env set --prod` pour `OPENROUTER_API_KEY` (la même clé qu'en dev, décision de
   l'entretien), `OPENROUTER_MODEL` (`google/gemini-3-flash-preview`), `OPENROUTER_PROVIDER`
   (`google-ai-studio`) et `ADMIN_TOKEN` (secret fort, **propre à la production**).
3. Vérifier qu'`ALLOW_DEV_IMAGES` et `ALLOW_DESTRUCTIVE_SEED` **ne sont pas posées** sur `prod`.
   Ce sont les deux gardes qui empêchent respectivement d'écrire des images de développement et
   d'effacer la base.

L'ordre est imposé : `convex env set --prod` exige que le déploiement existe.

### 3. Relier Vercel au dépôt

1. `vercel link` depuis le checkout principal, sur un projet Vercel neuf — **pas** par le
   marketplace Convex, qui créerait une équipe Convex séparée et abandonnerait le projet existant.
2. Relier le projet au dépôt GitHub, branche de production `main`.
3. Dans les variables d'environnement Vercel, **portée Production uniquement** :
   `CONVEX_DEPLOY_KEY` = clé de déploiement de production, générée depuis le dashboard Convex.
4. Activer **Deployment Protection** : méthode _Vercel Authentication_, portée _Standard
   Protection_. Les deux sont disponibles sur le plan Hobby. Toute URL de preview et toute URL de
   déploiement exigent alors une session Vercel ayant accès au projet ; **le domaine de production
   reste public**, ce qui est le découpage voulu — la vitrine doit s'ouvrir sans compte.
5. Ne rien configurer d'autre dans l'interface : `buildCommand`, `headers` et `ignoreCommand`
   viennent de `vercel.json`. La protection de déploiement est **l'exception assumée** à cette
   règle : elle n'a pas de champ `vercel.json`, c'est un réglage de projet et rien d'autre. À
   revérifier si le projet Vercel est un jour recréé, puisque rien dans le dépôt ne la porte.

### 4. Premier déploiement de production

Push sur `main` (ou `vercel --prod` pour le premier tir). Vérifier, dans l'ordre :

- le build passe et la sortie est bien produite par le preset Vercel de Nitro, sans épinglage ;
- `VITE_CONVEX_URL` a été injectée par `convex deploy` et pointe sur le déploiement `prod` ;
- l'URL répond **200** sur `/` **sans session Vercel** — la protection ne doit pas avoir débordé
  sur le domaine de production ; la vitrine est vide et le dit ;
- `curl -I` montre `X-Robots-Tag: noindex, nofollow`, et `/robots.txt` rend `Disallow: /` ;
- `/admin` refuse un jeton absent ou faux et accepte le vrai ;
- les fonctions du composant `rateLimiter` sont présentes dans le dashboard.

### 5. La chaîne de preview, déclenchée par un label

Un workflow `.github/workflows/preview.yml` sur **`pull_request_target`**, `types: [labeled]`
seulement :

```yaml
on:
  pull_request_target:
    types: [labeled]
permissions:
  contents: read
concurrency:
  group: preview-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: false
```

et sur chaque job `if:` `github.event.label.name == 'preview'` **et**
`github.event.pull_request.head.repo.full_name == github.repository`.

**`pull_request_target` et pas `pull_request`, et c'est le point qui fait tenir tout le reste.**
Sur `pull_request`, GitHub exécute le fichier de workflow **tel que la PR l'écrit** : une PR
pourrait donc réécrire `preview.yml` lui-même et déplacer les secrets vers le job qu'elle contrôle.
Le découpage en quatre jobs ne vaudrait rien. `pull_request_target` exécute la définition de la
branche par défaut, donc le graphe de jobs et la répartition des secrets sont ceux de `main`, pas
ceux de la PR. En contrepartie, il ne checkout **pas** le code de la PR par défaut : c'est au job
`build` de le demander explicitement, ce qui rend l'endroit où le code non relu entre dans la chaîne
visible en une ligne au lieu d'être implicite.

`synchronize` est délibérément absent : il conserverait le label et redéploierait automatiquement
tout commit poussé **après** que le label a valu approbation. Sans lui, un nouveau commit exige de
retirer puis reposer le label — le label redevient une approbation par SHA, et c'est le seul
mécanisme d'approbation dont ce dépôt a besoin avec un unique mainteneur. Le garde-fou sur
`head.repo.full_name` fait échouer bruyamment une PR de fork, au lieu de la laisser échouer
obscurément faute de secrets.

Le nom de la preview est **`pr-<numéro>`**, jamais le nom de branche : deux branches homonymes ne
peuvent pas se marcher dessus, et les `/` d'un nom de branche ne posent plus de question.

**Quatre jobs. La règle qui décide du découpage : un seul job exécute du code de la PR, et il ne
détient que le strict nécessaire pour le construire. Les données de production ne sont jamais
écrites sur un support durable.**

**Job 1 — `build` (le seul qui exécute le code de la PR).** Checkout explicite de
`github.event.pull_request.head.sha`, avec `persist-credentials: false` pour que le jeton du
runner ne reste pas dans le `.git` d'un arbre non relu. Ne reçoit que `CONVEX_DEPLOY_KEY_PREVIEW`,
mappé sur **`CONVEX_DEPLOY_KEY`** — le CLI Convex ne lit que ce nom-là.

1. `npm ci`.
2. `npx convex deploy --preview-create "pr-$PR" --cmd 'npm run build'
--cmd-url-env-var-name VITE_CONVEX_URL`, avec `NITRO_PRESET=vercel` dans l'environnement.
   Une seule commande crée le backend de preview, y pousse les fonctions, et construit le frontend
   en lui injectant l'URL de **ce** backend. `--preview-create` supprime et recrée le backend à
   chaque passage : c'est ce qui garantit qu'une preview ne peut jamais contenir le reliquat d'une
   exécution précédente. La destruction est rendue sûre par `cancel-in-progress: false`, qui met
   les exécutions d'une même PR en file au lieu de les faire se chevaucher.
   `NITRO_PRESET` est une variable d'environnement, pas un épinglage dans `vite.config.ts` : le
   build local reste générique.
3. Téléverser `.vercel/output` en artefact. C'est du code construit à partir d'un dépôt public —
   aucune donnée de production n'y figure.

**Job 2 — `data` (de confiance, `needs: build`).** Checkout de `github.event.pull_request.base.sha`
— du code déjà mergé — et rien de la branche, puis `npm ci --ignore-scripts` pour que `npx convex`
soit la version du lockfile et non une version quelconque téléchargée à la volée. **Exporte et
importe dans le même job**, sans jamais téléverser le snapshot où que ce soit :

```
npx convex export --prod --include-file-storage --path snapshot.zip
npx convex import --deployment "preview/pr-$PR" --replace-all --yes snapshot.zip
```

**`--deployment "preview/<nom>"`, et surtout pas `--preview-name`** : vérifié dans l'aide du CLI
installé, seul `convex deploy` connaît `--preview-name` et `--preview-create`. `import` et `run`
n'ont que `--prod` et `--deployment`, qui prend une référence de la forme `preview/pr-12`. Une
première version de ce plan écrivait `--preview-name` sur l'import ; elle aurait échoué au premier
passage.

Les deux commandes sont **deux steps distincts**, chacun mappant son propre secret sur
`CONVEX_DEPLOY_KEY` — le seul nom que le CLI lit. L'export reçoit
`${{ secrets.CONVEX_BACKUP_KEY_PROD }}`, l'import `${{ secrets.CONVEX_DEPLOY_KEY_PREVIEW }}`. Un
seul step portant les deux variables ne sélectionnerait rien : la clé de sauvegarde ne doit jamais
être celle qui écrit.

- `CONVEX_BACKUP_KEY_PROD` est une deploy key **limitée aux sauvegardes**
  (`deployment:backups:create`, `:view`, `:download`), jamais `deployment:deploy`, ni écriture de
  données, ni variables d'environnement. `convex export` crée puis télécharge un backup — ce n'est
  pas une lecture anodine, et une clé de déploiement y serait surdimensionnée.
- `--include-file-storage` est **obligatoire** : l'export exclut les fichiers par défaut, et sans
  ce drapeau les références `_storage` arriveraient pendantes dans la preview.
- `--yes` est requis : sans lui la commande attend une confirmation qui ne viendra jamais en CI.
- Si le zip ne contient aucun répertoire de table — le cas tant que R3 n'a pas livré la
  publication —, l'import est sauté et le journal du job le dit. Ce saut n'est sûr **que** parce
  que le job 1 vient de recréer le backend : il est déjà vide, il n'y a rien de périmé à écraser.
  Tout autre échec d'import est un échec du job, jamais un avertissement.

**Job 3 — `publish` (de confiance, `needs: [build, data]`).** Il attend l'import : sans ça, un
échec de `data` laisserait quand même une preview publique en ligne, servant un backend dans un
état indéterminé. Ne checkout rien. Reçoit `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Télécharge l'artefact `.vercel/output` et lance
`npx --yes vercel@54.14.0 deploy --prebuilt --token=$VERCEL_TOKEN`. Aucun build distant, donc
l'`ignoreCommand` de l'étape 1 n'entre jamais en jeu. La version du CLI est épinglée **exactement**
sur celle vérifiée en local. Expose l'URL en sortie de job.

**Job 4 — `comment` (de confiance, `needs: publish`).** Ne checkout rien, porte
`permissions: pull-requests: write`, poste l'URL **avec le SHA déployé**. Le droit d'écriture sur
la PR ne traverse ainsi jamais le job qui exécute du code arbitraire. L'URL postée demandera une
session Vercel pour s'ouvrir — c'est la protection de l'étape 3, et le commentaire le rappelle en
une ligne pour que le mur d'authentification ne passe pas pour une panne.

Variables par défaut du projet Convex, appliquées à toute nouvelle preview :
`OPENROUTER_MODEL`, `OPENROUTER_PROVIDER` et un `ADMIN_TOKEN` **fort et distinct de celui de
prod**. Pas d'`OPENROUTER_API_KEY` : une preview ne doit pas pouvoir dépenser.

Pas de nettoyage : l'expiration à 5 jours des previews Convex s'en charge.

**Détails d'écriture du workflow**, sans conséquence sur l'architecture ci-dessus :

- `retention-days: 1` sur l'artefact `.vercel/output` — il ne sert qu'entre deux jobs de la même
  exécution.
- `timeout-minutes` sur les quatre jobs : la file étant sérialisée, une commande CLI bloquée
  monopoliserait la file de la PR jusqu'au délai par défaut de six heures.
- Un smoke check après l'import et **avant** la publication :
  `npx convex run --deployment "preview/pr-$PR" recipes:countsByType`. C'est une query publique de
  la vitrine, donc sans jeton d'admin, et elle sépare un import techniquement réussi d'un backend
  inexploitable.
- Actions tierces épinglées par SHA plutôt que par étiquette de version.
- Facultatif : abandonner une exécution en file si son `head.sha` n'est plus la tête de la PR.
  L'état final est correct sans ce contrôle ; il évite seulement de publier une preview périmée
  pendant quelques minutes.

### 6. Preuve de bout en bout

Une PR de test, labellisée `preview`, produit une URL qui répond, sert la même base que la prod,
porte le `X-Robots-Tag`, et dont `/admin` refuse le jeton de production. Puis le retrait du label
et le merge : `main` redéploie la production toute seule.

### 7. Mettre à jour le journal

Cocher T12 dans `docs/superpowers/specs/2026-08-08-table-des-recettes-tasks.md`, passer sa ligne
à ✅ dans `docs/SUIVI.md`, et **retirer le reliquat R5**, dont ce plan aura donné la réponse à
l'étape 2.

## Key decisions & tradeoffs

1. **Déploiement réel, vitrine assumée vide.** Un câblage non exécuté n'est pas vérifiable, et
   c'est le mode d'échec que le projet a déjà payé deux fois. Ce qu'on paie : une URL de
   production qui ne montre rien jusqu'à R3.
2. **Projet Convex existant relié à la main, pas le marketplace Vercel.** Le marketplace crée sa
   propre équipe Convex ; il jetterait le projet et ses données de dev.
3. **Toute la configuration dans `vercel.json`, rien dans l'interface.** Un réglage de dashboard
   ne se relit pas en PR et disparaît si le projet est recréé. Corollaire : la version de Node
   passe par `engines.node`, faute de champ dans `vercel.json`.
4. **Preset Nitro non épinglé dans `vite.config.ts`.** Vercel est auto-détecté ; le workflow de
   preview force `NITRO_PRESET=vercel` par variable d'environnement, ce qui laisse
   `node dist/server/index.mjs` vrai partout ailleurs et le README honnête.
5. **Previews gated par un label GitHub, pas par un `ignoreCommand` intelligent.** Le label vit
   sur GitHub, la logique qui le lit aussi. L'`ignoreCommand` reste une comparaison de chaîne
   qu'on relit sans réfléchir, au lieu d'un appel authentifié à l'API GitHub dont la panne se
   déguiserait en « build ignoré ». Ce qu'on paie : un fichier de workflow de plus, et des
   secrets Vercel dans GitHub.
6. **`vercel deploy --prebuilt`, pas `vercel build`.** Faire construire le workflow par
   `vercel build` rejouerait le `buildCommand` de `vercel.json`, qui appelle lui-même
   `convex deploy` — une récursion. Construire d'abord et téléverser ensuite supprime le
   problème et contourne l'`ignoreCommand` sans le contredire.
7. **Copie iso de la production dans chaque preview, en live.** Le pattern documenté par Convex
   est un `seed_data.zip` **committé à la racine** — inapplicable ici : le dépôt GitHub est
   public, et y committer les recettes publierait, indexé, du texte transcrit depuis des
   magazines sous droits, ce que le `noindex` de la vitrine existe précisément pour éviter.
   La copie doit donc être live, et c'est **cela** qui rend une clé de lecture de la production
   obligatoire dans le workflow — pas un principe, la conséquence de deux contraintes déjà posées.
8. **Le zip complet plutôt que la seule table `recipes`.** Il préserve `_id` et `_creationTime`,
   donc les références tiennent. Une copie mono-table aurait laissé `scanId` et les identifiants
   de stockage pendants, avec une inconnue sur ce qu'un import mono-table accepte. **Les photos
   ne viennent pas gratuitement** : `npx convex export` exclut le stockage de fichiers par défaut,
   il faut `--include-file-storage` — vérifié dans l'aide du CLI installé. Ce qu'on paie : le zip
   grossit avec les photos, à télécharger puis téléverser à chaque preview.
9. **L'état des components ne se copie pas, et c'est très bien.** Vérifié dans l'aide du CLI :
   `convex import` accepte `--component`, `convex export` **non**. Les tables isolées de
   `@convex-dev/rate-limiter` ne sont donc pas dans le snapshot, et une preview démarre avec des
   quotas neufs. La copie n'est pas « iso » au sens strict — elle l'est pour les données du
   projet, pas pour l'état des components. C'était une question ouverte de la première version de
   ce plan ; c'est maintenant un fait, et le comportement souhaitable.
10. **Protection de déploiement Vercel sur les previews, pas sur la production.** _Vercel
    Authentication_ en portée _Standard Protection_ : disponible sur Hobby, elle exige une session
    Vercel sur toute URL de preview et laisse le domaine de production ouvert. Elle ferme le seul
    des risques de la copie iso qui tienne à une URL — un lien de preview qui traîne dans un
    commentaire ou un log. Elle **ne ferme pas** les deux autres : les URL de stockage Convex sont
    servies par Convex, pas par Vercel, et le code de la PR lit la base depuis l'intérieur. C'est
    un verrou sur la porte, pas sur le contenu. Ce qu'on paie : ouvrir sa propre preview demande
    d'être connecté à Vercel, et l'`ignoreCommand` ci-dessus n'a **pas** de champ équivalent en
    fichier — ce réglage vit dans l'interface, seule exception à la décision 3.
11. **`pull_request_target`, parce que sinon le découpage en jobs ne protège rien.** Sur
    `pull_request`, le fichier de workflow exécuté est celui de la PR : elle pourrait le réécrire
    pour déplacer les secrets vers le job qu'elle contrôle, et toute la répartition ci-dessous
    deviendrait décorative. `pull_request_target` fige le graphe de jobs sur celui de `main`. Ce
    qu'on paie : il faut demander explicitement le checkout de `head.sha`, et cet appel est
    exactement l'endroit où le code non relu entre — un endroit désormais visible.
12. **Un seul job exécute le code de la PR, et il ne détient qu'une clé de preview.** Ni la clé de
    production, ni le jeton Vercel ne l'approchent : l'export tourne dans un job qui ne checkout
    que du code déjà mergé, le téléversement dans un job qui ne checkout rien. La clé de lecture
    n'est pas une clé de déploiement mais une clé **limitée aux sauvegardes** — `convex export`
    crée puis télécharge un backup, et un `VERCEL_TOKEN` n'est pas restreint à un projet par
    `VERCEL_PROJECT_ID`, il vaut pour toute l'équipe. Ce que ça ne résout pas : le job 2 importe
    la vraie base dans un backend dont les fonctions viennent de la PR — voir les risques.
13. **Le snapshot n'est jamais un artefact.** Le job 2 exporte **et** importe dans la même
    exécution. Sur un dépôt public, un artefact d'exécution est téléchargeable par n'importe qui
    ayant accès en lecture au dépôt, donc par tout le monde : y déposer la base complète, photos
    comprises, publierait exactement ce que le reste du plan protège. Chiffrer l'artefact aurait
    marché, mais ne pas en produire est plus court et ne dépend d'aucune clé à transporter.
    L'artefact `.vercel/output` reste, lui, sans danger : c'est du code construit depuis un dépôt
    public.
14. **`--preview-create`, pas `--preview-name`, avec une file d'attente plutôt qu'une annulation.**
    Réutiliser un backend expose à un cas concret : une preview relancée après que la production a
    été vidée garderait l'ancien snapshot, puisque l'import est sauté quand l'export est vide. Un
    backend recréé à chaque passage supprime toute la classe de bugs « données périmées », et
    rend le saut d'import provablement inoffensif. Le prix — `--preview-create` est destructeur —
    est payé par `cancel-in-progress: false`, qui sérialise les exécutions d'une même PR au lieu
    de les faire se chevaucher. Le déclencheur unique `labeled` rend ces files rarissimes.
15. **CLI Vercel épinglé à la version exacte dans la commande CI, pas ajouté aux dépendances.**
    `npx vercel` nu n'est pas reproductible, et `vercel@54` ne l'est qu'à moitié — il résout la
    dernière 54.x. L'ajouter à `devDependencies` serait plus solide encore, mais contredirait la
    décision prise pendant l'entretien de garder le CLI hors du dépôt ; `npx --yes vercel@54.14.0`
    épingle sans ajouter de dépendance.
16. **Le jeton d'admin des previews doit être fort.** Cette décision **corrige** un arbitrage
    antérieur de l'entretien : un jeton faible se justifiait tant qu'une preview était vide, ce
    que la décision 8 rend faux. Toujours distinct de celui de production, pour qu'une PR ne
    puisse pas faire fuiter le vrai.
17. **Aucune clé OpenRouter sur les previews.** Une preview qui peut dépenser est un piège ; sans
    clé, `extractImage` échoue proprement avant tout appel réseau. On pose la clé à la main sur
    une preview le jour où on veut réellement y tester l'extraction.
18. **Vercel déploie même quand la CI est rouge, et on l'accepte.** La protection de branche a
    été écartée par décision, et un `ignoreCommand` qui rejouerait les six contrôles créerait une
    seconde source de vérité et un build annulé plus difficile à lire qu'un check rouge.
19. **On ne nettoie pas les previews Convex.** Leur expiration à 5 jours existe déjà ; la
    supprimer à la main au retrait du label serait du code écrit pour remplacer un minuteur.
20. **Le label est l'approbation, et `synchronize` est écarté pour que ça reste vrai.** Un
    environnement GitHub protégé avec relecteur obligatoire donnerait la même garantie ; sur un
    dépôt à un seul mainteneur, il ajouterait un clic pour approuver ses propres commits. Poser le
    label est déjà l'acte volontaire par SHA. Ce qu'on paie : relancer une preview après un commit
    demande de retirer puis reposer le label.

## Risks / open questions

- **Le risque principal, résiduel et assumé : le job 2 importe la vraie base dans un backend dont
  les fonctions viennent de la PR.** Le découpage en trois jobs éloigne la clé de production du
  code non relu, mais il ne supprime pas ceci : une PR peut ajouter une query publique, ou modifier
  le frontend, et lire le snapshot importé — `ADMIN_TOKEN` et une éventuelle protection Vercel n'y
  changent rien, puisque le code déployé est celui de la PR. Ce que le plan oppose à ça est
  procédural, pas technique : le label est posé à la main, PR par PR et SHA par SHA, par le seul
  mainteneur du dépôt, et `synchronize` est écarté pour qu'un commit ultérieur ne réutilise pas
  cette approbation. C'est un arbitrage explicite en faveur de previews réalistes ; si le contenu
  de la base devient sensible autrement que par le droit d'auteur, il se renverse en fixture
  synthétique.
- **`npm ci` dans le job 1 exécute les scripts d'installation des dépendances de la PR.** C'est le
  chemin par lequel une PR de bump de dépendance, même de bonne foi, fait tourner du code tiers à
  côté de `CONVEX_DEPLOY_KEY_PREVIEW`. Ni la clé de production ni `VERCEL_TOKEN` ne sont là — c'est
  précisément ce que le découpage en quatre jobs achète. Ce qui reste exposé est une clé qui ne sait
  créer et déployer que des previews de ce projet.
- **Une exécution en file peut travailler sur un SHA périmé.** `cancel-in-progress: false` sérialise
  au lieu d'annuler ; si le label est retiré puis reposé deux fois de suite, la seconde exécution
  recrée le backend que la première vient de peupler. Le commentaire du job 4 porte le SHA
  précisément pour que ce cas se voie. Fréquence attendue : quasi nulle, le déclencheur étant un
  geste manuel.
- **Le composant `rate-limiter` n'a jamais été poussé ailleurs qu'en dev.** C'est R5, et le plan
  le teste directement en production (étape 2) plutôt que sur une preview jetable. Le pari se
  tient parce que la prod est vide, mais il est assumé : en cas de refus, on débogue jusqu'au
  bout — retirer le composant supprimerait le rate limit de T4, une garde livrée et testée.
- **Le contrat d'un snapshot entièrement vide n'est pas documenté.** D'où l'inspection du zip avant
  l'import plutôt qu'un import qu'on laisserait échouer. À constater au premier passage réel, sur
  une base vide où l'erreur ne coûte rien.
- **Import/export Convex et preview deployments sont tous les deux en bêta.** Deux fonctionnalités
  bêta empilées sur le chemin critique des previews. La prod, elle, n'en dépend pas.
- **La protection Vercel ferme la porte, pas le contenu.** Les URL de preview exigent désormais une
  session Vercel, ce qui neutralise le lien qui traîne dans un commentaire ou un log. Restent
  ouverts, et ce sont les deux plus gros : les URL de stockage Convex, servies par Convex et non par
  Vercel, donc joignables sans authentification par qui connaît l'adresse ; et la lecture depuis
  l'intérieur, par le code de la PR lui-même.
- **La taille de l'export croît avec les photos**, et `--include-file-storage` la rend réelle.
  Aujourd'hui zéro ; à quelques centaines de recettes illustrées, chaque preview téléchargera puis
  téléversera cette masse, avec la limite de taille des artefacts GitHub au bout. Le jour où ça
  gêne, la décision 8 se renverse en copie sans stockage.
- **Les noms exacts des permissions de deploy key** (`deployment:backups:create` et consorts) sont
  à confirmer sur le dashboard Convex au moment de générer la clé ; l'intention — une clé qui sait
  sauvegarder et rien d'autre — ne dépend pas de leur orthographe.

Résolus, consignés pour ne pas être re-débattus : l'orientation de `ignoreCommand` (sortie `0` ⇒
build ignoré), le fait que `vercel deploy --prebuilt` n'exécute aucun build distant et donc aucun
`ignoreCommand`, et l'absence de `--component` sur `convex export`.

Vérifiés en exécutant, pas en lisant, au moment d'implémenter les étapes 1 et 5 :
`NITRO_PRESET=vercel npm run build` produit bien un `.vercel/output` complet
(`config.json`, `functions/__server.func`, `static/`) et y recopie `public/robots.txt` ; et
l'aide du CLI Convex installé confirme que `--preview-name` n'existe que sur `deploy`, ce qui a
corrigé la commande d'import ci-dessus.

Éliminés en cours de revue, mentionnés parce que la première version du plan les portait : le
snapshot déposé en artefact d'exécution — publiquement téléchargeable sur un dépôt public ; le
`VERCEL_TOKEN` remis au job qui exécute le code de la PR, alors que `VERCEL_PROJECT_ID` ne le
restreint à rien ; et les données périmées d'une preview réutilisée quand l'import est sauté.

## Out of scope

- **La publication d'un brouillon** (R3). La vitrine de production restera vide à la fin de ce
  plan.
- **Un domaine personnalisé.** L'URL `*.vercel.app` suffit ; le sujet n'a pas été tranché.
- **La protection de branche sur `main`**, écartée par décision le 2026-08-10.
- **`vercel` dans `devenv.nix`** : le CLI reste global, par décision.
- **La révision v4 du prompt** (R1), l'instabilité de la page B (R2), les blobs orphelins (R4) et
  le repli d'embellissement (R6) — aucun rapport avec le déploiement.
- **Toute optimisation de build** : régions, cache, ISR, images Vercel. Le site est une vitrine
  SSR pour un seul foyer.

---

## Exécution — 2026-08-10

Le plan a été appliqué tel quel. Ce qui a divergé ou s'est décidé en route :

- **Région : US East, assumée.** Le déploiement `prod` a été créé avant que la question ne se pose,
  et Convex ne sait pas déplacer un déploiement existant : passer en EU voulait dire le supprimer,
  le recréer et refaire ses clés. Le passage aurait aussi coûté la perte des limites incluses plus
  une surcharge de 30 %, pour un site que consulte un seul foyer. Décision : on reste en US, et la
  fonction SSR Vercel reste sur son `iad1` par défaut, cohérent avec le backend.
- **R5 est levé, sans incident.** `convex deploy` installe le composant `@convex-dev/rate-limiter`
  sur un déploiement de production comme sur le dev ; `admin.js:createScan`, qui appelle
  `rateLimiter.limit`, est bien poussé. Aucune manipulation supplémentaire n'a été nécessaire.
- **Le premier déploiement de production est parti du CLI, pas d'un push.** La liaison git a été
  faite après le merge de la PR #7, et Vercel ne construit qu'au push suivant : il n'y en avait
  pas. `vercel deploy --prod` a donc publié le contenu de `main` par le même `vercel.json` et le
  même `CONVEX_DEPLOY_KEY`. Ce que ça ne prouve pas : que le déclencheur git fonctionne. Le premier
  merge suivant sur `main` en fait la preuve.
- **Vérification de production** — `/` répond 200 sans session Vercel, l'URL générée répond 302
  vers l'authentification (la protection est active), l'en-tête `X-Robots-Tag: noindex, nofollow`
  et `<meta name="robots">` sont présents, `/robots.txt` sert bien `Disallow: /`, le bundle porte
  `https://fleet-bat-50.convex.cloud`, et `admin:listScans` refuse un appel sans `adminToken`.
