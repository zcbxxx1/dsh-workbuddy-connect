/**
 * The live account pool: discover accounts, decide who pays, fail over.
 *
 * This is the wiring layer. The rules live in `account-pool.ts` (pure, tested)
 * and the persistence in `pool-store.ts`; here they meet the credential store
 * and the upstream client.
 *
 * Behaviour, stated plainly because it is the whole feature:
 *
 *   - **Off (default).** No pool, no rotation: the live desktop sign-in pays,
 *     exactly as before. Existing users see no change until they opt in.
 *   - **On.** Every request goes to the highest-ranked usable member, and a
 *     request that fails upstream is retried on the next member. Only a
 *     genuinely unusable request (HTTP 400) stops immediately — the same body
 *     would fail on every account, so retrying would only waste time.
 *
 * @module dsh-workbuddy-connect/account-pool-runtime
 */

import type { WorkBuddyCredential, WorkBuddyCredentialStore } from './auth.ts'
import { accountIdOf, discoverAccounts, type DiscoveredAccount } from './account-discovery.ts'
import {
  rankPool,
  type WorkBuddyPoolAccount,
  type WorkBuddyPoolMember,
  type WorkBuddyPoolOutcome,
  type WorkBuddyPoolRanked,
} from './account-pool.ts'
import type { WorkBuddyPoolStore } from './pool-store.ts'
import type { WorkBuddyAtRestKeyProvider } from './desktop-credential-protection.ts'
import type { WorkBuddyVariant } from './variants.ts'

/** Why one request moved to another account. */
export interface WorkBuddyFailoverRecord {
  fromAccountId: string
  toAccountId: string
  outcome: WorkBuddyPoolOutcome
  message: string
}

/** Options for {@link WorkBuddyAccountPool}. */
export interface WorkBuddyAccountPoolOptions {
  variant: WorkBuddyVariant
  store: WorkBuddyCredentialStore
  poolStore: WorkBuddyPoolStore
  /**
   * Opens the at-rest key for discovery.
   *
   * Structural rather than the full provider class: discovery needs only this
   * one method, and narrowing it keeps the pool constructible in tests.
   */
  keyProvider: Pick<WorkBuddyAtRestKeyProvider, 'protectorKeyFor'>
  /** Whether rotation is enabled; read per call so a toggle applies live. */
  enabled: () => boolean
  /** A configured auth-file path, used verbatim instead of the defaults. */
  explicitPath?: () => string | undefined
  /** Injectable clock, for tests. */
  now?: () => number
}

/**
 * Classify an upstream failure into a pool outcome.
 *
 * Mirrors the distinctions the upstream actually draws: a 401 means this token
 * is refused (sign in again), a 429 or the quota code means wait, and a 5xx or
 * transport failure is the gateway's problem rather than this account's — which
 * is why those get a cooldown instead of a permanent exclusion.
 */
export function outcomeOfFailure(status: number, body: string): { outcome: WorkBuddyPoolOutcome, retryAtMs?: number, message: string } {
  const message = body.slice(0, 200)
  if (status === 401 || status === 403) {
    return { outcome: 'credential-rejected', message }
  }
  if (status === 429) {
    return { outcome: 'rate-limited', message }
  }
  // The region's quota code, seen as `code=6004` with a reset sentence.
  if (/"?code"?\s*[:=]\s*6004/u.test(body) || /usage exceeds frequency limit/iu.test(body)) {
    const retryAtMs = parseResetTime(body)
    return { outcome: 'rate-limited', ...retryAtMs === undefined ? {} : { retryAtMs }, message }
  }
  if (/out of credit|insufficient|quota/iu.test(body)) {
    return { outcome: 'out-of-credit', message }
  }
  if (status >= 500 || status === 0) {
    return { outcome: 'failed', message }
  }
  return { outcome: 'unavailable', message }
}

/**
 * Parse the reset instant out of an upstream message.
 *
 * The observed form is `... reset at 2026-10-07 00:06:26 UTC+8` — the timezone
 * carries no colon, so both spellings are accepted. Returns undefined when no
 * time is stated, which the caller must treat as "no answer", never as a
 * locally invented countdown.
 */
export function parseResetTime(message: string, now = Date.now()): number | undefined {
  const match = message.match(
    /reset at (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*UTC([+-])(\d{1,2})(?::?(\d{2}))?/u,
  )
  if (match === null) return undefined
  const [, date, time, sign, hours, minutes] = match
  const utcMs = Date.parse(`${date}T${time}Z`)
  if (Number.isNaN(utcMs)) return undefined
  const offsetMinutes = (Number(hours) * 60 + Number(maybe(minutes))) * (sign === '-' ? -1 : 1)
  const localMs = utcMs - offsetMinutes * 60_000
  return Number.isNaN(localMs) ? undefined : Math.max(now, localMs)
}

/** Coerce a possibly-undefined capture group to a number. */
function maybe(value: string | undefined): number {
  return value === undefined ? 0 : Number(value)
}

/** The live pool for one variant. */
export class WorkBuddyAccountPool {
  private readonly options: WorkBuddyAccountPoolOptions
  private accounts: DiscoveredAccount[] = []
  private discoveredAtMs = 0

  /** How long a discovery result is reused before the directory is re-scanned. */
  private static readonly DISCOVERY_TTL_MS = 60_000

  constructor(options: WorkBuddyAccountPoolOptions) {
    this.options = options
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** The key opener the store already uses, bound to this variant's product. */
  private resolveKey = async (keyIds: readonly string[]): Promise<Buffer> =>
    this.options.keyProvider.protectorKeyFor([...keyIds])

  /**
   * Every discovered account, refreshed on a short TTL.
   *
   * The TTL exists because discovery reads a directory and decrypts each file:
   * cheap enough to do occasionally, too expensive to do per request. A failed
   * scan keeps the previous result rather than emptying the pool.
   */
  async list(force = false): Promise<DiscoveredAccount[]> {
    const now = this.now()
    if (!force && this.accounts.length > 0 && now - this.discoveredAtMs < WorkBuddyAccountPool.DISCOVERY_TTL_MS) {
      return this.accounts
    }
    try {
      const found = await discoverAccounts(
        this.options.variant,
        this.resolveKey,
        this.options.explicitPath?.(),
      )
      this.accounts = found
      this.discoveredAtMs = now
    } catch {
      // Keep whatever was last known: an unreadable key helper must not look
      // like "this machine has no accounts".
      if (this.accounts.length === 0) this.accounts = []
    }
    return this.accounts
  }

  /** The credential for one account id, if it is currently discovered. */
  async credentialFor(accountId: string): Promise<WorkBuddyCredential | undefined> {
    const accounts = await this.list()
    return accounts.find(account => accountIdOf(account.credential) === accountId)?.credential
  }

  /** Ranked members, using the persisted member list and measurements. */
  async ranked(nowMs = this.now()): Promise<WorkBuddyPoolRanked[]> {
    const accounts = await this.list()
    const members = new Set(this.options.poolStore.members())
    const rows: WorkBuddyPoolMember[] = accounts
      .filter(account => members.has(accountIdOf(account.credential)))
      .map(account => {
        const id = accountIdOf(account.credential)
        const probe = this.options.poolStore.probeOf(id)
        return {
          account: { id, accountName: account.credential.nickname ?? '' },
          ...probe === undefined ? {} : { probe },
          tokenExpiresAtMs: account.credential.expiresAtMs,
        }
      })
    return rankPool(rows, nowMs)
  }

  /**
   * The credential to bill for the next request.
   *
   * With the pool off, or with no members, this returns the store's own
   * resolution — the live sign-in — so the default path is untouched.
   */
  async select(): Promise<WorkBuddyCredential> {
    if (!this.options.enabled()) return this.options.store.resolve()
    // `ranked()` already applied the rules, so the first non-excluded row is
    // the winner — re-ranking here would be a second, divergent decision.
    const winner = (await this.ranked()).find(row => row.excludedBy === undefined)
    if (winner === undefined) {
      // No usable member: fall back to the store so the request still has a
      // chance, rather than failing with a pool error the user cannot act on.
      return this.options.store.resolve()
    }
    const credential = await this.credentialFor(winner.account.id)
    return credential ?? this.options.store.resolve()
  }

  /** Record a measurement for the account that just served a request. */
  record(accountId: string, outcome: WorkBuddyPoolOutcome, message: string, retryAtMs?: number): void {
    this.options.poolStore.recordProbe(
      accountId,
      {
        outcome,
        atMs: this.now(),
        message,
        ...retryAtMs === undefined ? {} : { retryAtMs },
      },
      'live-request',
    )
  }

  /**
   * Run one request with failover.
   *
   * The callback receives a credential and returns a result; a thrown
   * `WorkBuddyPoolUpstreamError` (or any error carrying `poolStatus`) is
   * classified and, when retryable, the next member is tried.
   *
   * A 400 stops immediately: the same request body would be rejected by every
   * account, so retrying spends time and reveals nothing.
   */
  async run<T>(
    attempt: (credential: WorkBuddyCredential, accountId: string) => Promise<T>,
  ): Promise<T> {
    if (!this.options.enabled()) {
      const credential = await this.options.store.resolve()
      return attempt(credential, accountIdOf(credential))
    }

    const ranked = await this.ranked()
    const usable = ranked.filter(row => row.excludedBy === undefined)
    // Always include the store's own credential as a last resort, so an
    // empty member list behaves like the pool being off rather than failing.
    const order: WorkBuddyPoolAccount[] = usable.length > 0
      ? usable.map(row => row.account)
      : []

    let lastError: unknown
    for (const account of order) {
      const credential = await this.credentialFor(account.id)
      if (credential === undefined) continue
      try {
        const result = await attempt(credential, account.id)
        this.record(account.id, 'ok', '')
        return result
      } catch (error: unknown) {
        const status = statusOf(error)
        if (status === 400) throw error
        const body = messageOf(error)
        const classified = outcomeOfFailure(status, body)
        this.record(account.id, classified.outcome, classified.message, classified.retryAtMs)
        lastError = error
      }
    }
    if (lastError !== undefined) throw lastError
    // No usable member at all: behave like the pool being off.
    const credential = await this.options.store.resolve()
    return attempt(credential, accountIdOf(credential))
  }

  /** Public snapshot for the status document. */
  async snapshot(): Promise<{
    enabled: boolean
    accounts: { id: string, name: string, live: boolean, member: boolean, excludedBy?: string, expiresAtMs: number }[]
  }> {
    const accounts = await this.list()
    const members = new Set(this.options.poolStore.members())
    const ranked = await this.ranked()
    const excluded = new Map(ranked.map(row => [row.account.id, row.excludedBy]))
    return {
      enabled: this.options.enabled(),
      accounts: accounts.map(account => {
        const id = accountIdOf(account.credential)
        const excludedBy = excluded.get(id)
        return {
          id,
          name: account.credential.nickname ?? '',
          live: account.live,
          member: members.has(id),
          ...excludedBy === undefined ? {} : { excludedBy },
          expiresAtMs: account.credential.expiresAtMs,
        }
      }),
    }
  }
}

/** Read a `status` off an unknown error, for classification. */
function statusOf(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { poolStatus?: unknown, status?: unknown }).poolStatus
      ?? (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return 0
}

/** Read a message off an unknown error. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
