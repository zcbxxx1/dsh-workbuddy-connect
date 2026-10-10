import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverAccounts } from '../src/account-discovery.ts'
import { assignAccount } from '../src/account-assignments.ts'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'

/**
 * Imported accounts serve in exactly ONE variant — the assignment table's
 * answer, defaulting to WorkBuddy AI. Without the filter, discovery scanned
 * the shared import directory for both variants and one account appeared in
 * both model groups at once.
 *
 * `discoverAccounts` derives its scan roots from `process.platform`/`homedir`
 * (live files) and `$DSH_HOME` (imports), so both are stubbed per case.
 */

const dirs: string[] = []
const realPlatform = process.platform
const savedEnv = {
  HOME: process.env['HOME'],
  USERPROFILE: process.env['USERPROFILE'],
  XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'],
  XDG_DATA_HOME: process.env['XDG_DATA_HOME'],
}

afterEach(() => {
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }))
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.unstubAllEnvs()
})

function stubPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function stubHome(home: string): void {
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
  delete process.env['XDG_CONFIG_HOME']
  delete process.env['XDG_DATA_HOME']
}

/** A plaintext credential for one account, global region (the import default's product). */
function document(uid: string): string {
  return JSON.stringify({
    auth: { accessToken: `t-${uid}`, refreshToken: `r-${uid}`, expiresAt: 2_000_000_000_000, domain: 'www.workbuddy.ai' },
    account: { uid, nickname: `nick-${uid}` },
  })
}

/**
 * Set up a world with one imported credential and no live sign-in, returning
 * the imported file's path. Imports land under `$DSH_HOME`, live files under
 * the platform auth directory; here only the import exists.
 */
function worldWithImport(uid: string): { dshHome: string, importedPath: string } {
  const home = mkdtempSync(join(tmpdir(), 'wb-imp-home-'))
  dirs.push(home)
  const dshHome = mkdtempSync(join(tmpdir(), 'wb-imp-dsh-'))
  dirs.push(dshHome)
  stubPlatform('linux')
  stubHome(home)
  vi.stubEnv('DSH_HOME', dshHome)
  const importedDir = join(dshHome, '.workbuddy-imported')
  mkdirSync(importedDir, { recursive: true })
  const importedPath = join(importedDir, 'imported.info')
  writeFileSync(importedPath, document(uid))
  return { dshHome, importedPath }
}

const noKey = async (): Promise<Buffer> => { throw new Error('no encrypted field in these fixtures') }

describe('imported accounts serve one variant', () => {
  it('defaults an unassigned import to WorkBuddy AI', async () => {
    worldWithImport('u-import')
    const ai = await discoverAccounts(AI_VARIANT, noKey)
    const cn = await discoverAccounts(CN_VARIANT, noKey)
    expect(ai.map(account => account.credential.uid)).toEqual(['u-import'])
    expect(cn).toEqual([])
  })

  it('moves the account when it is assigned to the CN product', async () => {
    worldWithImport('u-import')
    assignAccount('u-import:', CN_VARIANT.id)
    const ai = await discoverAccounts(AI_VARIANT, noKey)
    const cn = await discoverAccounts(CN_VARIANT, noKey)
    expect(ai).toEqual([])
    expect(cn.map(account => account.credential.uid)).toEqual(['u-import'])
  })

  it('returns the account to the default when the assignment is removed', async () => {
    worldWithImport('u-import')
    assignAccount('u-import:', CN_VARIANT.id)
    const { unassignAccount } = await import('../src/account-assignments.ts')
    unassignAccount('u-import:')
    expect((await discoverAccounts(CN_VARIANT, noKey)).map(account => account.credential.uid)).toEqual([])
    expect((await discoverAccounts(AI_VARIANT, noKey)).map(account => account.credential.uid)).toEqual(['u-import'])
  })

  it('keeps the live desktop sign-in under its own variant regardless of assignments', async () => {
    // A live file is the app's own claim; the assignment table governs
    // imported accounts, which have no app of their own. Plant both: the live
    // CN file stays visible to the CN scan even with the default assignment.
    const { importedPath } = worldWithImport('u-import')
    void importedPath
    const authDir = join(homedir(), '.config', 'CodeBuddyExtension', 'Data', 'Public', 'auth')
    mkdirSync(authDir, { recursive: true })
    writeFileSync(join(authDir, CN_VARIANT.desktopFilename), document('u-live-cn'))
    const cn = await discoverAccounts(CN_VARIANT, noKey)
    const ai = await discoverAccounts(AI_VARIANT, noKey)
    expect(cn.map(account => account.credential.uid)).toEqual(['u-live-cn'])
    expect(ai.map(account => account.credential.uid)).toEqual(['u-import'])
  })
})
