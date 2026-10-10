/**
 * Two failures that made a transient outage look permanent.
 *
 * Both were observed live on a remote deployment: four accounts recorded
 * `transport error: TypeError: fetch failed` inside 55 seconds, all four were
 * benched, and they were still benched 16 minutes later with the network
 * healthy again. Worse, no UI action could clear them — removing an account,
 * deleting its file, re-importing it and pressing "re-detect" all left the
 * record, because every one of those paths writes `members` and leaves `probes`
 * alone.
 *
 * The rules pinned here:
 *   1. a failure that is about the NETWORK is not recorded against an account;
 *   2. the user has a way to clear recorded state without editing a file.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describesAccount, outcomeOfFailure } from '../src/account-pool-runtime.ts'
import { exclusionOf, rankPool, POOL_UNKNOWN_COOLDOWN_MS, type WorkBuddyPoolMember } from '../src/account-pool.ts'
import { WorkBuddyPoolStore } from '../src/pool-store.ts'

const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })

function store(): WorkBuddyPoolStore {
  const dir = mkdtempSync(join(tmpdir(), 'wb-transport-'))
  dirs.push(dir)
  return new WorkBuddyPoolStore(join(dir, 'pool.json'))
}

/** The exact text the shim produced on the remote deployment. */
const TRANSPORT = 'transport error: TypeError: fetch failed'

describe('a transport failure is not an account outcome', () => {
  it('is recognised as being about the network, not the credential', () => {
    expect(describesAccount(0)).toBe(false)
  })

  it('is the ONLY status treated that way', () => {
    // Every real HTTP answer says something about the account, a 5xx included:
    // a gateway error is still a fact about the request that account made.
    for (const status of [200, 401, 403, 429, 500, 502, 503, 504]) {
      expect(describesAccount(status)).toBe(true)
    }
  })

  it('still classifies as a failure when it IS reported', () => {
    // The classification stays useful for the caller's error response; what
    // changes is that the pool is not told about it.
    expect(outcomeOfFailure(0, TRANSPORT).outcome).toBe('failed')
  })

  it('would have benched the whole pool under the old behaviour', () => {
    // Documents the regression: recording status 0 excludes the account for the
    // full fallback cooldown, so four accounts failing together meant four
    // accounts out, for a network blip none of them caused.
    const now = Date.now()
    const probe = { outcome: 'failed' as const, atMs: now }
    expect(exclusionOf(probe, now)).toBe('failed')
    expect(exclusionOf(probe, now + POOL_UNKNOWN_COOLDOWN_MS - 1)).toBe('failed')
    expect(exclusionOf(probe, now + POOL_UNKNOWN_COOLDOWN_MS + 1)).toBeUndefined()
  })

  it('leaves every account a candidate once it is not recorded', () => {
    // The state after the fix: nothing written, so the ranking has nothing to
    // exclude and the pool heals on the very next request.
    const members: WorkBuddyPoolMember[] = [
      { account: { id: 'a:', accountName: 'A' } },
      { account: { id: 'b:', accountName: 'B' } },
    ]
    expect(rankPool(members, Date.now()).every(row => row.excludedBy === undefined)).toBe(true)
  })
})

describe('recorded state can be cleared without editing a file', () => {
  it('clearProbes empties the measurements but keeps the membership', () => {
    // Membership is the user's decision; measurements are the plugin's. Clearing
    // one must not discard the other — that distinction is the whole point of
    // the button, and getting it wrong would silently unsubscribe every account.
    const s = store()
    s.setMembers(['a:', 'b:'])
    s.recordProbe('a:', { outcome: 'failed', atMs: 1, message: TRANSPORT }, 'live-request')
    s.recordProbe('b:', { outcome: 'rate-limited', atMs: 2, retryAtMs: 9_999_999_999_999 }, 'live-request')

    s.clearProbes()

    expect(s.probeOf('a:')).toBeUndefined()
    expect(s.probeOf('b:')).toBeUndefined()
    expect(s.members()).toEqual(['a:', 'b:'])
  })

  it('survives a re-read, so it is the file that was cleared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-transport-reload-'))
    dirs.push(dir)
    const path = join(dir, 'pool.json')
    const s = new WorkBuddyPoolStore(path)
    s.setMembers(['a:'])
    s.recordProbe('a:', { outcome: 'failed', atMs: 1 }, 'live-request')
    s.clearProbes()
    expect(new WorkBuddyPoolStore(path).probeOf('a:')).toBeUndefined()
  })

  it('is a no-op on an already-clean store, and writes nothing', () => {
    const s = store()
    s.setMembers(['a:'])
    expect(() => { s.clearProbes() }).not.toThrow()
    expect(s.members()).toEqual(['a:'])
  })

  it('restores an excluded account to the ranking', () => {
    // End to end: the account is out, the user clears state, the account is a
    // candidate again — the outcome the button promises.
    const s = store()
    s.setMembers(['a:', 'b:'])
    s.recordProbe('a:', { outcome: 'credential-rejected', atMs: 1 }, 'live-request')
    const members = (): WorkBuddyPoolMember[] => {
      const probe = s.probeOf('a:')
      return [
        { account: { id: 'a:', accountName: 'A' }, ...probe === undefined ? {} : { probe } },
        { account: { id: 'b:', accountName: 'B' } },
      ]
    }
    expect(rankPool(members(), 2).find(row => row.account.id === 'a:')?.excludedBy).toBe('credential-rejected')

    s.clearProbes()
    expect(rankPool(members(), 2).every(row => row.excludedBy === undefined)).toBe(true)
  })

  it('clears a rate-limit cooldown too, so a stuck record is never permanent', () => {
    // Deliberate: this can let an account retry before its stated reset, which
    // is the point — the user pressed it because they believe the state is
    // wrong, and upstream answers a real limit again immediately.
    const s = store()
    s.setMembers(['a:'])
    s.recordProbe('a:', { outcome: 'rate-limited', atMs: 1, retryAtMs: 9_999_999_999_999 }, 'live-request')
    expect(exclusionOf(s.probeOf('a:'), 2)).toBe('rate-limited')
    s.clearProbes()
    expect(exclusionOf(s.probeOf('a:'), 2)).toBeUndefined()
  })
})
