/**
 * Where imported credentials live.
 *
 * Split into its own module so both the import feature and the discovery scan
 * can name the directory without importing each other: discovery must scan it,
 * and the importer must write it, and a direct import between those two would
 * be a cycle.
 *
 * @module dsh-workbuddy-connect/credential-paths
 */

import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Directory holding every imported credential, under `$DSH_HOME`. */
export function workbuddyImportedDir(): string {
  return join(resolveDshHome(), '.workbuddy-imported')
}

/** Absolute path one account's imported file occupies. */
export function importedCredentialPath(accountId: string): string {
  // An account id is `uid:enterpriseId`. A colon is legal on POSIX but not on
  // Windows, so it is replaced rather than escaped — the name only has to be
  // unique and readable, and the id is re-derived from the file's contents on
  // every read, never from the name.
  const safe = accountId.replace(/[^A-Za-z0-9._-]/gu, '_')
  return join(workbuddyImportedDir(), `${safe}.info`)
}

/**
 * The account-assignment table, under `$DSH_HOME`.
 *
 * An imported credential is discovered by BOTH variants, because discovery
 * scans the shared import directory per variant and a credential file never
 * says which product it belongs to. The assignment table is the per-account
 * answer: it names the one variant whose model group and default resolution
 * an account serves in, and it underwrites the "default to WorkBuddy AI"
 * preference for accounts nobody has assigned explicitly.
 */
export function workbuddyAssignmentsPath(): string {
  return join(resolveDshHome(), '.workbuddy-account-assignments.json')
}

/**
 * Every `.info` file in the imported-credential directory.
 *
 * Lives beside the directory helper (rather than in `account-discovery`) so
 * the credential store can scan imports too without importing the discovery
 * module — discovery already imports this module, so the other direction
 * would be a cycle. A missing or unreadable directory yields nothing: the
 * app's own files are still read, and an absent import directory is the
 * normal state.
 */
export function importedCredentialFiles(): string[] {
  try {
    const dir = workbuddyImportedDir()
    return readdirSync(dir)
      .filter(name => name.endsWith('.info'))
      .map(name => join(dir, name))
  } catch {
    return []
  }
}
