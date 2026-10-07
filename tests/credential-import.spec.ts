/**
 * Credential import.
 *
 * The rules worth pinning are about what must NOT happen: an unreadable file
 * must be refused rather than stored (a stored file that discovery then skips is
 * a silent failure the user cannot diagnose), and a re-import of the same
 * account must replace rather than duplicate.
 *
 * These run against a real temp `$DSH_HOME`, because the storage path is part of
 * the behaviour — a credential that lands somewhere discovery does not scan is
 * imported but unusable.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  importedCredentialPath,
  importCredentialText,
  listImportedCredentials,
  removeImportedCredential,
  workbuddyImportedDir,
} from '../src/credential-import.ts'
import { discoverAccounts } from '../src/account-discovery.ts'
import { AI_VARIANT } from '../src/variants.ts'

let home: string
const savedDshHome = process.env['DSH_HOME']

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wb-import-'))
  process.env['DSH_HOME'] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (savedDshHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = savedDshHome
})

/** A plaintext credential document. */
function credentialText(uid: string, nickname: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    auth: {
      accessToken: `token-${uid}`,
      refreshToken: `refresh-${uid}`,
      expiresAt: 2_000_000_000_000,
      domain: 'www.workbuddy.ai',
      ...extra,
    },
    account: { uid, nickname },
  })
}

/** A key provider that must never be called for a plaintext credential. */
const noKey = async (): Promise<Buffer> => { throw new Error('plaintext must not need a key') }

describe('importing a plaintext credential', () => {
  it('stores it and reports the account', async () => {
    const result = await importCredentialText(credentialText('u1', 'One'), noKey)
    expect(result.state).toBe('ok')
    expect(result.accountId).toBe('u1:')
    expect(result.accountName).toBe('One')
    expect(result.replaced).toBeUndefined()
    expect(existsSync(result.path as string)).toBe(true)
  })

  it('stores the bytes verbatim, not a re-serialized form', async () => {
    // Re-encoding would risk dropping a field the parser tolerates but the
    // upstream needs; keeping the original means the stored file is exactly as
    // safe as the file it came from.
    const text = credentialText('u1', 'One')
    const result = await importCredentialText(text, noKey)
    expect(readFileSync(result.path as string, 'utf8')).toBe(text)
  })

  it('replaces rather than duplicates when the same account is imported again', async () => {
    await importCredentialText(credentialText('u1', 'First'), noKey)
    const second = await importCredentialText(credentialText('u1', 'Second'), noKey)
    expect(second.replaced).toBe(true)
    expect((await listImportedCredentials(noKey))).toHaveLength(1)
  })

  it('keeps two different accounts as two files', async () => {
    await importCredentialText(credentialText('u1', 'One'), noKey)
    await importCredentialText(credentialText('u2', 'Two'), noKey)
    const listed = await listImportedCredentials(noKey)
    expect(listed.map(entry => entry.accountId).sort()).toEqual(['u1:', 'u2:'])
  })

  it('accepts the flat legacy shape as well', async () => {
    const flat = JSON.stringify({
      accessToken: 'token-flat', refreshToken: 'r', expiresAt: 2_000_000_000_000,
      domain: 'www.workbuddy.ai', uid: 'flat', nickname: 'Flat',
    })
    const result = await importCredentialText(flat, noKey)
    expect(result.state).toBe('ok')
    expect(result.accountId).toBe('flat:')
  })
})

describe('refusing what cannot work', () => {
  it('refuses an empty file', async () => {
    expect((await importCredentialText('   ', noKey)).state).toBe('failed')
  })

  it('refuses text that is not a credential', async () => {
    const result = await importCredentialText('hello world', noKey)
    expect(result.state).toBe('failed')
    expect(result.reason).toContain('not a WorkBuddy credential')
  })

  it('refuses a document with no access token', async () => {
    const result = await importCredentialText(JSON.stringify({ account: { uid: 'u1' } }), noKey)
    expect(result.state).toBe('failed')
    expect(result.reason).toContain('no access token')
  })

  it('refuses a document with no account id, which cannot be pooled', async () => {
    // Without a uid two such files would collapse into one member.
    const result = await importCredentialText(credentialText('', 'Anonymous'), noKey)
    expect(result.state).toBe('failed')
    expect(result.reason).toContain('no account id')
  })

  it('refuses an unopenable encrypted credential INSTEAD of storing it', async () => {
    // The whole point: storing it would leave a file that every later scan
    // silently skips, which the user cannot diagnose from the UI.
    //
    // The wrapper is the real 5.6 shape — `$wbEncrypted: 1` plus a base64
    // `envelope` carrying suite, keyId, and the base64 parts — because anything
    // else is classified `unrecognized` and would exercise the wrong branch.
    const envelope = Buffer.from(JSON.stringify({
      suite: 1,
      keyId: 'deadbeefdeadbeef',
      nonce: Buffer.alloc(12).toString('base64'),
      authTag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.from('not really encrypted').toString('base64'),
    })).toString('base64')
    const sealed = JSON.stringify({
      auth: { accessToken: { $wbEncrypted: 1, envelope } },
      account: { uid: 'u1' },
    })
    const result = await importCredentialText(sealed, noKey)
    expect(result.state).toBe('failed')
    expect(result.reason).toContain('could not be opened')
    expect(existsSync(workbuddyImportedDir())).toBe(false)
  })

  it('stores nothing at all when every attempt fails', async () => {
    await importCredentialText('nonsense', noKey)
    await importCredentialText('', noKey)
    expect(await listImportedCredentials(noKey)).toEqual([])
  })
})

describe('the storage path', () => {
  it('sanitises the account id so a colon cannot break Windows', () => {
    const path = importedCredentialPath('uid-1:ent-2')
    expect(path).not.toContain(':ent-2')
    expect(path.endsWith('.info')).toBe(true)
  })

  it('gives two accounts two different paths', () => {
    expect(importedCredentialPath('a:')).not.toBe(importedCredentialPath('b:'))
  })

  it('lands under the DSH home, not a relative path', () => {
    expect(workbuddyImportedDir().startsWith(home)).toBe(true)
  })
})

describe('listing and removal', () => {
  it('is empty before anything is imported', async () => {
    expect(await listImportedCredentials(noKey)).toEqual([])
  })

  it('reports a stored file that no longer opens instead of hiding it', async () => {
    // It must stay visible so the user can remove it; a silently dropped row
    // would leave an undeletable file behind.
    await importCredentialText(credentialText('u1', 'One'), noKey)
    writeFileSync(importedCredentialPath('u1:'), 'corrupted', 'utf8')
    const listed = await listImportedCredentials(noKey)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.readable).toBe(false)
    expect(listed[0]?.reason).toBeDefined()
  })

  it('removes by account id', async () => {
    await importCredentialText(credentialText('u1', 'One'), noKey)
    expect(removeImportedCredential('u1:')).toBe(true)
    expect(await listImportedCredentials(noKey)).toEqual([])
  })

  it('reports removing something that is not there', () => {
    expect(removeImportedCredential('never-imported:')).toBe(false)
  })

  it('ignores files that are not .info', async () => {
    await importCredentialText(credentialText('u1', 'One'), noKey)
    writeFileSync(join(workbuddyImportedDir(), 'notes.txt'), 'ignore me', 'utf8')
    expect(await listImportedCredentials(noKey)).toHaveLength(1)
  })
})

describe('discovery sees an imported credential', () => {
  it('finds it, so an import is actually usable', async () => {
    // This is the end that matters: imported but not discovered would be a
    // feature that stores a file and changes nothing.
    const before = await discoverAccounts(AI_VARIANT, noKey, undefined)
    await importCredentialText(credentialText('imported-uid', 'Imported'), noKey)
    const after = await discoverAccounts(AI_VARIANT, noKey, undefined)
    const ids = after.map(account => account.credential.uid)
    expect(ids).toContain('imported-uid')
    // The machine's own accounts are unaffected.
    expect(after.length).toBeGreaterThanOrEqual(before.length + 1)
  })

  it('does NOT scan imports when an explicit path is given', async () => {
    // An explicit path means "read exactly this file" — which is what verifying
    // one credential in isolation relies on.
    await importCredentialText(credentialText('imported-uid', 'Imported'), noKey)
    const explicit = join(home, 'one.info')
    writeFileSync(explicit, credentialText('explicit-uid', 'Explicit'))
    const found = await discoverAccounts(AI_VARIANT, noKey, explicit)
    expect(found.map(account => account.credential.uid)).toEqual(['explicit-uid'])
  })
})
