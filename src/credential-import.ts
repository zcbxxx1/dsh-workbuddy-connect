/**
 * Imported credentials: a user-supplied auth `.info` copied into the plugin's
 * own storage so it survives independently of the WorkBuddy app.
 *
 * Why this exists. Discovery reads the desktop app's directory, so a credential
 * only works while that app keeps the file. A user who has an `.info` from
 * another machine, or who wants an account the app no longer signs in, has
 * nowhere to put it. Importing copies the file into `$DSH_HOME` and reads it
 * from there, which also means the file cannot be clobbered by the app's own
 * rotation.
 *
 * Two rules shape the implementation:
 *
 *   1. **Validate before storing.** The bytes are parsed and, when they are a
 *      5.6 envelope, opened — so a file that cannot produce a credential is
 *      refused at import time with a reason, rather than being stored and then
 *      silently skipped by discovery on every later scan.
 *
 *   2. **One file per account, named by account id.** A second import of the
 *      same account replaces the first instead of adding a duplicate that the
 *      pool would then have to de-duplicate. The name is sanitised because an
 *      account id is not a filesystem-safe string by construction.
 *
 * @module dsh-workbuddy-connect/credential-import
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accountIdOf } from './account-discovery.ts'
import {
  classifyDesktopAuthDocument,
  openAuthField,
  unwrapDesktopAuthDocument,
} from './desktop-credential-protection.ts'
import { parseCredentialText } from './credential-parse.ts'
import { importedCredentialPath, workbuddyImportedDir } from './credential-paths.ts'

export { importedCredentialPath, workbuddyImportedDir } from './credential-paths.ts'

/** The outcome of one import. */
export interface WorkBuddyImportResult {
  state: 'ok' | 'failed'
  /** The account the file describes, present on success. */
  accountId?: string
  accountName?: string
  /** Where it was stored, present on success. */
  path?: string
  /** Whether an existing file for the same account was replaced. */
  replaced?: boolean
  /** Why it was refused, present on failure. */
  reason?: string
}

/**
 * Import one credential from raw file text.
 *
 * Text rather than a path because the caller may have received the bytes from a
 * paste or an upload; the plugin never needs to know where they came from.
 */
export async function importCredentialText(
  text: string,
  resolveKey: (keyIds: readonly string[]) => Promise<Buffer>,
): Promise<WorkBuddyImportResult> {
  if (text.trim() === '') return { state: 'failed', reason: 'the file is empty' }

  const classification = classifyDesktopAuthDocument(text)
  if (classification.format === 'absent') return { state: 'failed', reason: 'the file is empty' }
  if (classification.format === 'unrecognized') {
    return {
      state: 'failed',
      reason: 'not a WorkBuddy credential: neither a readable auth document nor a decodable 5.6 envelope',
    }
  }

  // Open first, store second: a file this build cannot read must be refused now,
  // not stored and then skipped by every later scan.
  let plaintext = text
  if (classification.format === 'encrypted') {
    try {
      const key = await resolveKey(classification.wrapped.fields.map(field => field.envelope.keyId))
      plaintext = unwrapDesktopAuthDocument(classification, field => {
        const opened = openAuthField(key, field.envelope)
        if (opened === undefined) throw new Error(`could not decrypt ${field.field}`)
        return opened
      })
    } catch (error: unknown) {
      return {
        state: 'failed',
        reason: `the encrypted credential could not be opened (${error instanceof Error ? error.message : String(error)})`,
      }
    }
  }

  const credential = parseCredentialText(plaintext)
  if (credential === undefined) {
    return { state: 'failed', reason: 'the file carries no access token' }
  }
  const accountId = accountIdOf(credential)
  if (accountId === '') {
    return { state: 'failed', reason: 'the file carries no account id, so it cannot be told apart from another account' }
  }

  const dir = workbuddyImportedDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = importedCredentialPath(accountId)
  const replaced = existsSync(path)

  // Stored as the ORIGINAL text, not the decrypted form: re-encrypting would
  // require the app's key at write time, and writing plaintext would downgrade
  // a sealed credential to a readable one on disk. Keeping the bytes verbatim
  // means the stored file is exactly as safe as the file it came from.
  writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 })
  return {
    state: 'ok',
    accountId,
    ...credential.nickname === undefined ? {} : { accountName: credential.nickname },
    path,
    ...replaced ? { replaced: true } : {},
  }
}

/** One imported credential, as a listing shows it. */
export interface WorkBuddyImportedEntry {
  path: string
  accountId: string
  accountName?: string
  /** Whether the stored file still opens. */
  readable: boolean
  /** Why it does not, when it does not. */
  reason?: string
}

/** List every imported credential, reporting unreadable files rather than hiding them. */
export async function listImportedCredentials(
  resolveKey: (keyIds: readonly string[]) => Promise<Buffer>,
): Promise<WorkBuddyImportedEntry[]> {
  const dir = workbuddyImportedDir()
  if (!existsSync(dir)) return []

  const entries: WorkBuddyImportedEntry[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.info')) continue
    const path = join(dir, name)
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (error: unknown) {
      entries.push({ path, accountId: '', readable: false, reason: String(error) })
      continue
    }
    const imported = await importableAccount(text, resolveKey)
    entries.push(imported === undefined
      ? { path, accountId: '', readable: false, reason: 'the stored file no longer opens' }
      : { path, accountId: imported.accountId, ...imported.accountName === undefined ? {} : { accountName: imported.accountName }, readable: true })
  }
  return entries
}

/** Remove one imported credential by account id. */
export function removeImportedCredential(accountId: string): boolean {
  const path = importedCredentialPath(accountId)
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

/** Read an account id and name out of credential text, or undefined. */
async function importableAccount(
  text: string,
  resolveKey: (keyIds: readonly string[]) => Promise<Buffer>,
): Promise<{ accountId: string, accountName?: string } | undefined> {
  const classification = classifyDesktopAuthDocument(text)
  if (classification.format === 'absent' || classification.format === 'unrecognized') return undefined
  let plaintext = text
  if (classification.format === 'encrypted') {
    try {
      const key = await resolveKey(classification.wrapped.fields.map(field => field.envelope.keyId))
      plaintext = unwrapDesktopAuthDocument(classification, field => {
        const opened = openAuthField(key, field.envelope)
        if (opened === undefined) throw new Error('unreadable')
        return opened
      })
    } catch {
      return undefined
    }
  }
  const credential = parseCredentialText(plaintext)
  if (credential === undefined) return undefined
  const accountId = accountIdOf(credential)
  if (accountId === '') return undefined
  return {
    accountId,
    ...credential.nickname === undefined ? {} : { accountName: credential.nickname },
  }
}
