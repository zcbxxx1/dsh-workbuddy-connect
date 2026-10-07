/**
 * Daily check-in across the pool's accounts.
 *
 * Ported from `dsh-connect-workbuddy` (`src/account-pool-run.ts`, MIT,
 * Copyright (c) 2026 LaoDing) — see THIRD_PARTY_NOTICES.md.
 *
 * Check-in really grants credit, so two rules are non-negotiable:
 *
 *   1. **Idempotent.** An account already checked in today is reported as
 *      `already` and NOTHING is written. Re-claiming would be a mutation the
 *      upstream never asked for.
 *   2. **A closed window is `inactive`, not `already`.** The upstream's
 *      `active: false` means claiming is impossible right now; reporting
 *      "already checked in" would be a different and wrong claim. Observed
 *      live: every account reports `active: false` with
 *      `claim_button_text: "立即领取"`, so this path is the normal one, not an
 *      edge case.
 *
 * A failure on one account is that row's result and the batch continues:
 * aborting would hide the state of every account after the first bad one.
 *
 * @module dsh-workbuddy-connect/checkin
 */

import type { WorkBuddyCredential } from './auth.ts'
import type { WorkBuddyCheckinStatus, WorkBuddyUpstreamClient } from './upstream.ts'

/** How long to wait between accounts, so a batch does not trip volume limits. */
export const CHECKIN_BATCH_GAP_MS = 400

/** One account's check-in outcome. */
export interface WorkBuddyCheckinRow {
  accountId: string
  accountName: string
  status: 'claimed' | 'already' | 'inactive' | 'failed'
  /** Credit granted, present only on `claimed`. */
  credit?: number
  /** Consecutive days after the claim, present only on `claimed`. */
  streakDays?: number
  /** Why it failed, present only on `failed`. */
  message?: string
  /** The upstream's activity state, when it could be read. */
  activity?: WorkBuddyCheckinStatus
}

/** Dependencies for a check-in run. */
export interface WorkBuddyCheckinDeps {
  credentialFor: (accountId: string) => Promise<WorkBuddyCredential | undefined>
  client: Pick<WorkBuddyUpstreamClient, 'fetchCheckinStatus' | 'claimDailyCheckin'>
  /** Injectable sleep, for tests. */
  wait?: (ms: number) => Promise<void>
  /** Called after each account, so a caller can report progress. */
  onRow?: (row: WorkBuddyCheckinRow) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Sleep between accounts. */
function defaultWait(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Check in every given account, one at a time.
 *
 * Serial on purpose: hitting the whole pool at once is the fastest way to trip
 * the upstream's volume limit. Never throws — every problem becomes a row.
 */
export async function checkinAccounts(
  accountIds: readonly string[],
  deps: WorkBuddyCheckinDeps,
): Promise<WorkBuddyCheckinRow[]> {
  const rows: WorkBuddyCheckinRow[] = []
  for (const [index, accountId] of accountIds.entries()) {
    if (index > 0) await (deps.wait ?? defaultWait)(CHECKIN_BATCH_GAP_MS)
    const row = await checkinOne(accountId, deps)
    rows.push(row)
    deps.onRow?.(row)
  }
  return rows
}

/** One account's check-in, reduced to its row. */
async function checkinOne(accountId: string, deps: WorkBuddyCheckinDeps): Promise<WorkBuddyCheckinRow> {
  const base = { accountId, accountName: '' }
  let credential: WorkBuddyCredential | undefined
  try {
    credential = await deps.credentialFor(accountId)
  } catch (error: unknown) {
    return { ...base, status: 'failed', message: messageOf(error) }
  }
  if (credential === undefined) {
    return { ...base, status: 'failed', message: 'no stored credential for this account' }
  }
  const named = { ...base, accountName: credential.nickname ?? '' }

  let status: WorkBuddyCheckinStatus
  try {
    status = await deps.client.fetchCheckinStatus(credential)
  } catch (error: unknown) {
    return { ...named, status: 'failed', message: messageOf(error) }
  }

  // A closed window is its own outcome: claiming is impossible, and calling it
  // "already checked in" would assert something the upstream never said.
  if (!status.active) return { ...named, status: 'inactive', activity: status }
  if (status.todayCheckedIn) return { ...named, status: 'already', activity: status }

  try {
    const claim = await deps.client.claimDailyCheckin(credential)
    return {
      ...named,
      status: 'claimed',
      credit: claim.credit,
      streakDays: claim.streakDays,
      activity: status,
    }
  } catch (error: unknown) {
    return { ...named, status: 'failed', message: messageOf(error), activity: status }
  }
}
