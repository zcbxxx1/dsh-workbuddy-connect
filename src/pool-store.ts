/**
 * Persistence for the account pool: which accounts are members, and what each
 * one last measured.
 *
 * Follows this plugin's existing store conventions (`probe-store.ts`): the file
 * lives beside the plugin's own credential copy under `$DSH_HOME`, is written
 * atomically, and carries no token, prompt, or response body — only account
 * ids, outcome names, timestamps, and the upstream's already-redacted message.
 *
 * Two kinds of state share the file, and the split matters:
 *
 *   - **`members`** is a USER DECISION (which accounts may be billed). It is
 *     written only when the user changes it.
 *   - **`probes`** is an OBSERVATION written by the plugin as requests fail or
 *     succeed. Keeping it in the same file but a different field means a
 *     measurement can never overwrite the user's selection.
 *
 * @module dsh-workbuddy-connect/pool-store
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { WorkBuddyPoolOutcome, WorkBuddyPoolProbe, WorkBuddyPoolProbeSource } from './account-pool.ts'

/** On-disk format this reader accepts; other versions read as empty. */
const POOL_FORMAT_VERSION = 1

/** One account's persisted measurement. */
interface StoredProbe {
  outcome: WorkBuddyPoolOutcome
  atMs: number
  source?: WorkBuddyPoolProbeSource
  retryAtMs?: number
  message?: string
}

/** The whole document. */
interface PoolDocument {
  version: number
  /** Account ids the user has admitted to the pool. Empty means "no pool". */
  members: string[]
  /** Account id → its last measurement. */
  probes: Record<string, StoredProbe>
  /**
   * Whether rotation is on.
   *
   * Stored here rather than in the plugin config because DSH 0.2.0 removed the
   * settings-section API this plugin used to persist preferences through, so a
   * toggle the user flips at runtime has nowhere else to be written. The
   * `accountPool` config field still provides the initial value.
   *
   * ABSENT means "never set", which the reader resolves to the config default
   * rather than to `false` — otherwise turning the feature on in the profile
   * would be silently overridden by this file the first time it is read.
   */
  enabled?: boolean
  /** Whether the host attempts check-in at startup. Absent means "not set". */
  autoCheckin?: boolean
}

/** Basename of the pool file inside the Harness home. */
export const WORKBUDDY_POOL_FILENAME = '.workbuddy-pool.json'

/** Where one variant's pool file lives. */
export function workbuddyPoolPath(variantId: string): string {
  // Per variant, like the catalogs and probe records: the two products share
  // account ids in principle, and one region's members must never answer for
  // the other's.
  const suffix = variantId === '' ? '' : `-${variantId}`
  return join(resolveDshHome(), `${WORKBUDDY_POOL_FILENAME.replace(/\.json$/u, '')}${suffix}.json`)
}

function emptyDocument(): PoolDocument {
  return { version: POOL_FORMAT_VERSION, members: [], probes: {} }
}

/** Read the document, tolerating a missing or unreadable file as empty. */
export function readPoolDocument(path: string): PoolDocument {
  if (!existsSync(path)) return emptyDocument()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return emptyDocument()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return emptyDocument()
  const record = parsed as Record<string, unknown>
  if (record['version'] !== POOL_FORMAT_VERSION) return emptyDocument()

  const members = Array.isArray(record['members'])
    ? record['members'].filter((value): value is string => typeof value === 'string' && value !== '')
    : []
  const probes: Record<string, StoredProbe> = {}
  const rawProbes = record['probes']
  if (typeof rawProbes === 'object' && rawProbes !== null && !Array.isArray(rawProbes)) {
    for (const [id, value] of Object.entries(rawProbes as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const probe = value as Record<string, unknown>
      const outcome = probe['outcome']
      const atMs = probe['atMs']
      if (typeof outcome !== 'string' || typeof atMs !== 'number') continue
      probes[id] = {
        outcome: outcome as WorkBuddyPoolOutcome,
        atMs,
        ...typeof probe['source'] === 'string' ? { source: probe['source'] as WorkBuddyPoolProbeSource } : {},
        ...typeof probe['retryAtMs'] === 'number' ? { retryAtMs: probe['retryAtMs'] } : {},
        ...typeof probe['message'] === 'string' ? { message: probe['message'] } : {},
      }
    }
  }
  return {
    version: POOL_FORMAT_VERSION,
    members,
    probes,
    // Only a real boolean is adopted; anything else stays absent so the config
    // default keeps applying.
    ...typeof record['enabled'] === 'boolean' ? { enabled: record['enabled'] } : {},
    ...typeof record['autoCheckin'] === 'boolean' ? { autoCheckin: record['autoCheckin'] } : {},
  }
}

/** Write the document atomically, creating the directory when needed. */
export function writePoolDocument(path: string, document: PoolDocument): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path)
}

/**
 * The pool's persisted state, as the host and the card use it.
 *
 * Reads are cached in memory and re-read when the file's mtime changes, so an
 * edit from the card applies without a restart while a hot request path does
 * not stat the file per call.
 */
export class WorkBuddyPoolStore {
  private readonly path: string
  private cached: PoolDocument | undefined
  private cachedMtimeMs = -1

  constructor(path: string) {
    this.path = path
  }

  /** The file this store reads and writes, for diagnostics. */
  filePath(): string {
    return this.path
  }

  private load(): PoolDocument {
    let mtimeMs = -1
    try {
      mtimeMs = statSync(this.path).mtimeMs
    } catch {
      mtimeMs = -1
    }
    if (this.cached === undefined || mtimeMs !== this.cachedMtimeMs) {
      this.cached = readPoolDocument(this.path)
      this.cachedMtimeMs = mtimeMs
    }
    return this.cached
  }

  /** Account ids the user admitted to the pool, in their saved order. */
  members(): string[] {
    return [...this.load().members]
  }

  /**
   * Whether rotation is on, or `undefined` when the user never set it.
   *
   * `undefined` rather than `false` on purpose: the caller substitutes the
   * config default, so a profile that enables the pool is not silently
   * overridden by an empty state file.
   */
  enabled(): boolean | undefined {
    return this.load().enabled
  }

  /** Persist the rotation toggle. */
  setEnabled(enabled: boolean): void {
    this.write({ ...this.load(), enabled })
  }

  /** Whether startup auto check-in is on, or `undefined` when never set. */
  autoCheckin(): boolean | undefined {
    return this.load().autoCheckin
  }

  /** Persist the startup auto check-in toggle. */
  setAutoCheckin(enabled: boolean): void {
    this.write({ ...this.load(), autoCheckin: enabled })
  }

  /** Write the document and refresh the cache. */
  private write(document: PoolDocument): void {
    writePoolDocument(this.path, document)
    this.cached = document
    this.cachedMtimeMs = Date.now()
  }

  /** Replace the member list. This is the only writer of a user decision. */
  setMembers(ids: readonly string[]): void {
    this.write({ ...this.load(), members: [...new Set(ids.filter(id => id !== ''))] })
  }

  /** One account's last measurement, or undefined when never measured. */
  probeOf(accountId: string): WorkBuddyPoolProbe | undefined {
    const stored = this.load().probes[accountId]
    if (stored === undefined) return undefined
    return {
      outcome: stored.outcome,
      atMs: stored.atMs,
      ...stored.source === undefined ? {} : { source: stored.source },
      ...stored.retryAtMs === undefined ? {} : { retryAtMs: stored.retryAtMs },
      ...stored.message === undefined ? {} : { message: stored.message },
    }
  }

  /**
   * Record one measurement.
   *
   * Never overwrites a NEWER observation with an older one: two writers race
   * (a live request failing while a manual test completes), and the later
   * measurement is the one that describes the account now.
   */
  recordProbe(
    accountId: string,
    probe: WorkBuddyPoolProbe,
    source: WorkBuddyPoolProbeSource,
  ): void {
    if (accountId === '') return
    const document = this.load()
    const existing = document.probes[accountId]
    if (existing !== undefined && existing.atMs > probe.atMs) return
    const next: PoolDocument = {
      ...document,
      probes: {
        ...document.probes,
        [accountId]: {
          outcome: probe.outcome,
          atMs: probe.atMs,
          source,
          ...probe.retryAtMs === undefined ? {} : { retryAtMs: probe.retryAtMs },
          ...probe.message === undefined ? {} : { message: probe.message },
        },
      },
    }
    writePoolDocument(this.path, next)
    this.cached = next
    this.cachedMtimeMs = Date.now()
  }

  /** Forget one account's measurement (e.g. after a successful sign-in). */
  clearProbe(accountId: string): void {
    const document = this.load()
    if (!(accountId in document.probes)) return
    const probes = { ...document.probes }
    delete probes[accountId]
    const next: PoolDocument = { ...document, probes }
    writePoolDocument(this.path, next)
    this.cached = next
    this.cachedMtimeMs = Date.now()
  }
}
