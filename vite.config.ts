import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, searchForWorkspaceRoot } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

const projectRoot = process.cwd()
const nodeModules = resolve(projectRoot, 'node_modules')

// A git worktree symlinks node_modules to the main checkout, so its real path falls outside the
// workspace root Vite derives on its own, and Vite 8 then refuses to read the plugin entry files
// it resolves there — `vite dev` dies on ERR_LOAD_URL for files that plainly exist. Allowing the
// resolved node_modules is a no-op in the main checkout, where it already sits under the root.
const fsAllow = [searchForWorkspaceRoot(projectRoot)]
if (existsSync(nodeModules)) fsAllow.push(realpathSync(nodeModules))

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: { fs: { allow: fsAllow } },
  plugins: [
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),

    tanstackStart(),
    viteReact(),
  ],
})

export default config
