# socle-et-vitrine

A minimal TanStack Start app with one route and plain CSS.

```bash
npm install
npm run dev
```

Edit `src/routes/index.tsx` to get started. Add route files under
`src/routes`; TanStack Router updates `src/routeTree.gen.ts` for you.

Build the production app with:

```bash
npm run build
```

## Déploiement

La production vit sur Vercel, le backend sur Convex, et les deux sont poussés par la même
commande. C'est `vercel.json` qui la porte :

```
npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL
```

`convex deploy` pousse les fonctions sur le déploiement Convex désigné par `CONVEX_DEPLOY_KEY`,
injecte son URL dans `VITE_CONVEX_URL`, puis lance le build du frontend. Un push sur `main`
déclenche la production.

Nitro n'a **pas** de preset épinglé : il reconnaît Vercel tout seul. Hors Vercel, le même
`npm run build` produit donc un serveur Node autonome, lançable par `node dist/server/index.mjs`
sur n'importe quel hébergeur compatible. Voir https://v3.nitro.build/deploy pour les autres
presets.

Les previews ne se déclenchent pas toutes seules : `vercel.json` annule tout build git qui n'est
pas la production, et poser le label `preview` sur une pull request lance
`.github/workflows/preview.yml`, qui crée un backend Convex jetable, y copie la base de production
et publie un frontend. Le tout expire au bout de 5 jours.

La procédure d'installation initiale — création du déploiement Convex de production, variables
d'environnement, secrets GitHub, protection de déploiement Vercel — est décrite dans
[`docs/superpowers/plans/2026-08-10-t12-deploiement/PLAN.md`](./docs/superpowers/plans/2026-08-10-t12-deploiement/PLAN.md).
