/**
 * The account pool: which local account should be billed, and why.
 *
 * Ported from `dsh-connect-workbuddy` (`src/account-pool.ts`, MIT,
 * Copyright (c) 2026 LaoDing) — see THIRD_PARTY_NOTICES.md. The ranking rules
 * and their reasoning are that project's, kept verbatim where they still apply;
 * what changed is the surrounding types, because this plugin's probe records
 * carry a different (smaller) outcome set than the source's.
 *
 * This module is deliberately PURE: no network, no filesystem. That is what
 * lets the rules be pinned by unit tests, and they encode three conclusions
 * that cannot be guessed:
 *
 *   1. **A missing credit multiplier is not free.** Upstream multipliers come
 *      from the `credits` string (`x0.00`). The CN static fallback catalog
 *      carries no multiplier at all, so "absent" is normal there. Reading
 *      `undefined` as 0 would treat paid models as free.
 *   2. **No free model means no fallback to a paid one.** Better to report
 *      "no free model in this region" than to silently spend credits.
 *   3. **`rate-limited` is temporary.** It is the very state this feature
 *      exists to route around; treating it as permanent throws away a working
 *      account.
 *
 * @module dsh-workbuddy-connect/account-pool
 */

/** One account the pool can bill. */
export interface WorkBuddyPoolAccount {
  /** Stable account id (`uid:enterpriseId`, or the uid alone). */
  id: string
  /** Human name, or `''` when the desktop app recorded none. */
  accountName: string
}

/**
 * One account's last measured outcome.
 *
 * The source project records a rich eight-way outcome from a real-volume probe.
 * This plugin's probe answers only "does this model accept these reasoning
 * efforts", so the pool keeps the smaller set that is actually produced here,
 * plus the transport-level failures the shim can observe on a live request.
 */
export type WorkBuddyPoolOutcome =
  | 'ok'
  | 'rate-limited'
  | 'out-of-credit'
  | 'credential-rejected'
  | 'policy-rejected'
  | 'unavailable'
  | 'failed'

/** Which writer produced a measurement. Diagnostic, not behavioural. */
export type WorkBuddyPoolProbeSource = 'test-batch' | 'live-request'

/** One account's last measurement. */
export interface WorkBuddyPoolProbe {
  outcome: WorkBuddyPoolOutcome
  /** When the measurement was taken, epoch ms. */
  atMs: number
  source?: WorkBuddyPoolProbeSource
  /**
   * When the account may be usable again, when upstream stated a time.
   * ABSENT when it did not — that absence is meaningful and must never become
   * a locally invented countdown.
   */
  retryAtMs?: number
  /** The upstream's own words, already redacted, for the card to explain. */
  message?: string
}

/** One account's live credit situation, as the pool ranks it. */
export interface WorkBuddyPoolCredits {
  total: number
  /** Credits expiring within the card's "soon" window. */
  expiringSoon: number
  /** When the nearest package expires, if any does. */
  nearestExpiryMs?: number
}

/** Everything the ranking rule reads about one account. */
export interface WorkBuddyPoolMember {
  account: WorkBuddyPoolAccount
  credits?: WorkBuddyPoolCredits
  probe?: WorkBuddyPoolProbe
  /** Credential expiry, used as a late tie-break. */
  tokenExpiresAtMs?: number
}

/**
 * Why one account was excluded from being billed.
 *
 * Reported per account rather than collapsed into "no candidate", because the
 * reasons call for different actions (wait / re-auth / top up).
 */
export type WorkBuddyPoolExclusion =
  | 'unusable'
  | 'rate-limited'
  | 'out-of-credit'
  | 'credential-rejected'
  | 'unavailable'
  | 'failed'

/** One ranked account: its score, and whether it can serve right now. */
export interface WorkBuddyPoolRanked {
  account: WorkBuddyPoolAccount
  /** Higher wins. Only comparable within one ranking call. */
  score: number
  /** Absent when the account is a candidate; set when it is excluded. */
  excludedBy?: WorkBuddyPoolExclusion
}

/**
 * How long an account stays out when upstream stated no time.
 *
 * A conservative FALLBACK, not a measurement. Both directions it avoids matter:
 * keeping the account in would re-bill and re-trip the same limit; dropping it
 * forever would discard a working account over an event that said nothing about
 * it. A short stated cooldown is the least-wrong, and it is what lets the pool
 * heal itself, since nothing else re-probes an excluded member.
 */
export const POOL_UNKNOWN_COOLDOWN_MS = 30 * 60_000

/**
 * Whether an account's cooldown has elapsed (or was never stated).
 *
 * The fallback is the only thing a transient outcome relies on: `retryAtMs` is
 * attached for a rate limit or a drained quota, never for a transport failure,
 * so `atMs + POOL_UNKNOWN_COOLDOWN_MS` is what brings those back.
 */
function retryDue(probe: WorkBuddyPoolProbe, nowMs: number): boolean {
  const until = probe.retryAtMs ?? probe.atMs + POOL_UNKNOWN_COOLDOWN_MS
  return nowMs >= until
}

/**
 * Whether one account can be billed at `nowMs`, or why not.
 *
 * Order is not arbitrary:
 * - `credential-rejected` is excluded regardless of any cooldown: the token is
 *   not accepted, so waiting cannot help and the user must sign in again.
 * - limited / unreachable / failed outcomes are checked against their stated
 *   (or fallback) cooldown, so an account whose limit already reset — or whose
 *   gateway blipped once — returns without needing another test first.
 * - `ok` and "never measured" are both candidates. The latter matters: a newly
 *   discovered account has never been tested and must not be invisible.
 *
 * `policy-rejected` is a fact about ONE REQUEST, not about the account: the
 * server refused that message's content, and the same account will serve a
 * different one. Benching it would idle a healthy account over a single tripped
 * filter. The measurement is still recorded so the card can explain it.
 */
export function exclusionOf(
  probe: WorkBuddyPoolProbe | undefined,
  nowMs: number,
): WorkBuddyPoolExclusion | undefined {
  if (probe === undefined) return undefined
  switch (probe.outcome) {
    case 'ok':
      return undefined
    case 'credential-rejected':
      return 'credential-rejected'
    case 'unavailable':
      return retryDue(probe, nowMs) ? undefined : 'unavailable'
    case 'failed':
      return retryDue(probe, nowMs) ? undefined : 'failed'
    case 'rate-limited':
      return retryDue(probe, nowMs) ? undefined : 'rate-limited'
    case 'out-of-credit':
      return retryDue(probe, nowMs) ? undefined : 'out-of-credit'
    case 'policy-rejected':
      return undefined
    default:
      // An outcome this build does not know is treated as unusable rather than
      // as a candidate: billing through a state we cannot interpret is worse.
      // It keeps the no-cooldown treatment too — a state we cannot read is not
      // one we should re-enter on a timer.
      return 'unusable'
  }
}

/**
 * The credit figure used for ordering.
 *
 * Absent credits rank as zero. Deliberately NOT "unknown ranks first": an
 * account whose balance could not be read must never outrank one we positively
 * know is full, or a failing credits route would capture all the traffic.
 */
function scoreOf(member: WorkBuddyPoolMember): number {
  return member.credits?.total ?? 0
}

/**
 * Rank a pool's members best-first.
 *
 * The rule, in priority order:
 *
 * 1. **Usability.** Only accounts that can be billed now are candidates; they
 *    always outrank every excluded one.
 * 2. **Credits, highest first.** Spend the fullest account, so one running low
 *    is conserved rather than drained first.
 * 3. **Credits expiring soonest first.** Points about to expire are worth zero
 *    after they do, so using them earlier is strictly better than saving them.
 * 4. **Freshest credential.** Tie-break so a stale token never wins a draw.
 * 5. **Account id.** Final tie-break, making the order TOTAL: two accounts
 *    equal on every key would otherwise keep the caller's array order, so the
 *    same pool could rotate differently between runs.
 *
 * Excluded accounts are still RETURNED (sorted after the candidates) so the
 * card can explain why each is out; they differ by `excludedBy` being set,
 * never by being silently dropped.
 *
 * Pure and total: same input, same order; never throws on missing data.
 */
export function rankPool(
  members: readonly WorkBuddyPoolMember[],
  nowMs: number,
): WorkBuddyPoolRanked[] {
  const rows = members.map(member => {
    const excludedBy = exclusionOf(member.probe, nowMs)
    return {
      account: member.account,
      score: scoreOf(member),
      ...excludedBy === undefined ? {} : { excludedBy },
      _usable: excludedBy === undefined,
      _expiring: member.credits?.nearestExpiryMs ?? Number.POSITIVE_INFINITY,
      _tokenExpiresAtMs: member.tokenExpiresAtMs ?? 0,
    }
  })
  rows.sort((left, right) => {
    if (left._usable !== right._usable) return left._usable ? -1 : 1
    if (left.score !== right.score) return right.score - left.score
    if (left._expiring !== right._expiring) return left._expiring - right._expiring
    if (left._tokenExpiresAtMs !== right._tokenExpiresAtMs) {
      return right._tokenExpiresAtMs - left._tokenExpiresAtMs
    }
    return left.account.id < right.account.id ? -1 : left.account.id > right.account.id ? 1 : 0
  })
  return rows.map(({ account, score, excludedBy }) => ({
    account,
    score,
    ...excludedBy === undefined ? {} : { excludedBy },
  }))
}

/**
 * The account to bill, or undefined when the pool has no usable member.
 *
 * A thin selector over {@link rankPool} so the winner is decided in exactly one
 * place: every caller that needs "who serves now" gets the same answer.
 */
export function pickAccount(
  members: readonly WorkBuddyPoolMember[],
  nowMs: number,
): WorkBuddyPoolAccount | undefined {
  return rankPool(members, nowMs).find(row => row.excludedBy === undefined)?.account
}

/**
 * The checked ids that still resolve to a local sign-in, in the caller's order.
 *
 * One home for "effective members": the same predicate written twice is how
 * "fixed one end, missed the other" happens.
 */
export function effectiveMembersOf(
  orderedIds: readonly string[],
  listedIds: ReadonlySet<string>,
): string[] {
  return orderedIds.filter(id => listedIds.has(id))
}

/**
 * Pick the free model to test against, from one region's catalog.
 *
 * "Free" means `creditMultiplier === 0` EXACTLY. An absent multiplier is NOT
 * free — the CN static fallback carries no multiplier at all, so treating
 * absence as zero would silently bill real credits.
 *
 * Returns undefined when the region has no free model, which the caller must
 * render as "none available" — never as a fallback to a paid model.
 */
export function pickFreeModel(
  catalog: readonly { id: string, creditMultiplier?: number, contextWindow?: number }[],
): { id: string } | undefined {
  let best: { id: string, contextWindow: number } | undefined
  for (const model of catalog) {
    if (model.creditMultiplier !== 0) continue
    const contextWindow = model.contextWindow ?? 0
    if (best === undefined || contextWindow > best.contextWindow) {
      best = { id: model.id, contextWindow }
    }
  }
  return best === undefined ? undefined : { id: best.id }
}
