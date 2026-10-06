/**
 * The `workbuddy_search` host tool: its ToolDefinition contract, credential
 * resolution, and multi-query merging.
 *
 * The registry's own requirements are pinned here — `output.schema` and
 * `output.render` are mandatory, and `execute` returns the canonical value
 * rather than model content — because getting either wrong produces a tool the
 * registry rejects (or an invisible result), which no upstream test would catch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkBuddyCredential } from '../src/auth.ts'
import {
  registerWorkBuddySearchTool,
  renderSearchValue,
  WORKBUDDY_SEARCH_TOOL,
} from '../src/search-tool.ts'

function credential(): WorkBuddyCredential {
  return {
    accessToken: 't',
    refreshToken: 'r',
    expiresAtMs: Date.now() + 3_600_000,
    domain: 'www.workbuddy.ai',
    uid: 'uid-1',
    source: 'desktop',
  }
}

/** A host `tools` service that keeps whatever it was handed. */
function toolsStub() {
  const registered: Record<string, unknown>[] = []
  const disposer = vi.fn()
  return {
    registered,
    disposer,
    service: {
      register(definition: unknown) {
        registered.push(definition as Record<string, unknown>)
        return disposer
      },
    },
  }
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const ctx = { logger } as unknown as Parameters<typeof registerWorkBuddySearchTool>[0]
const exec = { signal: new AbortController().signal } as never

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })

function okFetch(results: { url: string, title?: string, snippet?: string }[], total?: number) {
  const calls: string[] = []
  globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string)['query'] as string)
    return {
      ok: true,
      status: 200,
      json: async () => ({ results, ...total === undefined ? {} : { total_results: total } }),
      text: async () => '',
    } as unknown as Response
  }) as unknown as typeof fetch
  return calls
}

describe('registerWorkBuddySearchTool', () => {
  it('registers a ToolDefinition the host contract accepts', () => {
    const tools = toolsStub()
    const disposer = registerWorkBuddySearchTool(ctx, tools.service, { credential: async () => credential() })

    expect(tools.registered).toHaveLength(1)
    const definition = tools.registered[0]!
    expect(definition['name']).toBe(WORKBUDDY_SEARCH_TOOL)
    expect(typeof definition['description']).toBe('string')
    expect(typeof definition['execute']).toBe('function')
    expect(definition['parameters']).toMatchObject({ type: 'object', required: ['queries'] })
    // output is mandatory and needs both halves.
    const output = definition['output'] as Record<string, unknown>
    expect(output['schema']).toMatchObject({ type: 'object' })
    expect(typeof output['render']).toBe('function')
    expect(disposer).toBe(tools.disposer)
  })

  it('logs the registration', () => {
    registerWorkBuddySearchTool(ctx, toolsStub().service, { credential: async () => credential() })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(WORKBUDDY_SEARCH_TOOL))
  })

  it('returns undefined when the host has no tools service', () => {
    const disposer = registerWorkBuddySearchTool(ctx, {} as never, { credential: async () => credential() })
    expect(disposer).toBeUndefined()
  })

  it('keeps the registration when the logger is unusable', () => {
    // Registration happens first; a host whose `ctx.logger` is shaped
    // differently (or absent) must not lose an already-registered tool.
    const tools = toolsStub()
    const broken = { logger: {} } as unknown as Parameters<typeof registerWorkBuddySearchTool>[0]
    let disposer: (() => void) | undefined
    expect(() => {
      disposer = registerWorkBuddySearchTool(broken, tools.service, { credential: async () => credential() })
    }).not.toThrow()
    expect(tools.registered).toHaveLength(1)
    expect(disposer).toBe(tools.disposer)
  })
})

describe('execute', () => {
  async function invoke(args: unknown, deps?: Parameters<typeof registerWorkBuddySearchTool>[2]) {
    const tools = toolsStub()
    registerWorkBuddySearchTool(ctx, tools.service, deps ?? { credential: async () => credential() })
    const definition = tools.registered[0] as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    return await definition.execute(args, exec)
  }

  it('reports a fatal when no query is supplied, without touching the network', async () => {
    const tools = toolsStub()
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    registerWorkBuddySearchTool(ctx, tools.service, { credential: async () => credential() })
    const definition = tools.registered[0] as { execute: (a: unknown, e: unknown) => Promise<{ fatal?: string }> }

    for (const args of [{}, { queries: [] }, { queries: ['  '] }, { queries: [1, 2] }]) {
      const value = await definition.execute(args, exec)
      expect(value.fatal).toContain('at least one')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the singular query form as a convenience', async () => {
    okFetch([{ url: 'https://a.test' }])
    const value = await invoke({ query: 'rust' }) as { results: unknown[], queries: string[] }
    expect(value.queries).toEqual(['rust'])
    expect(value.results).toHaveLength(1)
  })

  it('merges queries and de-duplicates by URL', async () => {
    const calls = okFetch([{ url: 'https://same.test', title: 'S' }])
    const value = await invoke({ queries: ['one', 'two'] }) as { results: { url: string }[] }
    expect(calls).toEqual(['one', 'two'])
    expect(value.results).toHaveLength(1)
  })

  it('caps the query list at four', async () => {
    const calls = okFetch([{ url: 'https://a.test' }])
    await invoke({ queries: ['a', 'b', 'c', 'd', 'e', 'f'] })
    expect(calls).toHaveLength(4)
  })

  it('reports a signed-out host as fatal rather than an empty result', async () => {
    const tools = toolsStub()
    registerWorkBuddySearchTool(ctx, tools.service, { credential: async () => undefined })
    const definition = tools.registered[0] as { execute: (a: unknown, e: unknown) => Promise<{ fatal?: string }> }
    const value = await definition.execute({ queries: ['q'] }, exec)
    expect(value.fatal).toContain('No WorkBuddy account is signed in')
  })

  it('reports a credential read failure instead of throwing', async () => {
    const tools = toolsStub()
    registerWorkBuddySearchTool(ctx, tools.service, {
      credential: async () => { throw new Error('auth file unreadable') },
    })
    const definition = tools.registered[0] as { execute: (a: unknown, e: unknown) => Promise<{ fatal?: string }> }
    const value = await definition.execute({ queries: ['q'] }, exec)
    expect(value.fatal).toContain('auth file unreadable')
  })

  it('keeps the successful queries when one fails', async () => {
    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call += 1
      if (call === 1) return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } as unknown as Response
      return { ok: true, status: 200, json: async () => ({ results: [{ url: 'https://ok.test' }] }), text: async () => '' } as unknown as Response
    }) as unknown as typeof fetch

    const value = await invoke({ queries: ['bad', 'good'] }) as { results: unknown[], errors?: string[] }
    expect(value.results).toHaveLength(1)
    expect(value.errors).toHaveLength(1)
  })

  it('is fatal when every query fails', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({}), text: async () => 'unauthorized',
    })) as unknown as typeof fetch
    const value = await invoke({ queries: ['a', 'b'] }) as { fatal?: string, results: unknown[] }
    expect(value.fatal).toContain('Search failed')
    expect(value.results).toHaveLength(0)
  })

  it('passes domain and freshness arguments through', async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string) as Record<string, unknown>)
      return { ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '' } as unknown as Response
    }) as unknown as typeof fetch

    await invoke({ queries: ['q'], allowed_domains: ['ok.com'], blocked_domains: ['bad.com'], freshness: 'd7' })
    expect(bodies[0]).toMatchObject({
      allowed_domains: ['ok.com'],
      freshness: 'd7',
    })
    expect(bodies[0]!['query']).toBe('q (-site:bad.com)')
  })

  it('honours the configured result cap', async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string) as Record<string, unknown>)
      return { ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '' } as unknown as Response
    }) as unknown as typeof fetch

    await invoke({ queries: ['q'] }, { credential: async () => credential(), maxResults: 3 })
    expect(bodies[0]!['max_results']).toBe(3)
  })
})

describe('renderSearchValue', () => {
  it('renders a fatal as the whole body', () => {
    expect(renderSearchValue({ queries: ['q'], results: [], totalResults: 0, fatal: 'nope' })).toBe('nope')
  })

  it('renders results as text', () => {
    const text = renderSearchValue({
      queries: ['q'],
      results: [{ url: 'https://a.test', title: 'A', snippet: 'sa' }],
      totalResults: 1,
    })
    expect(text).toContain('https://a.test')
    expect(text).toContain('sa')
  })

  it('appends partial failures', () => {
    const text = renderSearchValue({
      queries: ['a', 'b'],
      results: [{ url: 'https://a.test', title: 'A', snippet: '' }],
      totalResults: 1,
      errors: ['b: HTTP 500'],
    })
    expect(text).toContain('Some queries failed')
    expect(text).toContain('HTTP 500')
  })
})
