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
