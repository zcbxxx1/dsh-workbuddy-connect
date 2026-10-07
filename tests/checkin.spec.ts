/**
 * Daily check-in.
 *
 * The two rules that matter are pinned here because both involve a real
 * mutation: an already-claimed day must not be re-claimed, and a closed window
 * must not be reported as "already checked in". The upstream currently reports
 * `active: false` for every account, so the second case is the normal path.
 */

import { describe, expect, it, vi } from 'vitest'
import { checkinAccounts, CHECKIN_BATCH_GAP_MS, type WorkBuddyCheckinRow } from '../src/checkin.ts'
import type { WorkBuddyCheckinStatus } from '../src/upstream.ts'

function credential(nickname = 'Tester') {
  return {
    accessToken: 't',
    refreshToken: 'r',
    expiresAtMs: Date.now() + 3_600_000,
    domain: 'www.workbuddy.ai',
    uid: 'uid-1',
    nickname,
    source: 'desktop' as const,
  }
}

function status(overrides: Partial<WorkBuddyCheckinStatus> = {}): WorkBuddyCheckinStatus {
  return {
    active: true,
    todayCheckedIn: false,
    streakDays: 0,
    dailyCredit: 100,
    todayCredit: 100,
    isStreakDay: false,
    nextStreakDay: 0,
    streakBonusDays: 0,
    streakBonusCredit: 0,
    ...overrides,
  }
}

/** Deps whose only account is `uid-1`. */
function deps(overrides: {
  status?: WorkBuddyCheckinStatus
  statusThrows?: unknown
  claim?: { credit: number, streakDays: number, isStreakDay: boolean }
  claimThrows?: unknown
  missing?: boolean
} = {}) {
  const claimDailyCheckin = vi.fn(async () => {
    if (overrides.claimThrows !== undefined) throw overrides.claimThrows
    return overrides.claim ?? { credit: 100, streakDays: 1, isStreakDay: false }
  })
  const fetchCheckinStatus = vi.fn(async () => {
    if (overrides.statusThrows !== undefined) throw overrides.statusThrows
    return overrides.status ?? status()
  })
  return {
    claimDailyCheckin,
    fetchCheckinStatus,
    deps: {
      credentialFor: async () => (overrides.missing === true ? undefined : credential()),
      client: { fetchCheckinStatus, claimDailyCheckin },
      wait: async () => {},
    },
  }
}

describe('checkinAccounts', () => {
  it('claims when the window is open and today is unclaimed', async () => {
    const { deps: d, claimDailyCheckin } = deps()
    const rows = await checkinAccounts(['uid-1:'], d)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('claimed')
    expect(rows[0]?.credit).toBe(100)
    expect(rows[0]?.streakDays).toBe(1)
    expect(claimDailyCheckin).toHaveBeenCalledTimes(1)
  })

  it('never re-claims a day already checked in', async () => {
    // The mutation must not happen; "already" is a report, not an action.
    const { deps: d, claimDailyCheckin } = deps({ status: status({ todayCheckedIn: true }) })
    const rows = await checkinAccounts(['uid-1:'], d)
    expect(rows[0]?.status).toBe('already')
    expect(claimDailyCheckin).not.toHaveBeenCalled()
  })

  it('reports a closed window as inactive, not as already', async () => {
    // Claiming is impossible; "already checked in" would be a different claim.
    // This is the upstream's CURRENT state for every account.
    const { deps: d, claimDailyCheckin } = deps({ status: status({ active: false }) })
    const rows = await checkinAccounts(['uid-1:'], d)
    expect(rows[0]?.status).toBe('inactive')
    expect(rows[0]?.activity?.active).toBe(false)
    expect(claimDailyCheckin).not.toHaveBeenCalled()
  })

  it('reports a status failure without attempting a claim', async () => {
    const { deps: d, claimDailyCheckin } = deps({ statusThrows: new Error('upstream 500') })
    const rows = await checkinAccounts(['uid-1:'], d)
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.message).toContain('upstream 500')
    expect(claimDailyCheckin).not.toHaveBeenCalled()
  })

  it('reports a claim failure as that account’s row', async () => {
    const { deps: d } = deps({ claimThrows: new Error('rate limited') })
    const rows = await checkinAccounts(['uid-1:'], d)
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.message).toContain('rate limited')
  })

  it('reports a missing credential rather than throwing', async () => {
    const { deps: d } = deps({ missing: true })
    const rows = await checkinAccounts(['uid-1:'], d)
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.message).toContain('no stored credential')
  })

  it('continues the batch after one account fails', async () => {
    // Aborting would hide the state of every account after the bad one.
    let call = 0
    const rows = await checkinAccounts(['a', 'b', 'c'], {
      credentialFor: async id => credential(id),
      client: {
        fetchCheckinStatus: async () => {
          call += 1
          if (call === 2) throw new Error('boom')
          return status({ active: false })
        },
        claimDailyCheckin: async () => ({ credit: 1, streakDays: 1, isStreakDay: false }),
      },
      wait: async () => {},
    })
    expect(rows.map(row => row.status)).toEqual(['inactive', 'failed', 'inactive'])
  })

  it('never throws, whatever the client does', async () => {
    await expect(checkinAccounts(['a'], {
      credentialFor: async () => { throw new Error('store exploded') },
      client: {
        fetchCheckinStatus: async () => status(),
        claimDailyCheckin: async () => ({ credit: 1, streakDays: 1, isStreakDay: false }),
      },
      wait: async () => {},
    })).resolves.toHaveLength(1)
  })

  it('reports each row as it completes', async () => {
    const seen: WorkBuddyCheckinRow[] = []
    await checkinAccounts(['a', 'b'], {
      credentialFor: async id => credential(id),
      client: {
        fetchCheckinStatus: async () => status({ active: false }),
        claimDailyCheckin: async () => ({ credit: 1, streakDays: 1, isStreakDay: false }),
      },
      wait: async () => {},
      onRow: row => seen.push(row),
    })
    expect(seen.map(row => row.accountId)).toEqual(['a', 'b'])
  })

  it('waits between accounts but not before the first', async () => {
    const waits: number[] = []
    await checkinAccounts(['a', 'b', 'c'], {
      credentialFor: async id => credential(id),
      client: {
        fetchCheckinStatus: async () => status({ active: false }),
        claimDailyCheckin: async () => ({ credit: 1, streakDays: 1, isStreakDay: false }),
      },
      wait: async ms => { waits.push(ms) },
    })
    expect(waits).toEqual([CHECKIN_BATCH_GAP_MS, CHECKIN_BATCH_GAP_MS])
  })

  it('does nothing for an empty list', async () => {
    const { deps: d, fetchCheckinStatus } = deps()
    expect(await checkinAccounts([], d)).toEqual([])
    expect(fetchCheckinStatus).not.toHaveBeenCalled()
  })
})
