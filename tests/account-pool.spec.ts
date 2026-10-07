/**
 * The account pool's pure rules.
 *
 * These encode three conclusions that cannot be guessed from the code shape:
 * a missing credit multiplier is not free, no free model means no paid
 * fallback, and `rate-limited` is temporary rather than a permanent exclusion.
 * Each is pinned because getting it wrong spends real credits.
 */

import { describe, expect, it } from 'vitest'
import {
  effectiveMembersOf,
  exclusionOf,
  pickAccount,
  pickFreeModel,
  POOL_UNKNOWN_COOLDOWN_MS,
  rankPool,
  type WorkBuddyPoolMember,
} from '../src/account-pool.ts'

function member(overrides: Partial<WorkBuddyPoolMember> = {}): WorkBuddyPoolMember {
  return {
    account: { id: 'a', accountName: 'A' },
    ...overrides,
  }
}

const NOW = 1_800_000_000_000

describe('exclusionOf', () => {
  it('treats an unmeasured account as a candidate', () => {
    // A freshly discovered account must not be invisible until first tested.
    expect(exclusionOf(undefined, NOW)).toBeUndefined()
  })

  it('treats ok as a candidate', () => {
    expect(exclusionOf({ outcome: 'ok', atMs: NOW - 1000 }, NOW)).toBeUndefined()
  })

  it('excludes a rejected credential regardless of cooldown', () => {
    // Waiting cannot fix a token the upstream refuses.
    expect(exclusionOf({ outcome: 'credential-rejected', atMs: NOW - 10 * POOL_UNKNOWN_COOLDOWN_MS }, NOW))
      .toBe('credential-rejected')
  })

  it('keeps a rate-limited account out only until its stated reset', () => {
    const probe = { outcome: 'rate-limited' as const, atMs: NOW - 1000, retryAtMs: NOW + 60_000 }
    expect(exclusionOf(probe, NOW)).toBe('rate-limited')
    expect(exclusionOf(probe, NOW + 60_001)).toBeUndefined()
  })

  it('applies the fallback cooldown when upstream stated no time', () => {
    const probe = { outcome: 'failed' as const, atMs: NOW }
    expect(exclusionOf(probe, NOW + 1000)).toBe('failed')
    expect(exclusionOf(probe, NOW + POOL_UNKNOWN_COOLDOWN_MS + 1)).toBeUndefined()
  })

  it('never benches an account over a content-policy refusal', () => {
    // That is a fact about one request, not about the account.
    expect(exclusionOf({ outcome: 'policy-rejected', atMs: NOW }, NOW)).toBeUndefined()
  })

  it('treats an unknown outcome as unusable with no cooldown', () => {
    expect(exclusionOf({ outcome: 'something-new' as never, atMs: NOW - POOL_UNKNOWN_COOLDOWN_MS * 10 }, NOW))
      .toBe('unusable')
  })
})

describe('rankPool', () => {
  it('ranks usable accounts before excluded ones', () => {
    const rows = rankPool([
      member({ account: { id: 'excluded', accountName: 'X' }, probe: { outcome: 'credential-rejected', atMs: NOW } }),
      member({ account: { id: 'usable', accountName: 'U' } }),
    ], NOW)
    expect(rows.map(row => row.account.id)).toEqual(['usable', 'excluded'])
    expect(rows[1]?.excludedBy).toBe('credential-rejected')
  })

  it('prefers the account with more credits', () => {
    const rows = rankPool([
      member({ account: { id: 'low', accountName: 'L' }, credits: { total: 10, expiringSoon: 0 } }),
      member({ account: { id: 'high', accountName: 'H' }, credits: { total: 100, expiringSoon: 0 } }),
    ], NOW)
    expect(rows.map(row => row.account.id)).toEqual(['high', 'low'])
  })

  it('ranks absent credits as zero rather than first', () => {
    // A failing credits route must not capture all the traffic.
    const rows = rankPool([
      member({ account: { id: 'unknown', accountName: 'U' } }),
      member({ account: { id: 'known', accountName: 'K' }, credits: { total: 1, expiringSoon: 0 } }),
    ], NOW)
    expect(rows.map(row => row.account.id)).toEqual(['known', 'unknown'])
  })

  it('breaks a credit tie by the soonest expiry', () => {
    const rows = rankPool([
      member({ account: { id: 'later', accountName: 'L' }, credits: { total: 5, expiringSoon: 0, nearestExpiryMs: NOW + 100_000 } }),
      member({ account: { id: 'sooner', accountName: 'S' }, credits: { total: 5, expiringSoon: 0, nearestExpiryMs: NOW + 1_000 } }),
    ], NOW)
    expect(rows.map(row => row.account.id)).toEqual(['sooner', 'later'])
  })

  it('breaks a full tie by account id, making the order total', () => {
    // Without this the caller's array order leaks through, so the same pool
    // could rotate differently between runs.
    const forward = rankPool([
      member({ account: { id: 'a', accountName: 'A' } }),
      member({ account: { id: 'b', accountName: 'B' } }),
    ], NOW)
    const reverse = rankPool([
      member({ account: { id: 'b', accountName: 'B' } }),
      member({ account: { id: 'a', accountName: 'A' } }),
    ], NOW)
    expect(forward.map(row => row.account.id)).toEqual(['a', 'b'])
    expect(reverse.map(row => row.account.id)).toEqual(['a', 'b'])
  })

  it('never drops an excluded account from the result', () => {
    // The card has to explain why each is out.
    const rows = rankPool([
      member({ account: { id: 'a', accountName: 'A' }, probe: { outcome: 'out-of-credit', atMs: NOW } }),
    ], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.excludedBy).toBe('out-of-credit')
  })

  it('is stable for the same input', () => {
    const input = [
      member({ account: { id: 'b', accountName: 'B' } }),
      member({ account: { id: 'a', accountName: 'A' } }),
    ]
    expect(rankPool(input, NOW)).toEqual(rankPool(input, NOW))
  })
})

describe('pickAccount', () => {
  it('returns the top usable account', () => {
    const picked = pickAccount([
      member({ account: { id: 'out', accountName: 'O' }, probe: { outcome: 'credential-rejected', atMs: NOW } }),
      member({ account: { id: 'in', accountName: 'I' } }),
    ], NOW)
    expect(picked?.id).toBe('in')
  })

  it('returns undefined when every member is excluded', () => {
    expect(pickAccount([
      member({ probe: { outcome: 'credential-rejected', atMs: NOW } }),
    ], NOW)).toBeUndefined()
  })

  it('returns undefined for an empty pool', () => {
    expect(pickAccount([], NOW)).toBeUndefined()
  })
})

describe('effectiveMembersOf', () => {
  it('keeps the caller order and drops ids that no longer resolve', () => {
    expect(effectiveMembersOf(['a', 'b', 'c'], new Set(['c', 'a']))).toEqual(['a', 'c'])
  })
})

describe('pickFreeModel', () => {
  it('accepts only an exact zero multiplier', () => {
    const picked = pickFreeModel([
      { id: 'paid', creditMultiplier: 0.79, contextWindow: 1000 },
      { id: 'free', creditMultiplier: 0, contextWindow: 100 },
    ])
    expect(picked?.id).toBe('free')
  })

  it('never treats an absent multiplier as free', () => {
    // The CN static fallback carries none at all; assuming zero would bill.
    expect(pickFreeModel([{ id: 'unknown-multiplier', contextWindow: 1000 }])).toBeUndefined()
  })

  it('returns undefined when nothing is free, so no paid fallback happens', () => {
    expect(pickFreeModel([{ id: 'paid', creditMultiplier: 1 }])).toBeUndefined()
  })

  it('prefers the largest context window among free models', () => {
    const picked = pickFreeModel([
      { id: 'small', creditMultiplier: 0, contextWindow: 1000 },
      { id: 'big', creditMultiplier: 0, contextWindow: 200_000 },
    ])
    expect(picked?.id).toBe('big')
  })
})
