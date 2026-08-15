import { convexQuery } from '@convex-dev/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server'
import { adminTokenState } from './adminToken'
import { dataView } from './dataView'
import type { DataView } from './dataView'

/** Every admin query is token-bound; what it takes on top of the token is its own business. */
type AdminQuery = FunctionReference<'query'> & {
  _args: { adminToken: string }
}

type OwnArgs<TQuery extends AdminQuery> = Omit<
  FunctionArgs<TQuery>,
  'adminToken'
>

/**
 * The args a token-bound query goes out with, or the literal that stops it going out at all.
 *
 * `enabled: false` does not stop `@convex-dev/react-query` from subscribing — it watches the cache
 * "added" event and only honours a literal `'skip'`. Gating with `enabled` sent an empty token to
 * the server, which answered with an opaque « Server Error » in production. There is one gate now,
 * and it is this one.
 */
export function adminQueryArgs<TQuery extends AdminQuery>(
  token: string | null,
  args: OwnArgs<TQuery>,
): FunctionArgs<TQuery> | 'skip' {
  // `null` is the token still being read out of browser storage, and it skips like an empty one:
  // asking with no token would only earn an error the operator cannot act on.
  // The token is spread last: a query that happens to name an argument `adminToken` does not get to
  // decide what the call is authenticated with.
  return token ? { ...args, adminToken: token } : 'skip'
}

/**
 * What a section is looking at, and the one thing it can do about it. Asking again is part of the
 * answer: a failed view is rendered with a « Réessayer » next to it, so the two travel together.
 */
export type AdminQueryView<T> = DataView<T> & { refetch: () => Promise<void> }

/**
 * One token-bound admin query, from the token to what the section is looking at.
 *
 * The three routes each wrote the same five facts by hand — skip on an empty token, never retry,
 * keep the previous answer, coerce the token's three states down to `tokenAbsent`, then fold
 * `isLoading` / `error` / `data` into a `DataView`. Five chances to disagree, and two of them had
 * already been frozen into tests that read the routes' own source looking for the incantation.
 *
 * `placeholderData` is not a preference here. A query argument that is also local state changes the
 * query key while the screen is open, react-query answers an unseen key with `undefined`, and the
 * photo screen collapsed to a single line — every native `<details>` came back as a new node, which
 * is to say closed. Keeping the previous answer is what makes a fold survive its own query. A
 * cleared token still empties the screen: `dataView` reads `tokenAbsent` before it reads the data.
 */
export function useAdminQuery<TQuery extends AdminQuery>(
  token: string | null,
  query: TQuery,
  args: OwnArgs<TQuery>,
): AdminQueryView<FunctionReturnType<TQuery>> {
  const result = useQuery({
    ...convexQuery(query, adminQueryArgs<TQuery>(token, args)),
    // A rejected token is not a transient failure, and every retry is another round trip the
    // operator waits through before being told the thing they can actually fix.
    retry: false,
    placeholderData: keepPreviousData,
  })
  const view = dataView({
    tokenAbsent: adminTokenState(token) === 'absent',
    loading: result.isLoading,
    error: result.error,
    data: result.data,
  })
  return {
    ...view,
    refetch: async () => {
      await result.refetch()
    },
  }
}
