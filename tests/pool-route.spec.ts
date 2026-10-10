/**
 * The account pool's control route.
 *
 * The guards are the point: a read is loopback-only, and every write
 * additionally needs the in-process key, because the loopback gate protects
 * against a rebinding *page* — it is not the same as authorizing a mutation.
 * Check-in is the one action with a real side effect, so it must never run
 * without an explicit request.
 */

import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPoolKey, workBuddyPoolHandler, type WorkBuddyPoolRouteOptions } from '../src/pool-route.ts'
import { WORKBUDDY_POOL_PATH } from '../src/status-paths.ts'
import type { WorkBuddyPoolDocument } from '../src/status-paths.ts'

const KEY = createPoolKey()

function document(overrides: Partial<WorkBuddyPoolDocument> = {}): WorkBuddyPoolDocument {
  return {
    enabled: false,
    autoCheckin: false,
    accounts: [],
    imported: [],
    poolKey: KEY,
    ...overrides,
  }
}

function options(overrides: Partial<WorkBuddyPoolRouteOptions> = {}): WorkBuddyPoolRouteOptions {
  return {
    key: KEY,
    snapshot: async () => document(),
    setEnabled: vi.fn(),
    setMembers: vi.fn(),
    rediscover: async () => document(),
    checkin: async () => ({ state: 'ok' }),
    ...overrides,
  }
}

/** Mount the handler on a real loopback server. */
async function withServer(
  opts: WorkBuddyPoolRouteOptions,
  fn: (base: { origin: string, port: number }) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => { void workBuddyPoolHandler(opts)(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn({ origin: `http://127.0.0.1:${port}`, port })
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
}

/** Raw request, so a forged `Host` can be sent (undici refuses to set it). */
function raw(
  port: number,
  options: { method?: string, path?: string, body?: string, headers?: Record<string, string> } = {},
): Promise<{ status: number, body: string }> {
  const { method = 'GET', path = WORKBUDDY_POOL_PATH, body, headers = {} } = options
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        ...headers,
      },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk as Buffer))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })

describe('reads', () => {
  it('answers the snapshot on GET', async () => {
    await withServer(options(), async ({ port }) => {
      const res = await raw(port)
      expect(res.status).toBe(200)
      const parsed = JSON.parse(res.body) as WorkBuddyPoolDocument
      expect(parsed.poolKey).toBe(KEY)
    })
  })

  it('rejects a non-loopback Host (DNS rebinding)', async () => {
    await withServer(options(), async ({ port }) => {
      expect((await raw(port, { headers: { Host: 'evil.example' } })).status).toBe(403)
    })
  })

  it('rejects a non-loopback Origin', async () => {
    await withServer(options(), async ({ port }) => {
      expect((await raw(port, { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    })
  })

  it('rejects an unsupported method', async () => {
    await withServer(options(), async ({ port }) => {
      expect((await raw(port, { method: 'DELETE' })).status).toBe(405)
    })
  })
})

describe('a deployment served on a declared authority', () => {
  const HOST = 'mssshield.uk:43080'
  const trusted = () => options({ trustedHosts: [HOST] })

  it('answers a read addressed to the declared authority', async () => {
    // The regression: `dsh web --trusted-host <authority>` serves the GUI on a
    // real hostname, so the page's own same-origin fetch carries it in Host and
    // Origin. A loopback-only gate answered every such read with 403, and the
    // pool page rendered "读取账号池失败: HTTP 403".
    await withServer(trusted(), async ({ port }) => {
      const res = await raw(port, { headers: { Host: HOST, Origin: `http://${HOST}` } })
      expect(res.status).toBe(200)
      expect((JSON.parse(res.body) as WorkBuddyPoolDocument).poolKey).toBe(KEY)
    })
  })

  it('answers a read from the declared authority with no Origin', async () => {
    await withServer(trusted(), async ({ port }) => {
      expect((await raw(port, { headers: { Host: HOST } })).status).toBe(200)
    })
  })

  it('still refuses an undeclared authority', async () => {
    await withServer(trusted(), async ({ port }) => {
      expect((await raw(port, { headers: { Host: 'evil.example' } })).status).toBe(403)
    })
  })

  it('still refuses a cross-origin read from the declared authority', async () => {
    await withServer(trusted(), async ({ port }) => {
      const res = await raw(port, { headers: { Host: HOST, Origin: 'http://evil.example' } })
      expect(res.status).toBe(403)
    })
  })

  it('still refuses a rebound page', async () => {
    // Declaring an authority must not weaken rebinding protection: the rebound
    // page sends the attacker's domain in Host, which is not declared.
    await withServer(trusted(), async ({ port }) => {
      expect((await raw(port, { headers: { Host: 'evil.example', Origin: 'http://evil.example' } })).status).toBe(403)
    })
  })

  it('still requires the in-process key for a write', async () => {
    // The trust gate admits the request; authorization is still separate, so a
    // page on the declared authority cannot mutate without the key.
    await withServer(trusted(), async ({ port }) => {
      const res = await raw(port, {
        method: 'POST',
        body: JSON.stringify({ action: 'rediscover' }),
        headers: { Host: HOST, Origin: `http://${HOST}`, 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(403)
    })
  })
})

describe('writes', () => {
  const post = (port: number, body: unknown, headers: Record<string, string> = { 'x-workbuddy-pool-key': KEY }) =>
    raw(port, { method: 'POST', body: JSON.stringify(body), headers })

  it('refuses a write without the in-process key', async () => {
    // The loopback gate alone is not authorization for a mutation.
    const opts = options()
    await withServer(opts, async ({ port }) => {
      expect((await post(port, { action: 'set-enabled', enabled: true }, {})).status).toBe(403)
    })
    expect(opts.setEnabled).not.toHaveBeenCalled()
  })

  it('refuses a write with the wrong key', async () => {
    const opts = options()
    await withServer(opts, async ({ port }) => {
      expect((await post(port, { action: 'set-enabled', enabled: true }, { 'x-workbuddy-pool-key': 'nope' })).status).toBe(403)
    })
    expect(opts.setEnabled).not.toHaveBeenCalled()
  })

  it('sets the enabled flag', async () => {
    const opts = options()
    await withServer(opts, async ({ port }) => {
      const res = await post(port, { action: 'set-enabled', enabled: true })
      expect(res.status).toBe(200)
    })
    expect(opts.setEnabled).toHaveBeenCalledWith(true)
  })

  it('sets members, filtering non-strings', async () => {
    const opts = options()
    await withServer(opts, async ({ port }) => {
      await post(port, { action: 'set-members', accountIds: ['a', '', 5, 'b'] })
    })
    expect(opts.setMembers).toHaveBeenCalledWith(['a', 'b'])
  })

  it('rediscover calls through and answers the fresh document', async () => {
    const rediscover = vi.fn(async () => document({ enabled: true }))
    await withServer(options({ rediscover }), async ({ port }) => {
      const res = await post(port, { action: 'rediscover' })
      expect(res.status).toBe(200)
      expect((JSON.parse(res.body) as { document: WorkBuddyPoolDocument }).document.enabled).toBe(true)
    })
    expect(rediscover).toHaveBeenCalled()
  })

  it('check-in passes the named accounts through', async () => {
    const checkin = vi.fn(async () => ({ state: 'ok' as const, rows: [] }))
    await withServer(options({ checkin }), async ({ port }) => {
      await post(port, { action: 'checkin', accountIds: ['a'] })
    })
    expect(checkin).toHaveBeenCalledWith(['a'])
  })

  it('check-in with no ids means "every member"', async () => {
    const checkin = vi.fn(async () => ({ state: 'ok' as const, rows: [] }))
    await withServer(options({ checkin }), async ({ port }) => {
      await post(port, { action: 'checkin' })
    })
    expect(checkin).toHaveBeenCalledWith(undefined)
  })

  it('rejects a body that is not JSON', async () => {
    await withServer(options(), async ({ port }) => {
      const res = await raw(port, { method: 'POST', body: '{not json', headers: { 'x-workbuddy-pool-key': KEY } })
      expect(res.status).toBe(400)
    })
  })

  it('rejects a missing action', async () => {
    await withServer(options(), async ({ port }) => {
      expect((await post(port, {})).status).toBe(400)
    })
  })

  it('reports an unknown action without crashing', async () => {
    await withServer(options(), async ({ port }) => {
      const res = await post(port, { action: 'nope' })
      expect(res.status).toBe(200)
      expect((JSON.parse(res.body) as { state: string }).state).toBe('failed')
    })
  })

  it('reports a failing action as a 500 with its message', async () => {
    const opts = options({
      setEnabled: () => { throw new Error('disk full') },
    })
    await withServer(opts, async ({ port }) => {
      const res = await post(port, { action: 'set-enabled', enabled: true })
      expect(res.status).toBe(500)
      expect(res.body).toContain('disk full')
    })
  })

  it('sets auto check-in when the host offers it', async () => {
    const setAutoCheckin = vi.fn()
    await withServer(options({ setAutoCheckin }), async ({ port }) => {
      await post(port, { action: 'set-auto-checkin', enabled: true })
    })
    expect(setAutoCheckin).toHaveBeenCalledWith(true)
  })

  it('answers "not available" rather than failing when the host has no auto check-in', async () => {
    await withServer(options(), async ({ port }) => {
      const res = await post(port, { action: 'set-auto-checkin', enabled: true })
      expect(res.status).toBe(200)
      expect((JSON.parse(res.body) as { state: string }).state).toBe('failed')
    })
  })

  it('never leaks a token in the document', async () => {
    await withServer(options({
      snapshot: async () => document({
        accounts: [{
          id: 'uid-1:', name: 'Tester', live: true, member: true, expiresAtMs: 1, variant: 'workbuddy-ai',
        }],
      }),
    }), async ({ port }) => {
      const res = await raw(port)
      // The document carries ids, names, and timestamps only.
      expect(res.body).not.toContain('accessToken')
      expect(res.body).not.toContain('refreshToken')
      expect(res.body).not.toContain('Bearer')
    })
  })
})
