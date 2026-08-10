// The Convex runtime exposes `process.env`, but not the rest of Node. Pulling all of
// `@types/node` would type-check `fs` or `path`, which would crash at runtime.
declare const process: { env: Record<string, string | undefined> }
