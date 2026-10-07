/**
 * An Anthropic-Messages-compatible search endpoint, served by this plugin.
 *
 * Why this exists: DSH's model-facing `web_search` tool is executed by the
 * `dsh-web-search-deepseek` plugin, which posts an Anthropic Messages request
 * (`tools: [{type: 'web_search_20250305'}]`) to a configurable `baseURL` and
 * reads `web_search_tool_result` blocks back. That endpoint is normally
 * DeepSeek's, and it needs a DeepSeek API key the user may not have.
 *
 * This module answers the same wire shape from the WorkBuddy credential the
 * rest of the plugin already uses, so the **native** `web_search` tool can be
 * pointed here instead:
 *
 * ```yaml
 * - id: web-search-deepseek
 *   config:
 *     apiKey: local-bridge
 *     baseURL: http://127.0.0.1:19387/plugins/dsh-workbuddy-connect/search
 * ```
 *
 * The route lives on DSH's own web server, so no second process is needed and
 * the plugin's existing credential handling (region, refresh, sign-out) applies
 * unchanged. Search itself is delegated to `search.ts`.
 *
 * Security: the route is gated to loopback requests, the same way the status
 * route is. It returns search results for a query and never exposes the token.
 *
 * @module dsh-workbuddy-connect/search-gateway
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WorkBuddyCredential } from './auth.ts'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'
import { searchWorkBuddy } from './search.ts'

/** Base path this plugin serves the Anthropic-Messages search shape on. */
export const WORKBUDDY_SEARCH_GATEWAY_PATH = '/plugins/dsh-workbuddy-connect/search'

/**
 * The path the search plugin actually posts to.
 *
 * `dsh-web-search-deepseek` hardcodes `` `${baseURL}/messages` ``, so the
 * configured `baseURL` is one segment above this.
 */
export const WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH = `${WORKBUDDY_SEARCH_GATEWAY_PATH}/messages`

/** Body ceiling for the gateway; a search request is tiny. */
const BODY_LIMIT_BYTES = 256 * 1024

/** The server tool marker the search plugin declares. */
const WEB_SEARCH_TOOL_TYPE = 'web_search_20250305'

/** Prefix the plugin wraps around the user's query, stripped before searching. */
const QUERY_PREFIX = 'Perform a web search for the query:'

/** One `web_search_result` item inside the tool-result block. */
interface WebSearchResultItem {
  type: 'web_search_result'
  url: string
  title: string
  page_age?: string
}

/** One citation inside the `text` block; this is where the plugin reads snippets. */
interface WebSearchCitation {
  type: 'web_search_result_location'
  url: string
  cited_text: string
}

/** Read the whole request body, refusing anything oversized. */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.length
    if (total > BODY_LIMIT_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Write a JSON response. */
function json(res: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(payload)
}

/** Write an Anthropic-shaped error. */
function errorResponse(res: ServerResponse, status: number, message: string, type = 'invalid_request_error'): void {
  json(res, status, { type: 'error', error: { type, message } })
}

/** Whether a browser-origin request is allowed (DNS-rebinding gate). */
function browserRequestAllowed(req: IncomingMessage): boolean {
  return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin)
}

/** Whether the request declares the hosted web-search tool. */
export function declaresWebSearch(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const tools = (body as Record<string, unknown>)['tools']
  if (!Array.isArray(tools)) return false
  return tools.some((tool) => {
    if (typeof tool !== 'object' || tool === null) return false
    const record = tool as Record<string, unknown>
    const type = typeof record['type'] === 'string' ? record['type'] : ''
    return type.startsWith('web_search') || record['name'] === 'web_search'
  })
}

/**
 * Recover the real query from the request.
 *
 * The plugin sends exactly one user message whose text is
 * `Perform a web search for the query: <query>`; the prefix is an instruction
 * to the auxiliary model and must not be searched for literally.
 */
export function extractSearchQuery(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const messages = (body as Record<string, unknown>)['messages']
  if (!Array.isArray(messages)) return ''
  const parts: string[] = []
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const content = (message as Record<string, unknown>)['content']
    if (typeof content === 'string') {
      parts.push(content)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const record = block as Record<string, unknown>
      if (record['type'] === 'text' && typeof record['text'] === 'string') parts.push(record['text'])
    }
  }
  const joined = parts.join('\n').trim()
  return joined.startsWith(QUERY_PREFIX) ? joined.slice(QUERY_PREFIX.length).trim() : joined
}

/** Build the Anthropic Messages response the search plugin consumes. */
export function buildSearchResponse(
  query: string,
  results: readonly { url: string, title: string, snippet: string }[],
  model: string,
): Record<string, unknown> {
  const items: WebSearchResultItem[] = results.map(result => ({
    type: 'web_search_result',
    url: result.url,
    title: result.title === '' ? result.url : result.title,
  }))
  // Snippets travel as citations: the plugin reads `cited_text` from `text`
  // blocks and joins them to results by URL. `web_search_result` itself carries
  // no snippet field, so putting it there would lose every excerpt.
  const citations: WebSearchCitation[] = results
    .filter(result => result.snippet !== '')
    .map(result => ({ type: 'web_search_result_location', url: result.url, cited_text: result.snippet }))

  const content: Record<string, unknown>[] = [
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_workbuddy', content: items },
  ]
  if (citations.length > 0) content.push({ type: 'text', text: '', citations })

  return {
    id: `msg_workbuddy_${Math.random().toString(16).slice(2, 10)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

/** Dependencies for the gateway handler. */
export interface SearchGatewayOptions {
  /** Resolve the credential to search with; `undefined` when signed out. */
  credential: () => Promise<WorkBuddyCredential | undefined>
  /** Result cap per query. */
  maxResults?: number
}

/**
 * The route handler, extracted so tests can mount it on a bare server.
 *
 * Always answers a well-formed Anthropic response or a well-formed error; a
 * thrown handler would leave the search plugin with an unparseable body.
 */
export function workBuddySearchGatewayHandler(
  deps: SearchGatewayOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      errorResponse(res, 405, 'method not allowed')
      return
    }
    if (!browserRequestAllowed(req)) {
      errorResponse(res, 403, 'request-not-trusted')
      return
    }

    const raw = await readBody(req)
    if (raw === undefined) {
      errorResponse(res, 413, 'request body too large')
      return
    }

    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch (error: unknown) {
      errorResponse(res, 400, `request body is not valid JSON: ${String(error)}`)
      return
    }

    if (!declaresWebSearch(body)) {
      errorResponse(
        res,
        400,
        'request does not declare the web_search tool; this endpoint only serves DSH web search, not chat',
      )
      return
    }

    const query = extractSearchQuery(body)
    if (query === '') {
      errorResponse(res, 400, 'could not read a search query from the request')
      return
    }

    let credential: WorkBuddyCredential | undefined
    try {
      credential = await deps.credential()
    } catch (error: unknown) {
      errorResponse(res, 502, `could not read the WorkBuddy credential: ${String(error)}`, 'api_error')
      return
    }
    if (credential === undefined) {
      errorResponse(
        res,
        401,
        'no WorkBuddy account is signed in; sign in to the WorkBuddy desktop app to use web search',
        'authentication_error',
      )
      return
    }

    const outcome = await searchWorkBuddy(credential, {
      query,
      ...deps.maxResults === undefined ? {} : { maxResults: deps.maxResults },
    })
    if (!outcome.ok) {
      // 401 from upstream means the stored token is no longer usable; surface
      // it as an auth error so the search plugin's message points at sign-in.
      const status = outcome.status === 401 ? 401 : 502
      errorResponse(res, status, outcome.message, status === 401 ? 'authentication_error' : 'api_error')
      return
    }

    const model = typeof (body as Record<string, unknown>)['model'] === 'string'
      ? (body as Record<string, unknown>)['model'] as string
      : 'deepseek-v4-flash'
    json(res, 200, buildSearchResponse(outcome.query, outcome.results, model))
  }
}

/** Mount the gateway route on an optional webServer context. */
export function registerWorkBuddySearchGatewayRoute(ctx: Context, deps: SearchGatewayOptions): void {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: WORKBUDDY_SEARCH_GATEWAY_MESSAGES_PATH,
      handler: workBuddySearchGatewayHandler(deps),
    })
    return () => {
      dispose()
    }
  }, 'dsh-workbuddy-connect: search gateway route')
}
