/**
 * The Anthropic-Messages search gateway.
 *
 * This is the surface DSH's own `web_search` tool reaches once
 * `web-search-deepseek.baseURL` points here, so its contract is the search
 * plugin's expectations, not ours: at least one `web_search_tool_result` block
 * (a response without one makes the plugin throw), and snippets delivered as
 * `text.citations[].cited_text` (the only place it reads them from).
 */

import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkBuddyCredential } from '../src/auth.ts'
import {
  buildSearchResponse,
  declaresWebSearch,
  extractSearchQuery,
  WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH,
  workBuddySearchGatewayHandler,
} from '../src/search-gateway.ts'

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

/** The body `dsh-web-search-deepseek` actually posts. */
function pluginBody(query = 'test query'): string {
  return JSON.stringify({
    model: 'deepseek-v4-flash',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }] }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  })
}

/** Mount the handler on a real loopback server so headers behave as in production. */
async function withServer(
  deps: Parameters<typeof workBuddySearchGatewayHandler>[0],
  fn: (base: { origin: string, port: number }) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => { void workBuddySearchGatewayHandler(deps)(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn({ origin: `http://127.0.0.1:${port}`, port })
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
}

/** POST the plugin's real body and read the response back. */
async function postPluginBody(
  base: { origin: string, port: number },
  { body = pluginBody(), headers = {} as Record<string, string> } = {},
): Promise<{ status: number, body: string, contentType?: string, cacheControl?: string }> {
  const result = await rawRequest(base.port, WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH, body, headers)
  return { status: result.status, body: result.body }
}

function okFetch(results: { url: string, title?: string, snippet?: string }[]) {
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string) as Record<string, unknown>)
    return {
      ok: true,
      status: 200,
      json: async () => ({ results, total_results: results.length }),
      text: async () => '',
    } as unknown as Response
  }) as unknown as typeof fetch
  return bodies
}

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })

/**
 * The test's own HTTP client.
 *
 * The cases below replace `globalThis.fetch` with a stub of the *upstream*
 * call, so the test must not use the global to reach its own server — it would
 * call the stub. This binding is captured before any stubbing.
 */
const httpFetch = originalFetch

/** Raw request, so a forbidden `Host` header can be set (undici refuses to). */
function rawRequest(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk as Buffer))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('declaresWebSearch', () => {
  it('accepts the hosted tool type and the plain name', () => {
    expect(declaresWebSearch({ tools: [{ type: 'web_search_20250305' }] })).toBe(true)
    expect(declaresWebSearch({ tools: [{ type: 'web_search' }] })).toBe(true)
    expect(declaresWebSearch({ tools: [{ name: 'web_search' }] })).toBe(true)
  })
  it('rejects a chat request without it', () => {
    expect(declaresWebSearch({ tools: [{ type: 'function', name: 'grep' }] })).toBe(false)
    expect(declaresWebSearch({ tools: [] })).toBe(false)
    expect(declaresWebSearch({})).toBe(false)
    expect(declaresWebSearch(null)).toBe(false)
  })
})

describe('extractSearchQuery', () => {
  it('strips the plugin’s instruction prefix', () => {
    expect(extractSearchQuery(JSON.parse(pluginBody('rust async')))).toBe('rust async')
  })
  it('keeps a query that carries no prefix', () => {
    expect(extractSearchQuery({ messages: [{ role: 'user', content: 'plain' }] })).toBe('plain')
  })
  it('ignores non-text blocks', () => {
    expect(extractSearchQuery({
      messages: [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'Perform a web search for the query: x' }] }],
    })).toBe('x')
  })
  it('returns empty for a malformed body', () => {
    expect(extractSearchQuery({})).toBe('')
    expect(extractSearchQuery(null)).toBe('')
  })
})

describe('buildSearchResponse', () => {
  it('always includes a web_search_tool_result block', () => {
    const response = buildSearchResponse('q', [{ url: 'https://a.test', title: 'A', snippet: 'sa' }], 'm')
    const content = response['content'] as { type: string }[]
    expect(content.some(block => block.type === 'web_search_tool_result')).toBe(true)
    expect(response['role']).toBe('assistant')
    expect(response['type']).toBe('message')
  })

  it('delivers snippets as citations, where the plugin reads them', () => {
    const response = buildSearchResponse('q', [{ url: 'https://a.test', title: 'A', snippet: 'sa' }], 'm')
    const content = response['content'] as { type: string, citations?: { url: string, cited_text: string }[] }[]
    const text = content.find(block => block.type === 'text')
    expect(text?.citations?.[0]).toEqual({ type: 'web_search_result_location', url: 'https://a.test', cited_text: 'sa' })
  })

  it('omits the text block when no snippet exists', () => {
    const response = buildSearchResponse('q', [{ url: 'https://a.test', title: 'A', snippet: '' }], 'm')
    const content = response['content'] as { type: string }[]
    expect(content.map(block => block.type)).toEqual(['web_search_tool_result'])
  })

  it('falls back to the URL when a title is missing', () => {
    const response = buildSearchResponse('q', [{ url: 'https://a.test', title: '', snippet: '' }], 'm')
    const block = (response['content'] as { type: string, content: { title: string }[] }[])
      .find(entry => entry.type === 'web_search_tool_result')
    expect(block?.content[0]?.title).toBe('https://a.test')
  })

  it('mirrors what the plugin’s own mapper recovers', () => {
    // Reproduce mapAnthropicResponse: sources joined to citations by URL.
    const response = buildSearchResponse('q', [
      { url: 'https://a.test', title: 'A', snippet: 'sa' },
      { url: 'https://b.test', title: 'B', snippet: '' },
    ], 'm')
    const content = response['content'] as { type: string, content?: { url: string }[], citations?: { url: string, cited_text: string }[] }[]

    const snippets = new Map<string, string>()
    for (const block of content) {
      if (block.type !== 'text') continue
      for (const cite of block.citations ?? []) snippets.set(cite.url, cite.cited_text)
    }
    const sources: { url: string, title?: string, snippet?: string | undefined }[] = []
    for (const block of content) {
      if (block.type !== 'web_search_tool_result') continue
      for (const item of block.content ?? []) {
        const snippet = snippets.get(item.url)
        sources.push({ url: item.url, ...snippet === undefined ? {} : { snippet } })
      }
    }
    expect(sources).toEqual([
      { url: 'https://a.test', snippet: 'sa' },
      { url: 'https://b.test' },
    ])
  })
})

describe('the gateway route', () => {
  it('answers the real plugin request with search results', async () => {
    okFetch([{ url: 'https://a.test', title: 'A', snippet: 'sa' }])
    await withServer({ credential: async () => credential() }, async (base) => {
      const res = await postPluginBody(base, { body: pluginBody('rust') })
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body) as { content: { type: string }[] }
      expect(body.content.some(block => block.type === 'web_search_tool_result')).toBe(true)
    })
  })

  it('searches the query with the prefix removed', async () => {
    const bodies = okFetch([])
    await withServer({ credential: async () => credential() }, async (base) => {
      await postPluginBody(base, { body: pluginBody('exact query') })
    })
    expect(bodies[0]?.['query']).toBe('exact query')
  })

  it('rejects a request that declares no web_search tool', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await withServer({ credential: async () => credential() }, async (base) => {
      const res = await postPluginBody(base, {
        body: JSON.stringify({ model: 'm', messages: [], tools: [] }),
      })
      expect(res.status).toBe(400)
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a signed-out host as an auth error', async () => {
    await withServer({ credential: async () => undefined }, async (base) => {
      const res = await postPluginBody(base)
      expect(res.status).toBe(401)
      const body = JSON.parse(res.body) as { error: { type: string } }
      expect(body.error.type).toBe('authentication_error')
    })
  })

  it('surfaces an upstream 401 as an auth error', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({}), text: async () => 'unauthorized',
    })) as unknown as typeof fetch
    await withServer({ credential: async () => credential() }, async (base) => {
      expect((await postPluginBody(base)).status).toBe(401)
    })
  })

  it('surfaces any other upstream failure as a server error', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({}), text: async () => 'boom',
    })) as unknown as typeof fetch
    await withServer({ credential: async () => credential() }, async (base) => {
      expect((await postPluginBody(base)).status).toBe(502)
    })
  })

  it('rejects a non-POST method', async () => {
    await withServer({ credential: async () => credential() }, async (base) => {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          { host: '127.0.0.1', port: base.port, path: WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH, method: 'GET' },
          res => { res.resume(); resolve(res.statusCode ?? 0) },
        )
        req.on('error', reject)
        req.end()
      })
      expect(status).toBe(405)
    })
  })

  it('rejects a non-loopback Host header (DNS rebinding)', async () => {
    await withServer({ credential: async () => credential() }, async (base) => {
      // A raw request, because undici refuses to let a caller forge Host.
      const res = await rawRequest(base.port, WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH, pluginBody(), {
        'Host': 'evil.example',
      })
      expect(res.status).toBe(403)
    })
  })

  it('rejects a non-loopback Origin', async () => {
    await withServer({ credential: async () => credential() }, async (base) => {
      const res = await postPluginBody(base, { headers: { Origin: 'https://evil.example' } })
      expect(res.status).toBe(403)
    })
  })

  it('rejects malformed JSON', async () => {
    await withServer({ credential: async () => credential() }, async (base) => {
      expect((await postPluginBody(base, { body: '{not json' })).status).toBe(400)
    })
  })

  it('reports a credential read failure as a server error', async () => {
    await withServer({ credential: async () => { throw new Error('auth unreadable') } }, async (base) => {
      expect((await postPluginBody(base)).status).toBe(502)
    })
  })

  it('honours the configured result cap', async () => {
    const bodies = okFetch([])
    await withServer({ credential: async () => credential(), maxResults: 3 }, async (base) => {
      await postPluginBody(base)
    })
    expect(bodies[0]?.['max_results']).toBe(3)
  })

  it('never leaks the token in a response', async () => {
    okFetch([{ url: 'https://a.test' }])
    const secret = credential()
    secret.accessToken = 'SUPER-SECRET-TOKEN-VALUE'
    await withServer({ credential: async () => secret }, async (base) => {
      const res = await postPluginBody(base)
      expect(res.body).not.toContain('SUPER-SECRET-TOKEN-VALUE')
    })
  })
})
