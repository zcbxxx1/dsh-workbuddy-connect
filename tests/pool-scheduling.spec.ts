/**
 * The scheduling switch, as the page derives it.
 *
 * The user's request is two sentences: a rate-limited account leaves the
 * rotation by itself, and comes back by itself when the limit lifts. The host
 * already decides that (`exclusionOf` is evaluated at ranking time), so what
 * these pin is the PAGE's derivation — that the switch shows scheduling rather
 * than membership, and that the two are never conflated.
 *
 * The conflation is the failure worth guarding: if the switch showed membership,
 * a rate-limited account would look like one the user had switched off, and the
 * user would "fix" it by re-admitting an account that was already admitted.
 */

import { describe, expect, it } from 'vitest'
import { exclusionOf, pickAccount, rankPool, type WorkBuddyPoolMember } from '../src/account-pool.ts'
import { outcomeOfFailure } from '../src/account-pool-runtime.ts'

/** What the page shows for one account. */
function schedulingOf(member: boolean, excludedBy: string | undefined): boolean {
  return member && excludedBy === undefined
}

function member(id: string, probe?: WorkBuddyPoolMember['probe']): WorkBuddyPoolMember {
  return { account: { id, accountName: id }, ...probe === undefined ? {} : { probe } }
}

/** The upstream's observed limit sentence. */
const LIMIT_BODY = 'usage exceeds frequency limit, but don\'t worry, your usage will reset at 2026-10-07 23:59:59 UTC+8, alternatively, you can switch to the other models to continue using it.'

describe('a rate-limited account stops scheduling by itself', () => {
  const reset = Date.parse('2026-10-07T15:59:59Z')
  const now = reset - 3_600_000
  const probe = { outcome: 'rate-limited' as const, atMs: now, retryAtMs: reset }

  it('is excluded while the limit stands', () => {
    expect(exclusionOf(probe, now)).toBe('rate-limited')
  })

  it('shows the switch as off while excluded, though the user admitted it', () => {
    // The distinction the page must keep: membership is the user's choice and
    // stays true; scheduling is what the switch shows.
    expect(schedulingOf(true, exclusionOf(probe, now))).toBe(false)
  })

  it('is not chosen for a request while excluded', () => {
    const members = [member('limited', probe), member('healthy')]
    expect(pickAccount(members, now)?.id).toBe('healthy')
  })

  it('is ranked below every usable account, but still listed', () => {
    const rows = rankPool([member('limited', probe), member('healthy')], now)
    expect(rows.map(row => row.account.id)).toEqual(['healthy', 'limited'])
    expect(rows[1]?.excludedBy).toBe('rate-limited')
  })
})

describe('it comes back by itself when the limit lifts', () => {
  const reset = Date.parse('2026-10-07T15:59:59Z')
  const probe = { outcome: 'rate-limited' as const, atMs: reset - 3_600_000, retryAtMs: reset }

  it('is excluded one millisecond before the stated reset', () => {
    expect(exclusionOf(probe, reset - 1)).toBe('rate-limited')
    expect(schedulingOf(true, exclusionOf(probe, reset - 1))).toBe(false)
  })

  it('schedules again AT the stated reset, with no user action', () => {
    // Recovery is a property of the ranking, not of a timer or a click: nothing
    // has to run for the account to become a candidate again.
    expect(exclusionOf(probe, reset)).toBeUndefined()
    expect(schedulingOf(true, exclusionOf(probe, reset))).toBe(true)
  })

  it('becomes selectable again, so it is a candidate and not merely listed', () => {
    // Both are usable after the reset, so the selector is free to return either
    // — the id tie-break makes it `healthy` here. What matters is that the
    // limited account is no longer the reason it was skipped: with the other
    // account removed it IS selected.
    const members = [member('limited', probe), member('healthy')]
    expect(rankPool(members, reset).every(row => row.excludedBy === undefined)).toBe(true)
    expect(pickAccount([member('limited', probe)], reset)?.id).toBe('limited')
  })

  it('keeps membership throughout, so nothing has to be re-admitted', () => {
    // The switch going off and on again must not touch the member list.
    const membership = true
    expect(schedulingOf(membership, exclusionOf(probe, reset - 1))).toBe(false)
    expect(schedulingOf(membership, exclusionOf(probe, reset))).toBe(true)
    expect(membership).toBe(true)
  })
})

describe('the upstream limit sentence drives the pause', () => {
  it('parses the stated reset so the pause has a real end', () => {
    // Without the reset time the account would fall back to a guessed cooldown
    // and stay out longer than upstream asked — and the page could not show a
    // recovery time at all.
    const before = Date.parse('2026-10-07T10:00:00Z')
    const classified = outcomeOfFailure(429, LIMIT_BODY, before)
    expect(classified.outcome).toBe('rate-limited')
    expect(classified.retryAtMs).toBe(Date.parse('2026-10-07T15:59:59Z'))

    // And that instant really ends the pause.
    const probe = {
      outcome: classified.outcome,
      atMs: before,
      ...classified.retryAtMs === undefined ? {} : { retryAtMs: classified.retryAtMs },
    }
    expect(exclusionOf(probe, before)).toBe('rate-limited')
    expect(exclusionOf(probe, classified.retryAtMs as number)).toBeUndefined()
  })
})
