/**
 * Control route for the account pool.
 *
 * Modelled on `probe-route.ts`: loopback-only, and every write requires the
 * same in-process key the status document hands the card. The read is a GET so
 * the card can poll it; the writes are one POST with an `action` discriminator,
 * because they share a guard, a body limit, and an error shape.
 *
 * Check-in is the one action with a real side effect (it grants credit), so it
 * is additionally gated on the user's explicit click — the route never
 * auto-claims, and the startup path is a separate opt-in toggle.
 *
 * @module dsh-workbuddy-connect/pool-route
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'
import { WORKBUDDY_POOL_PATH } from './status-paths.ts'
import type { WorkBuddyPoolAction, WorkBuddyPoolActionAnswer, WorkBuddyPoolDocument } from './status-paths.ts'

/** Largest control body accepted; these payloads are a few hundred bytes. */
const MAX_BODY_BYTES = 16 * 1024

/** Mint the per-process control key. */
export function createPoolKey(): string {
  return randomBytes(24).toString('hex')
}

/** Constant-time key comparison; a length mismatch is a failure, not a crash. */
function keyMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined || presented.length !== expected.length) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(presented)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Write a JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(payload)
}

/** Read a request body with a hard ceiling. */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.length
    if (total > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The same browser-origin gate the status route uses: DNS-rebinding pages die here. */
function browserRequestAllowed(req: IncomingMessage): boolean {
  return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin)
}

/** Constructor dependencies. */
export interface WorkBuddyPoolRouteOptions {
  /** The current pool document for the card. */
  snapshot: () => Promise<WorkBuddyPoolDocument>
  /** Turn rotation on or off. */
  setEnabled: (enabled: boolean) => Promise<void> | void
  /** Replace the member list. */
  setMembers: (accountIds: readonly string[]) => Promise<void> | void
  /** Re-scan the auth directory and return the fresh document. */
  rediscover: () => Promise<WorkBuddyPoolDocument>
  /** Check in the given accounts (or every member when omitted). */
  checkin: (accountIds?: readonly string[]) => Promise<WorkBuddyPoolActionAnswer>
  /** Turn startup auto check-in on or off. */
  setAutoCheckin?: (enabled: boolean) => Promise<void> | void
  /** The in-process key the status document handed the card. */
  key: string
  /** Route path to mount. Defaults to the shared path. */
  path?: string
}

/**
 * Whether a request may act.
 *
 * Reads are loopback-gated only; writes additionally need the in-process key,
 * because the loopback guard protects against a rebinding *page* — it is not
 * the same as authorizing a mutation.
 */
function authorized(req: IncomingMessage, key: string): boolean {
  const presented = req.headers['x-workbuddy-pool-key']
  return keyMatches(key, typeof presented === 'string' ? presented : undefined)
}

/** The route handler, extracted so tests can mount it on a bare server. */
export function workBuddyPoolHandler(
  options: WorkBuddyPoolRouteOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!browserRequestAllowed(req)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }

    if (req.method === 'GET') {
      try {
        json(res, 200, await options.snapshot())
      } catch (error: unknown) {
        json(res, 500, { error: String(error) })
      }
      return
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!authorized(req, options.key)) {
      json(res, 403, { error: 'invalid-key' })
      return
    }

    const raw = await readBody(req)
    if (raw === undefined) {
      json(res, 413, { error: 'request body too large' })
      return
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      json(res, 400, { error: 'body is not valid JSON' })
      return
    }
    if (typeof body !== 'object' || body === null) {
      json(res, 400, { error: 'body must be an object' })
      return
    }
    const action = (body as Record<string, unknown>)['action']
    if (typeof action !== 'string') {
      json(res, 400, { error: 'missing action' })
      return
    }

    try {
      const answer = await dispatch(action as WorkBuddyPoolAction, body as Record<string, unknown>, options)
      json(res, 200, answer)
    } catch (error: unknown) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Run one action. */
async function dispatch(
  action: WorkBuddyPoolAction,
  body: Record<string, unknown>,
  options: WorkBuddyPoolRouteOptions,
): Promise<WorkBuddyPoolActionAnswer> {
  switch (action) {
    case 'set-enabled': {
      await options.setEnabled(body['enabled'] === true)
      return { state: 'ok', document: await options.snapshot() }
    }
    case 'set-members': {
      const ids = Array.isArray(body['accountIds'])
        ? body['accountIds'].filter((value): value is string => typeof value === 'string' && value !== '')
        : []
      await options.setMembers(ids)
      return { state: 'ok', document: await options.snapshot() }
    }
    case 'rediscover': {
      return { state: 'ok', document: await options.rediscover() }
    }
    case 'set-auto-checkin': {
      if (options.setAutoCheckin === undefined) {
        return { state: 'failed', reason: 'auto check-in is not available on this host' }
      }
      await options.setAutoCheckin(body['enabled'] === true)
      return { state: 'ok', document: await options.snapshot() }
    }
    case 'checkin': {
      const ids = Array.isArray(body['accountIds'])
        ? body['accountIds'].filter((value): value is string => typeof value === 'string' && value !== '')
        : undefined
      return await options.checkin(ids)
    }
    default:
      return { state: 'failed', reason: `unknown action: ${action}` }
  }
}

/** Mount the route on an optional webServer context. */
export function registerWorkBuddyPoolRoute(ctx: Context, options: WorkBuddyPoolRouteOptions): void {
  const path = options.path ?? WORKBUDDY_POOL_PATH
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path,
      handler: workBuddyPoolHandler(options),
    })
    return () => {
      dispose()
    }
  }, 'dsh-workbuddy-connect: account pool route')
}
