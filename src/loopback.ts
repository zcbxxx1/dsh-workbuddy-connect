/**
 * Shared browser-trust gates for the plugin's local HTTP surfaces: the
 * loopback shim and the same-origin web-status route.
 *
 * These surfaces are meant to be reached through the machine's loopback
 * interface, but a GUI is perfectly entitled to be served on a real hostname:
 * `dsh web --host 0.0.0.0 --trusted-host <authority>` binds every interface and
 * declares the authorities its own `/api` fence accepts. A browser opening the
 * GUI on that authority sends it in both `Host` and `Origin`, so a gate that
 * only ever accepted loopback would reject the plugin's own same-origin reads
 * with `403 request-not-trusted` — the card and the pool page would render
 * their shells and then fail to load any data.
 *
 * The gate therefore mirrors the host's own fence
 * (`@deepseek-ai/dsh-client-connection`): the request authority must be
 * loopback *or* a declared trusted authority, and any browser-attached Origin
 * must be same-origin with the request authority. Rebinding protection is
 * unchanged — a rebound page still presents the attacker's domain in `Host`,
 * which is neither loopback nor trusted.
 *
 * @module dsh-workbuddy-connect/loopback
 */

/** Loopback hostnames a local plugin surface may be addressed by. */
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Authorities a deployment declares as its own, exactly as the host's fence
 * consumes them: bare `host` (any port) or `host:port` (that exact authority).
 *
 * Accepted as either a static list or a getter. The getter form exists because
 * the declaring service (`webRuntime`) may be provided after the routes mount:
 * resolving at request time is what makes the declaration visible at all.
 *
 * `undefined` and `[]` both mean "loopback only", which is what a profile with
 * no `webRuntime` service and no explicit configuration gets — the historical
 * behaviour, preserved rather than loosened.
 */
export type TrustedAuthorities = readonly string[] | (() => readonly string[] | undefined) | undefined

/** Resolve a {@link TrustedAuthorities} value to its current list. */
export function resolveTrusted(trusted: TrustedAuthorities): readonly string[] | undefined {
  return typeof trusted === 'function' ? trusted() : trusted
}

/** Strip the optional :port from a Host header value, IPv6-bracket aware. */
export function hostnameOfHost(host: string): string {
  let hostname = host.trim().toLowerCase()
  if (hostname.startsWith('[')) {
    const end = hostname.indexOf(']')
    return end === -1 ? hostname : hostname.slice(0, end + 1)
  }
  // Only `name:port` with a single colon is a port; anything with more colons
  // is an (unbracketed) IPv6 literal and must not be truncated.
  const colon = hostname.lastIndexOf(':')
  if (colon !== -1 && !hostname.slice(0, colon).includes(':') && /^\d+$/.test(hostname.slice(colon + 1))) {
    hostname = hostname.slice(0, colon)
  }
  return hostname
}

/**
 * The request's Host header must name the loopback interface. A DNS-rebinding
 * page (attacker domain re-resolved to 127.0.0.1) sends its own domain in
 * Host, so this check drops those before any routing happens.
 */
export function hostIsLoopback(host: string | undefined): boolean {
  if (host === undefined || host.trim() === '') return false
  return LOOPBACK_HOSTS.has(hostnameOfHost(host))
}

/**
 * A browser-sent Origin (present header) must be loopback. Non-browser
 * clients (the plugin's own fetch calls) send no Origin at all and pass.
 */
export function originIsLoopback(origin: string | undefined): boolean {
  if (origin === undefined || origin.trim() === '') return true
  try {
    const { hostname } = new URL(origin)
    return LOOPBACK_HOSTS.has(hostname) || hostname === '::1'
  } catch {
    return false
  }
}

/** Parse a Host-header authority, or `undefined` when it is not one. */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. A port written as the scheme default (`:80` for http)
 * still counts as explicit, matching the host's own fence.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a declared entry.
 *
 * An entry with an explicit port matches that exact authority; a port-less
 * entry matches the hostname on any port — the shape a deployment derives for
 * LAN IP literals, where the bound port may be OS-assigned and therefore
 * unknowable at configuration time. Both sides compare through WHATWG
 * normalization, so case never decides trust.
 */
export function hostIsTrusted(host: string | undefined, trusted: TrustedAuthorities): boolean {
  const list = resolveTrusted(trusted)
  if (list === undefined || list.length === 0) return false
  if (host === undefined || host.trim() === '') return false
  const hostUrl = parseAuthority(host.trim())
  if (hostUrl === undefined) return false
  return list.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * The full browser-trust gate: the request authority must be loopback or a
 * declared trusted authority, and an attached browser Origin must be
 * same-origin with it.
 *
 * Same-origin (rather than "also loopback or trusted") is deliberate and
 * mirrors the host's fence: a page served from one trusted authority must not
 * be able to read another's responses, and a rebound page's Origin still names
 * the attacker's domain.
 */
export function requestIsTrusted(
  host: string | undefined,
  origin: string | undefined,
  trusted: TrustedAuthorities,
): boolean {
  if (host === undefined || host.trim() === '') return false
  const hostUrl = parseAuthority(host.trim())
  if (hostUrl === undefined) return false
  const hostname = hostnameOfHost(host)
  if (!LOOPBACK_HOSTS.has(hostname) && !hostIsTrusted(host, trusted)) return false
  if (origin === undefined || origin.trim() === '') return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
