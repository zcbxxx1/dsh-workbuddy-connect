/**
 * Rate-limit recovery: the account leaves the pool with the upstream's own
 * reset time, and comes back on its own when that time passes.
 *
 * The user-facing contract is two sentences, and both are pinned here:
 *   1. a limited account is not billed while it is out;
 *   2. it returns WITHOUT any manual step once the stated time arrives.
 */

import { describe, expect, it } from 'vitest'
import {
  exclusionOf,
  pickAccount,
  POOL_UNKNOWN_COOLDOWN_MS,
  rankPool,
  type WorkBuddyPoolMember,
} from '../src/account-pool.ts'
import { outcomeOfFailure, parseResetTime } from '../src/account-pool-runtime.ts'

/** The sentence the upstream actually sends, observed on this machine. */
const LIMIT_BODY = 'usage exceeds frequency limit, but don\'t worry, your usage will reset at 2026-10-07 00:06:26 UTC+8, alternatively, you can switch to the other models to continue using it.'

function member(id: string, probe?: WorkBuddyPoolMember['probe']): WorkBuddyPoolMember {
  return { account: { id, accountName: id }, ...probe === undefined ? {} : { probe } }
}

describe('a 429 keeps the upstream’s reset time', () => {
  /** A moment before the stated reset, so the parse is not clamped to "now". */
  const before = Date.parse('2026-10-06T10:00:00Z')

  it('carries retryAtMs out of the body instead of guessing', () => {
    // The regression this pins: the 429 branch used to return before the body
    // was read, so the stated reset was discarded and the account was benched
    // for the 30-minute fallback instead.
    const classified = outcomeOfFailure(429, LIMIT_BODY, before)
    expect(classified.outcome).toBe('rate-limited')
    expect(classified.retryAtMs).toBeTypeOf('number')
    // 00:06:26 at UTC+8 is 2026-10-06T16:06:26Z — the parse must land there,
    // not on the fallback cooldown.
    expect(new Date(classified.retryAtMs as number).toISOString()).toBe('2026-10-06T16:06:26.000Z')
    expect(classified.retryAtMs as number).toBeGreaterThan(before)
  })

  it('reads the same time whether the limit arrives as 429 or as 200', () => {
    // Both spellings have been observed; only the body carries the time.
    const as429 = outcomeOfFailure(429, LIMIT_BODY, before)
    const as200 = outcomeOfFailure(200, LIMIT_BODY, before)
    expect(as200.outcome).toBe('rate-limited')
    expect(as200.retryAtMs).toBe(as429.retryAtMs)
  })

  it('still recognises a bare 429 that names no time', () => {
    const classified = outcomeOfFailure(429, '', before)
    expect(classified.outcome).toBe('rate-limited')
    expect(classified.retryAtMs).toBeUndefined()
  })

  it('clamps a reset already in the past up to now, i.e. usable immediately', () => {
    const after = Date.parse('2027-01-01T00:00:00Z')
    expect(outcomeOfFailure(429, LIMIT_BODY, after).retryAtMs).toBe(after)
  })
})

describe('a limited account leaves the pool until its stated time', () => {
  const reset = Date.parse('2026-10-06T16:06:26.000Z')
  const probe = { outcome: 'rate-limited' as const, atMs: reset - 60_000, retryAtMs: reset }

  it('is excluded before the reset', () => {
    expect(exclusionOf(probe, reset - 1)).toBe('rate-limited')
  })

  it('returns at the reset, with no manual step', () => {
    // Recovery is evaluated at ranking time, so nothing has to run a timer or
    // re-probe the account for it to become a candidate again.
    expect(exclusionOf(probe, reset)).toBeUndefined()
    expect(exclusionOf(probe, reset + 1)).toBeUndefined()
  })

  it('is skipped by the selector while out, and chosen again after', () => {
    const members = [member('limited', probe), member('healthy')]
    expect(pickAccount(members, reset - 1)?.id).toBe('healthy')
    // Once the stated time passes the limited account is a candidate again and
    // may win on the ranking keys — it is not permanently demoted.
    const after = rankPool(members, reset)
    expect(after.every(row => row.excludedBy === undefined)).toBe(true)
  })

  it('falls back to the conservative cooldown only when no time was stated', () => {
    const unstated = { outcome: 'rate-limited' as const, atMs: 1_000_000 }
    expect(exclusionOf(unstated, 1_000_000 + 1)).toBe('rate-limited')
    expect(exclusionOf(unstated, 1_000_000 + POOL_UNKNOWN_COOLDOWN_MS + 1)).toBeUndefined()
  })
})

describe('the whole path, from an upstream body to a usable account', () => {
  it('excludes on failure and re-includes after the parsed instant', () => {
    const now = Date.parse('2026-10-06T10:00:00Z')
    const classified = outcomeOfFailure(429, LIMIT_BODY, now)
    expect(classified.retryAtMs).toBeGreaterThan(now)

    // What the pool records, then what the ranking decides.
    const recorded = {
      outcome: classified.outcome,
      atMs: now,
      ...classified.retryAtMs === undefined ? {} : { retryAtMs: classified.retryAtMs },
    }
    expect(exclusionOf(recorded, now)).toBe('rate-limited')
    expect(exclusionOf(recorded, classified.retryAtMs as number)).toBeUndefined()
  })

  it('reports the wait in the exclusion so the page can explain it', () => {
    const now = Date.parse('2026-10-06T10:00:00Z')
    const reset = parseResetTime(LIMIT_BODY, now) as number
    // ~6h06m after 10:00 UTC, i.e. the next 00:06 at UTC+8.
    expect(Math.round((reset - now) / 60_000)).toBe(366)
  })
})
