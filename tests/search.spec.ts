/**
 * WorkBuddy search: the upstream call and its normalization.
 *
 * Every case here pins behaviour the endpoint actually exhibits — a business
 * `code`, results without a URL, and the `-site:` folding for blocked domains —
 * because search reaches the network on a path no model request covers, so a
 * regression would otherwise only show up as an empty tool result.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkBuddyCredential } from '../src/auth.ts'
import {
  applyBlockedDomains,
  formatSearchOutcome,
  isValidFreshness,
  searchBase,
  searchWorkBuddy,
  SEARCH_PATH,
} from '../src/search.ts'

function credential(overrides: Partial<WorkBuddyCredential> = {}): WorkBuddyCredential {
  return {
    accessToken: 'token-value',
    refreshToken: 'refresh-value',
    expiresAtMs: Date.now() + 3_600_000,
    domain: 'www.workbuddy.ai',
    uid: 'uid-1',
    enterpriseId: 'ent-1',
    nickname: 'tester',
    source: 'desktop',
    ...overrides,
  }
}

/** A `Response`-shaped stub; the code only reads `ok`, `status`, `text`, `json`. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })

describe('searchBase', () => {
  it('uses the international host for a global credential', () => {
    expect(searchBase(credential({ domain: 'www.workbuddy.ai' }))).toBe('https://www.workbuddy.ai')
  })
  it('uses the CN host for a CN credential', () => {
    expect(searchBase(credential({ domain: 'www.codebuddy.cn' }))).toBe('https://www.codebuddy.cn')
  })
  it('treats a bare workbuddy.ai domain as global', () => {
    expect(searchBase(credential({ domain: 'workbuddy.ai' }))).toBe('https://www.workbuddy.ai')
  })
})

describe('applyBlockedDomains', () => {
  it('returns the query unchanged when nothing is blocked', () => {
    expect(applyBlockedDomains('rust', undefined)).toBe('rust')
    expect(applyBlockedDomains('rust', [])).toBe('rust')
  })
  it('folds blocked domains into the query as -site: terms', () => {
    expect(applyBlockedDomains('rust', ['a.com', 'b.com'])).toBe('rust (-site:a.com -site:b.com)')
  })
  it('ignores empty entries', () => {
    expect(applyBlockedDomains('rust', ['a.com', ''])).toBe('rust (-site:a.com)')
  })
})

describe('isValidFreshness', () => {
  it('accepts the documented grammar', () => {
    for (const value of ['d', 'd1', 'd30', 'm', 'm1', 'm12', 'y', 'y1', 'y5']) {
      expect(isValidFreshness(value)).toBe(true)
    }
  })
  it('rejects out-of-range and free-form values', () => {
    for (const value of ['d31', 'm13', 'y9', 'weekly', '', 'D1']) {
      expect(isValidFreshness(value)).toBe(false)
    }
  })
})

describe('searchWorkBuddy', () => {
  it('posts the documented body to the region host with the bearer token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [], total_results: 0 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await searchWorkBuddy(credential(), { query: 'hello', maxResults: 3 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://www.workbuddy.ai${SEARCH_PATH}`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-value')
    expect((init.headers as Record<string, string>)['X-User-Id']).toBe('uid-1')
    expect((init.headers as Record<string, string>)['X-Enterprise-Id']).toBe('ent-1')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'hello', type: 'text2text', max_results: 3 })
  })

  it('sends allowed_domains and freshness only when provided', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await searchWorkBuddy(credential(), { query: 'q', allowedDomains: ['ok.com'], freshness: 'm1' })
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      query: 'q',
      type: 'text2text',
      max_results: 8,
      allowed_domains: ['ok.com'],
      freshness: 'm1',
    })

    await searchWorkBuddy(credential(), { query: 'q' })
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      query: 'q',
      type: 'text2text',
      max_results: 8,
    })
  })

  it('clamps maxResults into the endpoint’s accepted range', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await searchWorkBuddy(credential(), { query: 'q', maxResults: 999 })
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)['max_results']).toBe(50)

    await searchWorkBuddy(credential(), { query: 'q', maxResults: 0 })
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)['max_results']).toBe(1)
  })

  it('normalizes results and drops rows without a URL', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      results: [
        { title: 'A', url: 'https://a.test', snippet: 'sa' },
        { title: 'no url' },
        { title: 'B', url: '  https://b.test  ' },
        null,
      ],
      total_results: 4,
      response_time_ms: 123,
    })) as unknown as typeof fetch

    const outcome = await searchWorkBuddy(credential(), { query: 'q' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.results).toEqual([
      { url: 'https://a.test', title: 'A', snippet: 'sa' },
      { url: 'https://b.test', title: 'B', snippet: '' },
    ])
    expect(outcome.totalResults).toBe(4)
    expect(outcome.elapsedMs).toBe(123)
  })

  it('falls back to the local count when the endpoint omits total_results', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test' }] })) as unknown as typeof fetch
    const outcome = await searchWorkBuddy(credential(), { query: 'q' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.totalResults).toBe(1)
  })

  it('reports a business code as a failure rather than an empty success', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ code: 15001, msg: 'rate limit' })) as unknown as typeof fetch
    const outcome = await searchWorkBuddy(credential(), { query: 'q' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.message).toContain('15001')
    expect(outcome.message).toContain('rate limit')
  })

  it('treats code 0 as success', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ code: 0, msg: '', results: [{ url: 'https://a.test' }] })) as unknown as typeof fetch
    const outcome = await searchWorkBuddy(credential(), { query: 'q' })
    expect(outcome.ok).toBe(true)
  })

  it('carries the HTTP status on a non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ msg: 'unauthorized' }, 401)) as unknown as typeof fetch
    const outcome = await searchWorkBuddy(credential(), { query: 'q' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.status).toBe(401)
  })

  it('returns a transport failure instead of throwing', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('socket closed') }) as unknown as typeof fetch
    const outcome = await searchWorkBuddy(credential(), { query: 'q' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.status).toBe(0)
      expect(outcome.message).toContain('socket closed')
    }
  })

  it('rejects an empty query and an invalid freshness without calling the network', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect((await searchWorkBuddy(credential(), { query: '   ' })).ok).toBe(false)
    expect((await searchWorkBuddy(credential(), { query: 'q', freshness: 'weekly' })).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('survives an unreadable body', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json') },
      text: async () => '',
    })) as unknown as typeof fetch
    const outcome = await searchWorkBuddy(credential(), { query: 'q' })
    expect(outcome.ok).toBe(false)
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal)
      return jsonResponse({ results: [] })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await searchWorkBuddy(credential(), { query: 'q', signal: controller.signal })
  })
})

describe('formatSearchOutcome', () => {
  it('lists results with url and snippet', () => {
    const text = formatSearchOutcome({
      query: 'q',
      totalResults: 2,
      results: [
        { url: 'https://a.test', title: 'A', snippet: 'sa' },
        { url: 'https://b.test', title: '', snippet: '' },
      ],
    })
    expect(text).toContain('https://a.test')
    expect(text).toContain('sa')
    expect(text).toContain('(untitled)')
    expect(text).toContain('2 result')
  })

  it('states plainly when nothing was found', () => {
    expect(formatSearchOutcome({ query: 'q', results: [], totalResults: 0 })).toContain('No results')
  })
})
