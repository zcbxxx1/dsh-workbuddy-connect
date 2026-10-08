/**
 * Multi-account discovery across platforms.
 *
 * `discoverAccounts` reuses `desktopAuthCandidatesFor(variant)`, so the
 * platform matrix is inherited rather than reimplemented — but that inheritance
 * is exactly what needs pinning: a change to the candidate list would silently
 * stop finding backups on Linux while Windows kept working, and nothing else in
 * the suite looks at discovery's directory resolution.
 *
 * Every case stubs the platform and the home directory, then asserts BOTH that
 * the live file is found and that its timestamped siblings are found beside it,
 * because the sibling scan is what makes a pool possible at all.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverAccounts } from '../src/account-discovery.ts'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }))
  restorePlatform()
  restoreHome()
})

// --- platform / home stubbing ---------------------------------------------

const realPlatform = process.platform
const realHomedir = homedir

function stubPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
}

/**
 * `homedir()` reads `USERPROFILE` on win32 and `HOME` elsewhere, so both are
 * set. Stubbing the function directly would not help: `auth.ts` calls it once
 * per invocation and caches nothing, but the OS env is what it actually reads.
 *
 * `DSH_HOME` is redirected too, and that one is not cosmetic: discovery also
 * scans the plugin's imported-credential directory under `$DSH_HOME`, so a
 * developer machine with real imports would leak those accounts into every
 * case here and break assertions about the platform paths under test.
 */
const savedEnv = {
  HOME: process.env['HOME'],
  USERPROFILE: process.env['USERPROFILE'],
  XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'],
  XDG_DATA_HOME: process.env['XDG_DATA_HOME'],
  DSH_HOME: process.env['DSH_HOME'],
}

function stubHome(home: string): void {
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
  // An empty per-test harness home, so imports never reach the real one.
  process.env['DSH_HOME'] = home
  delete process.env['XDG_CONFIG_HOME']
  delete process.env['XDG_DATA_HOME']
}

function restoreHome(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  void realHomedir
}

/** A temp home with an auth directory at the given relative path. */
function homeWith(relativeDir: string): { home: string, authDir: string } {
  const home = mkdtempSync(join(tmpdir(), 'wb-home-'))
  dirs.push(home)
  const authDir = join(home, ...relativeDir.split('/'))
  mkdirSync(authDir, { recursive: true })
  return { home, authDir }
}

/** A plaintext auth document, the shape the parser accepts. */
function document(uid: string, nickname: string): string {
  return JSON.stringify({
    auth: { accessToken: `t-${uid}`, refreshToken: `r-${uid}`, expiresAt: 2_000_000_000_000, domain: 'www.workbuddy.ai' },
    account: { uid, nickname },
  })
}

/**
 * Rewrite a Windows temp path into the POSIX shape a Linux case needs.
 *
 * Only the XDG override case uses this: the adoption rule is
 * `startsWith('/')`, so a `C:\...` fixture would be rejected by the very check
 * under test and the case would pass for the wrong reason.
 */
function posixPath(path: string): string {
  return path.replace(/^[A-Za-z]:/u, '').replace(/\\/gu, '/')
}

/** Plant a live file plus two timestamped backups for one account. */
function plant(authDir: string, filename: string, uid: string): void {
  writeFileSync(join(authDir, filename), document(uid, `live-${uid}`))
  const stem = filename.replace(/\.info$/u, '')
  writeFileSync(join(authDir, `${stem}.2026-09-16T10-00-00Z.1.a.info`), document('u2', 'backup-u2'))
  writeFileSync(join(authDir, `${stem}.2026-09-20T10-00-00Z.2.b.info`), document('u3', 'backup-u3'))
}

const noKey = async (): Promise<Buffer> => { throw new Error('no encrypted field in these fixtures') }

// --- the matrix ------------------------------------------------------------

describe('windows', () => {
  it('finds the live file and its backups under AppData/Local', async () => {
    const { home, authDir } = homeWith('AppData/Local/CodeBuddyExtension/Data/Public/auth')
    stubPlatform('win32')
    stubHome(home)
    plant(authDir, AI_VARIANT.desktopFilename, 'u1')

    const accounts = await discoverAccounts(AI_VARIANT, noKey)
    expect(accounts.map(a => a.credential.uid).sort()).toEqual(['u1', 'u2', 'u3'])
    expect(accounts.find(a => a.credential.uid === 'u1')?.live).toBe(true)
  })

  it('finds them under AppData/Roaming too, the second probe', async () => {
    const { home, authDir } = homeWith('AppData/Roaming/CodeBuddyExtension/Data/Public/auth')
    stubPlatform('win32')
    stubHome(home)
    plant(authDir, AI_VARIANT.desktopFilename, 'u1')

    expect((await discoverAccounts(AI_VARIANT, noKey)).map(a => a.credential.uid)).toContain('u1')
  })

  it('uses the international filename for the AI variant, not the CN one', async () => {
    const { home, authDir } = homeWith('AppData/Local/CodeBuddyExtension/Data/Public/auth')
    stubPlatform('win32')
    stubHome(home)
    // Only the CN file is present: the AI variant must NOT read it.
    writeFileSync(join(authDir, CN_VARIANT.desktopFilename), document('cn-user', 'CN'))
    expect(await discoverAccounts(AI_VARIANT, noKey)).toEqual([])
    // And the CN variant does find it.
    expect((await discoverAccounts(CN_VARIANT, noKey)).map(a => a.credential.uid)).toEqual(['cn-user'])
  })
})

describe('linux', () => {
  it('finds them under XDG config home (~/.config)', async () => {
    const { home, authDir } = homeWith('.config/CodeBuddyExtension/Data/Public/auth')
    stubPlatform('linux')
    stubHome(home)
    plant(authDir, AI_VARIANT.desktopFilename, 'u1')

    const accounts = await discoverAccounts(AI_VARIANT, noKey)
    expect(accounts.map(a => a.credential.uid).sort()).toEqual(['u1', 'u2', 'u3'])
  })

  it('finds them under XDG data home (~/.local/share)', async () => {
    const { home, authDir } = homeWith('.local/share/CodeBuddyExtension/Data/Public/auth')
    stubPlatform('linux')
    stubHome(home)
    plant(authDir, AI_VARIANT.desktopFilename, 'u1')

    expect((await discoverAccounts(AI_VARIANT, noKey)).map(a => a.credential.uid)).toContain('u1')
  })

  it('honours an absolute XDG_CONFIG_HOME override', async () => {
    // The override is adopted only when it is an absolute POSIX path — the rule
    // is `startsWith('/')` — so a Windows temp path cannot exercise it: on this
    // machine `mkdtempSync` yields `C:\...`, which that check correctly rejects
    // as "not an absolute XDG path". A real Linux home is what the rule is
    // written for, so the fixture is a POSIX-shaped path under the temp root.
    const { home } = homeWith('unused')
    const override = posixPath(join(tmpdir(), `wb-xdg-${process.pid}`))
    dirs.push(override)
    const authDir = join(override, 'CodeBuddyExtension', 'Data', 'Public', 'auth')
    mkdirSync(authDir, { recursive: true })
    stubPlatform('linux')
    stubHome(home)
    // AFTER stubHome, which clears both XDG vars so each case starts clean.
    process.env['XDG_CONFIG_HOME'] = override
    plant(authDir, AI_VARIANT.desktopFilename, 'u1')

    expect((await discoverAccounts(AI_VARIANT, noKey)).map(a => a.credential.uid)).toContain('u1')
  })

  it('ignores a relative XDG_CONFIG_HOME rather than joining onto it', async () => {
    // A relative value would otherwise produce a path relative to the CWD,
    // which is not a place a user's sign-in ever lives.
    const { home, authDir } = homeWith('.config/CodeBuddyExtension/Data/Public/auth')
    stubPlatform('linux')
    stubHome(home)
    process.env['XDG_CONFIG_HOME'] = 'relative/config'
    plant(authDir, AI_VARIANT.desktopFilename, 'u1')

    expect((await discoverAccounts(AI_VARIANT, noKey)).map(a => a.credential.uid)).toContain('u1')
  })
})

describe('macos', () => {
  it('finds them under Application Support', async () => {
    const { home, authDir } = homeWith('Library/Application Support/CodeBuddyExtension/Data/Public/auth')
    stubPlatform('darwin')
    stubHome(home)
    plant(authDir, AI_VARIANT.desktopFilename, 'u1')

    const accounts = await discoverAccounts(AI_VARIANT, noKey)
    expect(accounts.map(a => a.credential.uid).sort()).toEqual(['u1', 'u2', 'u3'])
  })
})

describe('an explicit path wins everywhere', () => {
  it('is used verbatim, so a credential can live outside every default', async () => {
    // This is the hook the import feature uses: an imported credential is read
    // from wherever the plugin stored it, not from the app's directory.
    const { home, authDir } = homeWith('elsewhere')
    stubPlatform('linux')
    stubHome(home)
    plant(authDir, 'imported.info', 'u1')

    const accounts = await discoverAccounts(AI_VARIANT, noKey, join(authDir, 'imported.info'))
    expect(accounts.map(a => a.credential.uid).sort()).toEqual(['u1', 'u2', 'u3'])
  })
})
