/**
 * Registers the WorkBuddy search tool on the host `tools` service.
 *
 * Kept apart from `search.ts` so the upstream call stays testable without a
 * DSH runtime, and apart from `index.ts` so the wiring there stays about
 * variants rather than about one tool's schema.
 *
 * One tool serves both variants: which account and which region answer is
 * decided per call from whichever credential is signed in, so a user running
 * only the international app still gets search. When both are signed in the
 * CN identity is preferred, matching the provider order the model picker shows.
 *
 * @module dsh-workbuddy-connect/search-tool
 */

import type {} from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WorkBuddyCredential } from './auth.ts'
import { formatSearchOutcome, searchWorkBuddy, type WorkBuddySearchResult } from './search.ts'

/** Wire name of the tool, namespaced so it never shadows DSH's own `web_search`. */
export const WORKBUDDY_SEARCH_TOOL = 'workbuddy_search'

/** Default result cap for one query. */
export const DEFAULT_SEARCH_MAX_RESULTS = 8

/** Hard cap on queries merged into one call. */
const MAX_QUERIES = 4

/** The tool's model-facing parameter schema. */
const SEARCH_PARAMETERS = {
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      items: { type: 'string' },
      description: '1–4 search queries; their results are merged and de-duplicated by URL.',
    },
    allowed_domains: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only return results from these domains.',
    },
    blocked_domains: {
      type: 'array',
      items: { type: 'string' },
      description: 'Never return results from these domains.',
    },
    freshness: {
      type: 'string',
      description: 'Recency window: d1..d30 (days), m1..m12 (months), y1..y5 (years).',
    },
  },
  required: ['queries'],
} as const

/** The canonical value {@link WORKBUDDY_SEARCH_TOOL} returns. */
interface SearchToolValue {
  queries: readonly string[]
  results: readonly WorkBuddySearchResult[]
  totalResults: number
  /** Per-query failures; a partial failure still returns the other queries. */
  errors?: readonly string[]
  /** Set when nothing could be searched at all. */
  fatal?: string
}

/** Dependencies the tool needs from the host plugin. */
export interface SearchToolDeps {
  /**
   * Resolve the credential to search with, or `undefined` when signed out.
   * The caller passes the same store accessor the chat path uses, so token
   * refresh and sign-out are observed identically on both paths.
   */
  credential: () => Promise<WorkBuddyCredential | undefined>
  /** Result cap, from plugin config. */
  maxResults?: number
}

/** Read `queries` from model arguments, tolerating the singular form. */
function readQueries(args: unknown): string[] {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const raw = record['queries']
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string' && value.trim() !== '').slice(0, MAX_QUERIES)
  }
  const single = record['query']
  if (typeof single === 'string' && single.trim() !== '') return [single]
  return []
}

/** Read a `string[]` argument, ignoring anything else. */
function readStringArray(args: unknown, key: string): string[] | undefined {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const raw = record[key]
  if (!Array.isArray(raw)) return undefined
  const values = raw.filter((value): value is string => typeof value === 'string' && value !== '')
  return values.length === 0 ? undefined : values
}

/** Read a string argument. */
function readString(args: unknown, key: string): string | undefined {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const raw = record[key]
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** Render the canonical value as the text a model reads. */
export function renderSearchValue(value: SearchToolValue): string {
  if (value.fatal !== undefined) return value.fatal
  const body = formatSearchOutcome({
    query: value.queries.join(' / '),
    results: value.results,
    totalResults: value.totalResults,
  })
  return value.errors === undefined || value.errors.length === 0
    ? body
    : `${body}\n\nSome queries failed: ${value.errors.join('; ')}`
}

/**
 * Register the search tool.
 *
 * @returns the disposer, or `undefined` when the host has no `tools` service
 *   (an older or headless profile) — search is additive, so its absence must
 *   never fail the plugin's own mount.
 */
export function registerWorkBuddySearchTool(
  ctx: Context,
  tools: { register: (definition: ToolDefinition) => () => void },
  deps: SearchToolDeps,
): (() => void) | undefined {
  if (typeof tools.register !== 'function') return undefined

  const definition: ToolDefinition = {
    name: WORKBUDDY_SEARCH_TOOL,
    description:
      'Search the web through the signed-in WorkBuddy account. Returns titles, URLs, and snippets. '
      + 'Accepts 1–4 queries, which are merged and de-duplicated, plus domain allow/block lists and a recency window.',
    parameters: SEARCH_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        properties: {
          queries: { type: 'array', items: { type: 'string' } },
          totalResults: { type: 'number' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                title: { type: 'string' },
                snippet: { type: 'string' },
              },
              required: ['url'],
            },
          },
          errors: { type: 'array', items: { type: 'string' } },
          fatal: { type: 'string' },
        },
        required: ['queries', 'results', 'totalResults'],
      },
      render: (_args: unknown, value: unknown): { type: 'text', text: string }[] => [
        { type: 'text', text: renderSearchValue(value as SearchToolValue) },
      ],
    },
    async execute(args: unknown, exec: { signal: AbortSignal }): Promise<SearchToolValue> {
      const queries = readQueries(args)
      if (queries.length === 0) {
        return { queries: [], results: [], totalResults: 0, fatal: 'workbuddy_search needs at least one non-empty query.' }
      }

      let credential: WorkBuddyCredential | undefined
      try {
        credential = await deps.credential()
      } catch (error: unknown) {
        return {
          queries,
          results: [],
          totalResults: 0,
          fatal: `Could not read the WorkBuddy credential: ${String(error)}`,
        }
      }
      if (credential === undefined) {
        return {
          queries,
          results: [],
          totalResults: 0,
          fatal: 'No WorkBuddy account is signed in, so web search is unavailable. Sign in to the WorkBuddy desktop app first.',
        }
      }

      const allowedDomains = readStringArray(args, 'allowed_domains')
      const blockedDomains = readStringArray(args, 'blocked_domains')
      const freshness = readString(args, 'freshness')

      const merged: WorkBuddySearchResult[] = []
      const seen = new Set<string>()
      const errors: string[] = []
      let totalResults = 0

      for (const query of queries) {
        const outcome = await searchWorkBuddy(credential, {
          query,
          ...deps.maxResults === undefined ? {} : { maxResults: deps.maxResults },
          ...allowedDomains === undefined ? {} : { allowedDomains },
          ...blockedDomains === undefined ? {} : { blockedDomains },
          ...freshness === undefined ? {} : { freshness },
          signal: exec.signal,
        })
        if (!outcome.ok) {
          errors.push(`${query}: ${outcome.message}`)
          continue
        }
        totalResults += outcome.totalResults
        for (const result of outcome.results) {
          if (seen.has(result.url)) continue
          seen.add(result.url)
          merged.push(result)
        }
      }

      if (merged.length === 0 && errors.length > 0) {
        return { queries, results: [], totalResults: 0, fatal: `Search failed:\n${errors.join('\n')}`, errors }
      }

      return {
        queries,
        results: merged,
        totalResults: totalResults === 0 ? merged.length : totalResults,
        ...errors.length === 0 ? {} : { errors },
      }
    },
  }

  const disposer = tools.register(definition)
  // Registration already succeeded; a logger that is missing or shaped
  // differently must not turn that into a failure. `ctx.logger` is the object
  // in some hosts and a factory in others, and the tool itself is registered
  // either way — so log defensively and keep the disposer.
  try {
    ctx.logger.info(`dsh-workbuddy-connect: registered tool ${WORKBUDDY_SEARCH_TOOL}`)
  } catch {
    // A silent success is better than losing the registration to a log call.
  }
  return disposer
}
