import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { BACKUP_FORMAT_VERSION } from '../src/shared/backup-schema'
import type { BackupRecipe } from '../src/shared/backup-schema'

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
}

export async function bearerTokenMatches({
  authorization,
  expectedToken,
}: {
  authorization: string | null
  expectedToken: string | undefined
}): Promise<boolean> {
  if (!authorization || !expectedToken) return false
  const [actualDigest, expectedDigest] = await Promise.all([
    digest(authorization),
    digest(`Bearer ${expectedToken}`),
  ])
  let difference = 0
  for (const [index, actualByte] of actualDigest.entries()) {
    difference |= actualByte ^ (expectedDigest.at(index) ?? 0)
  }
  return difference === 0
}

export async function createBackupResponse({
  request,
  expectedToken,
  loadRecipes,
  now = () => new Date(),
}: {
  request: Request
  expectedToken: string | undefined
  loadRecipes: () => Promise<BackupRecipe[]>
  now?: () => Date
}): Promise<Response> {
  if (
    !(await bearerTokenMatches({
      authorization: request.headers.get('Authorization'),
      expectedToken,
    }))
  ) {
    return new Response(null, { status: 401 })
  }

  const recipes = await loadRecipes()
  return Response.json(
    {
      formatVersion: BACKUP_FORMAT_VERSION,
      generatedAt: now().toISOString(),
      recipes,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    },
  )
}

export const backupEndpoint = httpAction(async (ctx, request) =>
  createBackupResponse({
    request,
    expectedToken: process.env.BACKUP_TOKEN,
    loadRecipes: () => ctx.runQuery(internal.export.backupPayload, {}),
  }),
)

const http = httpRouter()
http.route({ path: '/backup', method: 'GET', handler: backupEndpoint })

export default http
