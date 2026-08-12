import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import appCss from '../styles/app.css?url'

// The context is typed here, otherwise route loaders cannot see `queryClient`.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // Scoping decision from the spec: the storefront is not indexed.
        { name: 'robots', content: 'noindex, nofollow' },
        // Without it the mobile browser bar stays white against the warm paper and the object
        // stops dead at the edge of the screen.
        { name: 'theme-color', content: '#F7F3EA' },
        { title: 'La table des recettes' },
      ],
      links: [
        // The .ico comes first among the icons: some browsers take the first one they can read.
        { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossOrigin: 'anonymous',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Atkinson+Hyperlegible+Next:wght@400..700&display=swap',
        },
        { rel: 'stylesheet', href: appCss },
      ],
    }),
    shellComponent: RootDocument,
  },
)

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}

        <Scripts />
      </body>
    </html>
  )
}
