import { ConvexQueryClient } from '@convex-dev/react-query'
import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter, useRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { ConvexProvider } from 'convex/react'
import { routeTree } from './routeTree.gen'

/**
 * Convex being unreachable rejects the loader, and without this the route throws into the
 * void: a blank page in production. Names what failed and offers the only useful recovery.
 */
function LoadFailed() {
  const router = useRouter()
  return (
    <main className="page failure">
      {/* An anonymous page of one sentence gives no clue where one has landed. The masthead
          at reduced scale is enough to recognise the object. */}
      <p className="failure__site">La table des recettes</p>
      <p className="failure__line">Les recettes n'ont pas pu être chargées.</p>
      <button className="failure__retry" onClick={() => void router.invalidate()}>
        Réessayer
      </button>
    </main>
  )
}

/** Shown only past the router's delay, so a fast load never flashes it. */
function Loading() {
  return (
    <main className="page">
      <p className="empty" role="status">
        Chargement…
      </p>
    </main>
  )
}

export function getRouter() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
  if (!convexUrl) throw new Error('VITE_CONVEX_URL absent — lancer `npx convex dev`')

  // Router and clients are all three born here, never at module level: a `QueryClient`
  // created at import time would be shared across every request the server handles.
  const convexQueryClient = new ConvexQueryClient(convexUrl)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: LoadFailed,
    defaultPendingComponent: Loading,
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>{children}</ConvexProvider>
    ),
  })

  // Without this integration the loader fills a server cache the client throws away:
  // the page re-downloads in full on hydration.
  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
