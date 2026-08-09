// Le runtime Convex expose `process.env`, mais pas le reste de Node. Tirer `@types/node`
// entier ferait type-checker `fs` ou `path`, qui planteraient à l'exécution.
declare const process: { env: Record<string, string | undefined> };
