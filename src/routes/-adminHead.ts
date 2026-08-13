import adminCss from '../styles/admin.css?url'

/**
 * The register's stylesheet, asked for by the routes that need it rather than by the root: a reader
 * never opens `/admin*` and has no use for 500 lines dressing a work bench. The three admin routes
 * are siblings and not children — `admin_` breaks the nesting on purpose — so each one asks.
 */
export const adminHead = () => ({
  links: [{ rel: 'stylesheet', href: adminCss }],
})
