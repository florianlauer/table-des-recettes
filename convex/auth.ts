import { ConvexError } from 'convex/values'

type AdminEnvironment = { ADMIN_TOKEN?: string }

export function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

export function requireAdmin(
  adminToken: string,
  environment: AdminEnvironment = process.env,
): void {
  const expected = environment.ADMIN_TOKEN
  if (!expected || !constantTimeEqual(adminToken, expected)) {
    // ConvexError, otherwise production masks the message as "Server Error".
    throw new ConvexError('Accès administrateur refusé')
  }
}
