/**
 * Multi-account discovery and the pool runtime.
 *
 * Discovery is tested against synthetic files laid out the way WorkBuddy
 * actually writes them (a live file plus timestamped backups), because the
 * ordering rules — live beats backup, issuance time beats `expiresAt` — are
 * exactly what a real directory exercises and a hand-built object does not.
 */

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountIdOf, backupsBeside, discoverAccounts, readAuthFile } from '../src/account-discovery.ts'
import { outcomeOfFailure, parseResetTime } from '../src/account-pool-runtime.ts'
import { WorkBuddyPoolStore, readPoolDocument, workbuddyPoolPath } from '../src/pool-store.ts'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'

const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-pool-'))
  dirs.push(dir)
  return dir
}

/** A plaintext auth document, the shape the parser accepts. */
function document({ uid, nickname, expiresAt = 2_000_000_000_000, lastRefreshTime, domain = 'www.workbuddy.ai' }: {
  uid: string
  nickname: string
  expiresAt?: number
  lastRefreshTime?: number
  domain?: string
}): string {
  return JSON.stringify({
    auth: {
      accessToken: `token-${uid}`,
      refreshToken: `refresh-${uid}`,
      expiresAt,
      domain,
      ...lastRefreshTime === undefined ? {} : { lastRefreshTime },
    },
    account: { uid, nickname },
  })
}

/** The key opener discovery needs; plaintext files never call it. */
const noKey = async (): Promise<Buffer> => {
  throw new Error('no encrypted field expected in these fixtures')
}

describe('accountIdOf', () => {
  it('combines uid and enterprise, since both scope billing', () => {
    expect(accountIdOf({ uid: 'u1', enterpriseId: 'e1' })).toBe('u1:e1')
    expect(accountIdOf({ uid: 'u1' })).toBe('u1:')
  })
  it('is empty without a uid, which is what keeps such files out of the pool', () => {
    expect(accountIdOf({})).toBe('')
  })
})

describe('backupsBeside', () => {
  it('finds timestamped siblings newest-first and skips the live file', async () => {
    const dir = tempDir()
    const live = join(dir, 'workbuddy-desktop-ai.info')
    writeFileSync(live, '{}')
    writeFileSync(join(dir, 'workbuddy-desktop-ai.2026-09-16T10-00-00Z.1.a.info'), '{}')
    writeFileSync(join(dir, 'workbuddy-desktop-ai.2026-09-20T10-00-00Z.2.b.info'), '{}')
    // A different product's file must not be picked up.
    writeFileSync(join(dir, 'workbuddy-desktop.info'), '{}')

    const found = await backupsBeside(live)
    expect(found.map(path => path.split('\\').pop())).toEqual([
      'workbuddy-desktop-ai.2026-09-20T10-00-00Z.2.b.info',
      'workbuddy-desktop-ai.2026-09-16T10-00-00Z.1.a.info',
    ])
  })

  it('returns nothing for an unreadable directory', async () => {
    expect(await backupsBeside(join(tempDir(), 'nope', 'workbuddy-desktop-ai.info'))).toEqual([])
  })
})

describe('readAuthFile', () => {
  it('reads a plaintext document', async () => {
    const dir = tempDir()
    const path = join(dir, 'workbuddy-desktop-ai.info')
    writeFileSync(path, document({ uid: 'u1', nickname: 'One' }))
    const credential = await readAuthFile(path, noKey)
    expect(credential?.uid).toBe('u1')
    expect(credential?.nickname).toBe('One')
  })

  it('returns undefined for an absent, empty, or unparsable file', async () => {
    const dir = tempDir()
    expect(await readAuthFile(join(dir, 'missing.info'), noKey)).toBeUndefined()
    const empty = join(dir, 'empty.info')
    writeFileSync(empty, '   ')
    expect(await readAuthFile(empty, noKey)).toBeUndefined()
    const broken = join(dir, 'broken.info')
    writeFileSync(broken, 'not json')
    expect(await readAuthFile(broken, noKey)).toBeUndefined()
  })

  it('returns undefined when the key cannot open the document', async () => {
    // One bad backup must not abort the whole scan.
    const dir = tempDir()
    const path = join(dir, 'workbuddy-desktop-ai.info')
    writeFileSync(path, JSON.stringify({
      auth: { accessToken: { $wbEncrypted: 1, envelope: 'not-base64' } },
      account: { uid: 'u1' },
    }))
    expect(await readAuthFile(path, noKey)).toBeUndefined()
  })
})

describe('discoverAccounts', () => {
  it('finds accounts across the live file and its backups', async () => {
    const dir = tempDir()
    const live = join(dir, AI_VARIANT.desktopFilename)
    writeFileSync(live, document({ uid: 'u1', nickname: 'Live' }))
    writeFileSync(join(dir, `${AI_VARIANT.desktopFilename.replace(/\.info$/u, '')}.2026-09-16T10-00-00Z.1.a.info`),
      document({ uid: 'u2', nickname: 'Backup' }))

    const accounts = await discoverAccounts(AI_VARIANT, noKey, live)
    expect(accounts.map(account => account.credential.uid).sort()).toEqual(['u1', 'u2'])
    expect(accounts.find(account => account.credential.uid === 'u1')?.live).toBe(true)
    expect(accounts.find(account => account.credential.uid === 'u2')?.live).toBe(false)
  })

  it('deduplicates one account with several backups, preferring the live file', async () => {
    const dir = tempDir()
    const live = join(dir, AI_VARIANT.desktopFilename)
    writeFileSync(live, document({ uid: 'u1', nickname: 'Live', lastRefreshTime: 100 }))
    const stem = AI_VARIANT.desktopFilename.replace(/\.info$/u, '')
    writeFileSync(join(dir, `${stem}.2026-09-16T10-00-00Z.1.a.info`),
      document({ uid: 'u1', nickname: 'OldBackup', lastRefreshTime: 50 }))
    writeFileSync(join(dir, `${stem}.2026-09-20T10-00-00Z.2.b.info`),
      document({ uid: 'u1', nickname: 'NewBackup', lastRefreshTime: 200 }))

    const accounts = await discoverAccounts(AI_VARIANT, noKey, live)
    expect(accounts).toHaveLength(1)
    // Live wins even though a backup is newer by issuance time.
    expect(accounts[0]?.credential.nickname).toBe('Live')
    expect(accounts[0]?.live).toBe(true)
  })

  it('prefers the freshest backup when no live file exists', async () => {
    const dir = tempDir()
    const live = join(dir, AI_VARIANT.desktopFilename)
    const stem = AI_VARIANT.desktopFilename.replace(/\.info$/u, '')
    writeFileSync(join(dir, `${stem}.2026-09-16T10-00-00Z.1.a.info`),
      document({ uid: 'u1', nickname: 'Older', lastRefreshTime: 100 }))
    writeFileSync(join(dir, `${stem}.2026-09-20T10-00-00Z.2.b.info`),
      document({ uid: 'u1', nickname: 'Newer', lastRefreshTime: 200 }))

    const accounts = await discoverAccounts(AI_VARIANT, noKey, live)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.credential.nickname).toBe('Newer')
  })

  it('ranks by issuance time rather than a far-future expiresAt', async () => {
    // A revoked backup keeps a far-future expiry and must not outrank a
    // working credential that was issued later.
    const dir = tempDir()
    const live = join(dir, AI_VARIANT.desktopFilename)
    const stem = AI_VARIANT.desktopFilename.replace(/\.info$/u, '')
    writeFileSync(join(dir, `${stem}.2026-09-16T10-00-00Z.1.a.info`),
      document({ uid: 'u1', nickname: 'Revoked', expiresAt: 4_000_000_000_000, lastRefreshTime: 100 }))
    writeFileSync(join(dir, `${stem}.2026-09-20T10-00-00Z.2.b.info`),
      document({ uid: 'u1', nickname: 'Working', expiresAt: 2_000_000_000_000, lastRefreshTime: 200 }))

    const accounts = await discoverAccounts(AI_VARIANT, noKey, live)
    expect(accounts[0]?.credential.nickname).toBe('Working')
  })

  it('skips an account with no uid, which cannot be pooled', async () => {
    const dir = tempDir()
    const live = join(dir, AI_VARIANT.desktopFilename)
    writeFileSync(live, document({ uid: '', nickname: 'Anonymous' }))
    expect(await discoverAccounts(AI_VARIANT, noKey, live)).toEqual([])
  })

  it('does not pick up the other product’s files', async () => {
    const dir = tempDir()
    const live = join(dir, AI_VARIANT.desktopFilename)
    writeFileSync(join(dir, CN_VARIANT.desktopFilename), document({ uid: 'cn-user', nickname: 'CN' }))
    expect(await discoverAccounts(AI_VARIANT, noKey, live)).toEqual([])
  })
})

describe('outcomeOfFailure', () => {
  it('maps auth failures to a rejected credential', () => {
    expect(outcomeOfFailure(401, 'unauthorized').outcome).toBe('credential-rejected')
    expect(outcomeOfFailure(403, 'forbidden').outcome).toBe('credential-rejected')
  })

  it('maps rate limits to a temporary exclusion', () => {
    expect(outcomeOfFailure(429, '').outcome).toBe('rate-limited')
  })

  it('recognises the region’s quota code and its reset sentence', () => {
    const classified = outcomeOfFailure(200, '{"code":6004,"msg":"usage exceeds frequency limit"}')
    expect(classified.outcome).toBe('rate-limited')
  })

  it('maps gateway and transport failures to a transient outcome', () => {
    expect(outcomeOfFailure(500, 'boom').outcome).toBe('failed')
    expect(outcomeOfFailure(0, 'socket closed').outcome).toBe('failed')
  })

  it('recognises a drained balance', () => {
    expect(outcomeOfFailure(402, 'out of credit').outcome).toBe('out-of-credit')
  })
})

describe('parseResetTime', () => {
  it('reads the observed UTC+8 form (no colon in the offset)', () => {
    // Anchored to a moment BEFORE the stated reset, since the parser clamps a
    // past instant up to now (an already-elapsed reset means "usable again").
    const now = Date.parse('2026-10-06T00:00:00Z')
    const at = parseResetTime('reset at 2026-10-07 00:06:26 UTC+8', now)
    expect(at).toBeTypeOf('number')
    // 00:06:26 at UTC+8 is 2026-10-06T16:06:26Z.
    expect(new Date(at as number).toISOString()).toBe('2026-10-06T16:06:26.000Z')
  })

  it('clamps an already-elapsed reset up to now rather than into the past', () => {
    const now = Date.parse('2027-01-01T00:00:00Z')
    expect(parseResetTime('reset at 2026-10-07 00:06:26 UTC+8', now)).toBe(now)
  })

  it('accepts a colon-bearing offset and agrees with the plain form', () => {
    expect(parseResetTime('reset at 2026-10-07 00:06:26 UTC+8'))
      .toBe(parseResetTime('reset at 2026-10-07 00:06:26 UTC+08:00'))
  })

  it('returns undefined when no time is stated', () => {
    // That absence must never become a locally invented countdown.
    expect(parseResetTime('rate limited')).toBeUndefined()
    expect(parseResetTime('')).toBeUndefined()
  })
})

describe('WorkBuddyPoolStore', () => {
  it('starts empty', () => {
    const store = new WorkBuddyPoolStore(join(tempDir(), 'pool.json'))
    expect(store.members()).toEqual([])
    expect(store.probeOf('u1')).toBeUndefined()
  })

  it('round-trips membership', () => {
    const path = join(tempDir(), 'pool.json')
    const store = new WorkBuddyPoolStore(path)
    store.setMembers(['a', 'b'])
    expect(store.members()).toEqual(['a', 'b'])
    // A second instance sees it: the file, not just memory, is the truth.
    expect(new WorkBuddyPoolStore(path).members()).toEqual(['a', 'b'])
  })

  it('deduplicates and drops empty ids when setting members', () => {
    const store = new WorkBuddyPoolStore(join(tempDir(), 'pool.json'))
    store.setMembers(['a', 'a', '', 'b'])
    expect(store.members()).toEqual(['a', 'b'])
  })

  it('round-trips a measurement', () => {
    const store = new WorkBuddyPoolStore(join(tempDir(), 'pool.json'))
    store.recordProbe('a', { outcome: 'rate-limited', atMs: 123, retryAtMs: 456, message: 'slow down' }, 'live-request')
    expect(store.probeOf('a')).toEqual({
      outcome: 'rate-limited', atMs: 123, retryAtMs: 456, message: 'slow down', source: 'live-request',
    })
  })

  it('never lets an older measurement overwrite a newer one', () => {
    // A live failure and a manual test race; the later one describes the account.
    const store = new WorkBuddyPoolStore(join(tempDir(), 'pool.json'))
    store.recordProbe('a', { outcome: 'ok', atMs: 200 }, 'test-batch')
    store.recordProbe('a', { outcome: 'rate-limited', atMs: 100 }, 'live-request')
    expect(store.probeOf('a')?.outcome).toBe('ok')
  })

  it('keeps membership when a measurement is recorded', () => {
    // The user's decision and the plugin's observation share a file but must
    // not overwrite each other.
    const store = new WorkBuddyPoolStore(join(tempDir(), 'pool.json'))
    store.setMembers(['a', 'b'])
    store.recordProbe('a', { outcome: 'ok', atMs: 1 }, 'live-request')
    expect(store.members()).toEqual(['a', 'b'])
  })

  it('tolerates a corrupt or unknown-version file by reading it as empty', () => {
    const path = join(tempDir(), 'pool.json')
    writeFileSync(path, 'not json')
    expect(readPoolDocument(path).members).toEqual([])
    writeFileSync(path, JSON.stringify({ version: 99, members: ['a'], probes: {} }))
    expect(readPoolDocument(path).members).toEqual([])
  })

  it('clears a measurement', () => {
    const store = new WorkBuddyPoolStore(join(tempDir(), 'pool.json'))
    store.recordProbe('a', { outcome: 'ok', atMs: 1 }, 'live-request')
    store.clearProbe('a')
    expect(store.probeOf('a')).toBeUndefined()
  })
})

describe('workbuddyPoolPath', () => {
  it('is per variant, so the two regions never share membership', () => {
    expect(workbuddyPoolPath('workbuddy')).not.toBe(workbuddyPoolPath('workbuddy-ai'))
  })
})
