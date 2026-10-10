/**
 * Multi-account discovery: every local WorkBuddy sign-in, not just the current one.
 *
 * Ported from `dsh-connect-workbuddy` (`src/auth.ts`, MIT, Copyright (c) 2026
 * LaoDing) — see THIRD_PARTY_NOTICES.md. That project extended the same
 * single-file parser this plugin uses to also read the timestamped backups the
 * desktop app leaves behind.
 *
 * Why this is needed: WorkBuddy writes `workbuddy-desktop-ai.info` for the
 * current sign-in and keeps `workbuddy-desktop-ai.<stamp>.<pid>.<uuid>.info`
 * for previous ones. This machine has nine such backups belonging to four
 * different accounts, and every one of them still authenticates. Without a
 * directory scan, a pool has exactly one candidate and the feature is pointless.
 *
 * The rules that matter, each learned the hard way in the source project:
 *
 *   - **The live file always outranks a backup.** It is the app's current
 *     sign-in and the upstream always accepts it.
 *   - **Among backups, issuance time wins — not `expiresAt`.** `expiresAt`
 *     records how long a token was valid FOR at issue time, not whether it is
 *     still accepted. A revoked backup keeps a far-future `expiresAt` and would
 *     otherwise outrank a working credential.
 *   - **Deduplicate by account id**, keeping the freshest file per account, so
 *     one account with nine backups is one pool member rather than nine.
 *
 * @module dsh-workbuddy-connect/account-discovery
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkBuddyCredential } from './auth.ts'
import {
  classifyDesktopAuthDocument,
  openAuthField,
  unwrapDesktopAuthDocument,
} from './desktop-credential-protection.ts'
import type { WorkBuddyVariant } from './variants.ts'
import { desktopAuthCandidatesFor } from './auth.ts'
import { parseCredentialText } from './credential-parse.ts'
import { importedCredentialFiles } from './credential-paths.ts'
import { assignedVariantOf } from './account-assignments.ts'

/** One discovered account, with the file it was read from. */
export interface DiscoveredAccount {
  credential: WorkBuddyCredential
  /** The file this credential was parsed from. */
  filePath: string
  /** Whether this came from the app's live sign-in file. */
  live: boolean
}

/**
 * Stable id for one account: uid plus enterprise, since both scope billing.
 *
 * Typed to accept a partially-formed credential on purpose: a document missing
 * `uid` entirely is exactly the case this must reject, and the caller reading a
 * file cannot promise the field is there.
 */
export function accountIdOf(
  credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId'> | { uid?: unknown, enterpriseId?: unknown },
): string {
  // Falsy rather than `=== ''`: a document missing the field entirely yields
  // `undefined`, and `"undefined:"` would be a real-looking id that silently
  // pools unrelated accounts together.
  const uid = credential.uid
  if (typeof uid !== 'string' || uid === '') return ''
  const enterprise = credential.enterpriseId
  return `${uid}:${typeof enterprise === 'string' ? enterprise : ''}`
}

/**
 * Read one auth file, opening a 5.6 encrypted document when needed.
 *
 * Returns undefined for anything unusable (absent, empty, unparsable, or a
 * wrapper that will not open) rather than throwing: a single bad backup must
 * not abort the whole scan, since the live sign-in may still be fine.
 */
export async function readAuthFile(
  path: string,
  resolveKey: (keyIds: readonly string[]) => Promise<Buffer>,
): Promise<WorkBuddyCredential | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  if (text.trim() === '') return undefined

  const classification = classifyDesktopAuthDocument(text)
  if (classification.format === 'absent' || classification.format === 'unrecognized') return undefined
  if (classification.format === 'plaintext') return parseCredential(text, path)

  // Encrypted: open the wrapped fields, then parse the rebuilt plaintext.
  try {
    const key = await resolveKey(classification.wrapped.fields.map(field => field.envelope.keyId))
    const opened = unwrapDesktopAuthDocument(classification, field => {
      const plaintext = openAuthField(key, field.envelope)
      if (plaintext === undefined) throw new Error(`could not decrypt ${field.field}`)
      return plaintext
    })
    return parseCredential(opened, path)
  } catch {
    // An unreadable backup is skipped, not fatal: it is not the live sign-in.
    return undefined
  }
}

/**
 * Parse a plaintext auth document.
 *
 * Delegates to the shared reader so discovery and the import feature cannot
 * disagree about what a file says.
 */
function parseCredential(text: string, filePath: string): WorkBuddyCredential | undefined {
  return parseCredentialText(text, filePath)
}

/**
 * Timestamped siblings of one auth file, newest first by filename.
 *
 * The names embed an ISO timestamp, so a plain reverse sort is newest-first.
 * An unreadable directory yields no backups; the live file alone is still read.
 */
export async function backupsBeside(path: string): Promise<string[]> {
  const dir = dirname(path)
  const base = path.slice(dir.length + 1)
  const prefix = base.replace(/\.info$/u, '')
  try {
    const entries = await readdir(dir)
    return entries
      .filter(name => name !== base && name.startsWith(`${prefix}.`) && name.endsWith('.info'))
      .sort()
      .reverse()
      .map(name => join(dir, name))
  } catch {
    return []
  }
}

/** Whether a credential came from the app's live sign-in file. */
function fileRank(path: string, livePaths: readonly string[]): number {
  return livePaths.includes(path) ? 0 : 1
}

/**
 * Whether `candidate` beats `incumbent` for the SAME account.
 *
 * Ordering, strongest signal first:
 *  1. the live sign-in file;
 *  2. the most recent `lastRefreshAtMs` — upstream's own issuance time;
 *  3. `expiresAtMs`, only as a fallback for documents that omit the field.
 *
 * Step 2 is what makes this correct, for the reason in the module note.
 */
function isFresher(
  candidate: DiscoveredAccount,
  incumbent: DiscoveredAccount,
  livePaths: readonly string[],
): boolean {
  const rankDiff = fileRank(candidate.filePath, livePaths) - fileRank(incumbent.filePath, livePaths)
  if (rankDiff !== 0) return rankDiff < 0

  const candidateRefresh = (candidate.credential as { lastRefreshAtMs?: number }).lastRefreshAtMs
  const incumbentRefresh = (incumbent.credential as { lastRefreshAtMs?: number }).lastRefreshAtMs
  if (candidateRefresh !== undefined && incumbentRefresh !== undefined) {
    if (candidateRefresh !== incumbentRefresh) return candidateRefresh > incumbentRefresh
  } else if (candidateRefresh !== undefined) {
    // A file that records its issuance time outranks one that does not.
    return true
  } else if (incumbentRefresh !== undefined) {
    return false
  }
  return candidate.credential.expiresAtMs > incumbent.credential.expiresAtMs
}

/**
 * Discover every local account for one variant, deduplicated by account id.
 *
 * Newest-first scanning means the first entry for an account is normally its
 * freshest file, but {@link isFresher} decides explicitly so a live file always
 * wins even when a backup sorts earlier.
 *
 * @param variant       which product's files to scan.
 * @param resolveKey    opens the at-rest key for the given envelope key ids.
 * @param explicitPath  a configured path, used verbatim instead of the defaults.
 */
export async function discoverAccounts(
  variant: WorkBuddyVariant,
  resolveKey: (keyIds: readonly string[]) => Promise<Buffer>,
  explicitPath?: string,
): Promise<DiscoveredAccount[]> {
  const livePaths = explicitPath === undefined
    ? desktopAuthCandidatesFor(variant)
    : [explicitPath]

  const files: string[] = []
  for (const live of livePaths) {
    files.push(live)
    for (const backup of await backupsBeside(live)) files.push(backup)
  }
  // Imported credentials are scanned alongside the app's own directory, but only
  // when no explicit path was given: an explicit path means "read exactly this
  // file", which is what the import UI uses to verify one credential in
  // isolation and what a configured `authFile` expects.
  if (explicitPath === undefined) {
    for (const imported of importedCredentialFiles()) files.push(imported)
  }

  const byId = new Map<string, DiscoveredAccount>()
  for (const file of files) {
    const credential = await readAuthFile(file, resolveKey)
    if (credential === undefined) continue
    const id = accountIdOf(credential)
    // An account with no uid cannot be pooled: it has no stable identity, so
    // two files without one would collapse into a single member.
    if (id === '') continue
    // Imported files are visible to BOTH variants' scans (the import directory
    // is shared and a credential never names its product), so an account would
    // otherwise serve under both model groups at once. The assignment table is
    // the per-account answer; an unassigned account takes the configured
    // default (WorkBuddy AI). Desktop-file paths keep the live sign-in where
    // the app wrote it — the assignment governs imported accounts, which have
    // no app of their own.
    if (livePaths.includes(file) === false && assignedVariantOf(id) !== variant.id) continue
    const found: DiscoveredAccount = {
      credential,
      filePath: file,
      live: livePaths.includes(file),
    }
    const existing = byId.get(id)
    if (existing === undefined || isFresher(found, existing, livePaths)) byId.set(id, found)
  }
  return [...byId.values()]
}

/**
 * Imported credentials are listed by {@link importedCredentialFiles} in
 * `credential-paths.ts` (shared with the credential store, which must not
 * import this module). They are scanned alongside the app's own directory,
 * but only when no explicit path was given: an explicit path means "read
 * exactly this file", which is what the import UI uses to verify one
 * credential in isolation and what a configured `authFile` expects.
 */
