/**
 * Parse a plaintext WorkBuddy auth document into a credential.
 *
 * Extracted from `account-discovery.ts` so discovery and the import feature
 * share one reader. Two readers of the same on-disk shape would drift, and the
 * symptom would be an imported credential that lists correctly but is skipped
 * by the pool — a difference no test would attribute to the parser.
 *
 * Kept separate from `auth.ts`'s `parseWorkBuddyAuth` on purpose: the store
 * answers "which account is current" (with its own precedence and region
 * rules), while this answers "what does this one file say".
 *
 * @module dsh-workbuddy-connect/credential-parse
 */

import type { WorkBuddyCredential } from './auth.ts'

/** A parsed credential, plus where it was read from. */
export type ParsedCredential = WorkBuddyCredential & {
  filePath?: string
  /** Upstream's own issuance time, when the document records one. */
  lastRefreshAtMs?: number
}

/**
 * Parse one plaintext auth document.
 *
 * Accepts both on-disk shapes: the 5.6 document (`auth` + `account`) and the
 * legacy flat one, where the same object is both.
 *
 * Returns undefined when the text is not JSON, is not an object, or carries no
 * access token — the three cases a caller can do nothing about.
 */
export function parseCredentialText(text: string, filePath?: string): ParsedCredential | undefined {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return undefined
  const record = document as Record<string, unknown>
  const auth = typeof record['auth'] === 'object' && record['auth'] !== null
    ? record['auth'] as Record<string, unknown>
    : record
  const account = typeof record['account'] === 'object' && record['account'] !== null
    ? record['account'] as Record<string, unknown>
    : record

  const accessToken = typeof auth['accessToken'] === 'string' ? auth['accessToken'] : ''
  if (accessToken === '') return undefined

  const expiresAtMs = typeof auth['expiresAt'] === 'number' ? auth['expiresAt'] : 0
  const refreshExpiresAtMs = typeof auth['refreshExpiresAt'] === 'number' ? auth['refreshExpiresAt'] : undefined
  const lastRefreshAtMs = typeof auth['lastRefreshTime'] === 'number' ? auth['lastRefreshTime'] : undefined
  const uid = typeof account['uid'] === 'string' ? account['uid'] : ''
  const enterpriseId = typeof account['enterpriseId'] === 'string' && account['enterpriseId'] !== ''
    ? account['enterpriseId']
    : undefined
  const nickname = typeof account['nickname'] === 'string' && account['nickname'] !== ''
    ? account['nickname']
    : undefined
  const domain = typeof auth['domain'] === 'string' ? auth['domain'] : ''

  return {
    accessToken,
    refreshToken: typeof auth['refreshToken'] === 'string' ? auth['refreshToken'] : '',
    expiresAtMs,
    ...refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs },
    domain,
    uid,
    ...enterpriseId === undefined ? {} : { enterpriseId },
    ...nickname === undefined ? {} : { nickname },
    source: 'desktop',
    // Carried so the pool can rank backups by issuance time.
    ...lastRefreshAtMs === undefined ? {} : { lastRefreshAtMs },
    ...filePath === undefined ? {} : { filePath },
  }
}
