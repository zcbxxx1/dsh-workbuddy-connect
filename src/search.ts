/**
 * WorkBuddy web search, as a DSH tool.
 *
 * The plugin's models ride the chat endpoint; **search rides a different one**.
 * WorkBuddy's own `WebSearch` tool posts to `{base}/agenttool/v1/search` from
 * its client process, and the response is ordinary JSON — not the model wire
 * at all. That is why nothing in the LLM seam can carry it: the models are
 * served through `registerAdapter`, while search has to be a **host tool** the
 * conversation calls directly.
 *
 * This module owns only the upstream call and its normalization. Credentials
 * come in from the caller (the same `WorkBuddyCredentialStore.current()` the
 * chat path uses), so sign-out, region, and token refresh behave identically
 * on both paths.
 *
 * Region note: the endpoint exists on the international host and on the CN
 * host the two products differ by. {@link searchBase} mirrors the chat path's
 * region split rather than assuming one host.
 *
 * @module dsh-workbuddy-connect/search
 */

import type { WorkBuddyCredential } from './auth.ts'
import { regionOf } from './upstream.ts'

/** The CN host that answers `/agenttool/v1/search`. */
const CN_SEARCH_BASE = 'https://www.codebuddy.cn'
/** The international host that answers `/agenttool/v1/search`. */
const GLOBAL_SEARCH_BASE = 'https://www.workbuddy.ai'

/** Path of the search endpoint, appended to the region's base. */
export const SEARCH_PATH = '/agenttool/v1/search'

/**
 * The `freshness` grammar the endpoint accepts: `dN` days, `mN` months,
 * `yN` years, each with the count optional (`d` = today).
 */
const FRESHNESS_PATTERN = /^(?:d(?:[1-9]|[12]\d|30)?|m(?:[1-9]|1[0-2])?|y[1-5]?)$/u

/** One normalized search result. */
export interface WorkBuddySearchResult {
  url: string
  title: string
  snippet: string
}

/** A successful search. */
export interface WorkBuddySearchOutcome {
  query: string
  results: readonly WorkBuddySearchResult[]
  /** Result count the endpoint reported, before any local truncation. */
  totalResults: number
  /** Server-side elapsed time in milliseconds, when reported. */
  elapsedMs?: number
}

/** A failed search, carrying the status so callers can classify it. */
export interface WorkBuddySearchFailure {
  ok: false
  /** HTTP status, or 0 for a transport error. */
  status: number
  message: string
}

/** The result of one search call. */
export type WorkBuddySearchResponse =
  | ({ ok: true } & WorkBuddySearchOutcome)
  | WorkBuddySearchFailure

/** Options for one search. */
export interface WorkBuddySearchOptions {
  query: string
  /** Result cap sent upstream; the endpoint clamps its own maximum. */
  maxResults?: number
  /** Restrict to these domains. */
  allowedDomains?: readonly string[]
  /**
   * Exclude these domains. The endpoint has no such field, so the exclusion is
   * folded into the query as `-site:` terms, which is what WorkBuddy's own
   * client does.
   */
  blockedDomains?: readonly string[]
  /** Freshness window in the `dN`/`mN`/`yN` grammar. */
  freshness?: string
  signal?: AbortSignal
}

/** Resolve the region-appropriate search host for a credential. */
export function searchBase(credential: WorkBuddyCredential): string {
  return regionOf(credential.domain) === 'global' ? GLOBAL_SEARCH_BASE : CN_SEARCH_BASE
}

/**
 * Fold blocked domains into the query text.
 *
 * The endpoint accepts only `query`, `type`, `max_results`, `allowed_domains`,
 * and `freshness`; there is no negative-domain field, so the client's own
 * convention — parenthesized `-site:` terms appended to the query — is what
 * carries the intent.
 */
export function applyBlockedDomains(query: string, blockedDomains?: readonly string[]): string {
  const terms = (blockedDomains ?? []).filter(domain => domain !== '').map(domain => `-site:${domain}`)
  return terms.length === 0 ? query : `${query} (${terms.join(' ')})`
}

/** Whether a value is acceptable for the `freshness` field. */
export function isValidFreshness(value: string): boolean {
  return FRESHNESS_PATTERN.test(value)
}

/** Headers for a search request, mirroring the client's own tool call. */
function searchHeaders(credential: WorkBuddyCredential): Record<string, string> {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Authorization': `Bearer ${credential.accessToken}`,
    ...credential.uid === '' ? {} : { 'X-User-Id': credential.uid },
    ...credential.enterpriseId === undefined || credential.enterpriseId === ''
      ? {}
      : { 'X-Enterprise-Id': credential.enterpriseId, 'X-Tenant-Id': credential.enterpriseId },
    ...credential.domain === '' ? {} : { 'X-Domain': credential.domain },
  }
}

/**
 * Run one search against the WorkBuddy endpoint.
 *
 * Never throws for an upstream or transport failure: the failure is returned as
 * `{ ok: false }` so a tool call can report it as tool output rather than
 * turning the whole conversation turn into an error.
 */
export async function searchWorkBuddy(
  credential: WorkBuddyCredential,
  options: WorkBuddySearchOptions,
): Promise<WorkBuddySearchResponse> {
  const query = options.query.trim()
  if (query === '') return { ok: false, status: 0, message: 'search query is empty' }

  if (options.freshness !== undefined && !isValidFreshness(options.freshness)) {
    return { ok: false, status: 0, message: `invalid freshness: ${options.freshness}` }
  }

  const body: Record<string, unknown> = {
    query: applyBlockedDomains(query, options.blockedDomains),
    type: 'text2text',
    max_results: Math.max(1, Math.min(options.maxResults ?? 8, 50)),
  }
  if (options.allowedDomains !== undefined && options.allowedDomains.length > 0) {
    body['allowed_domains'] = [...options.allowedDomains]
  }
  if (options.freshness !== undefined) body['freshness'] = options.freshness

  let response: Response
  try {
    response = await fetch(`${searchBase(credential)}${SEARCH_PATH}`, {
      method: 'POST',
      headers: searchHeaders(credential),
      body: JSON.stringify(body),
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
  } catch (error: unknown) {
    return { ok: false, status: 0, message: `transport error: ${String(error)}` }
  }

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 300)
    } catch {
      // A body that cannot be read is not worth failing the classification for.
    }
    return { ok: false, status: response.status, message: `HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}` }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error: unknown) {
    return { ok: false, status: response.status, message: `unreadable response body: ${String(error)}` }
  }

  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, status: response.status, message: 'unexpected response shape' }
  }
  const record = payload as Record<string, unknown>

  // A non-zero `code` is the endpoint's business error channel.
  const code = record['code']
  if (typeof code === 'number' && code !== 0) {
    const message = typeof record['msg'] === 'string' ? record['msg'] : 'unknown error'
    return { ok: false, status: response.status, message: `code=${code}: ${message}` }
  }

  const results: WorkBuddySearchResult[] = []
  const raw = record['results']
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      const url = typeof row['url'] === 'string' ? row['url'].trim() : ''
      // A result without a URL cannot be cited, so it is not a result.
      if (url === '') continue
      results.push({
        url,
        title: typeof row['title'] === 'string' ? row['title'] : '',
        snippet: typeof row['snippet'] === 'string' ? row['snippet'] : '',
      })
    }
  }

  const total = record['total_results']
  const elapsed = record['response_time_ms']
  return {
    ok: true,
    query,
    results,
    totalResults: typeof total === 'number' ? total : results.length,
    ...typeof elapsed === 'number' ? { elapsedMs: elapsed } : {},
  }
}

/** Render one outcome as the text a model reads. */
export function formatSearchOutcome(outcome: WorkBuddySearchOutcome): string {
  if (outcome.results.length === 0) return `No results found for “${outcome.query}”.`
  const lines = [`Search “${outcome.query}” — ${outcome.totalResults} result(s):`, '']
  outcome.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title === '' ? '(untitled)' : result.title}`)
    lines.push(`   ${result.url}`)
    if (result.snippet !== '') lines.push(`   ${result.snippet}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}
