import { describe, expect, it } from 'vitest'
import { hostIsLoopback, hostIsTrusted, hostnameOfHost, originIsLoopback, requestIsTrusted } from '../src/loopback.ts'

describe('hostnameOfHost', () => {
  it('strips the port from an IPv4 host', () => {
    expect(hostnameOfHost('127.0.0.1:39271')).toBe('127.0.0.1')
  })

  it('keeps an IPv6 host intact without a port', () => {
    expect(hostnameOfHost('[::1]')).toBe('[::1]')
  })

  it('strips the port from a bracketed IPv6 host', () => {
    expect(hostnameOfHost('[::1]:39271')).toBe('[::1]')
  })

  it('does not treat a bare IPv6 literal as host:port', () => {
    expect(hostnameOfHost('::1')).toBe('::1')
  })

  it('lowercases and trims', () => {
    expect(hostnameOfHost('  LocalHost:3080 ')).toBe('localhost')
  })
})

describe('hostIsLoopback', () => {
  it('accepts loopback hosts with and without ports', () => {
    expect(hostIsLoopback('127.0.0.1')).toBe(true)
    expect(hostIsLoopback('localhost:3080')).toBe(true)
    expect(hostIsLoopback('[::1]:3080')).toBe(true)
  })

  it('rejects other hostnames, missing, and empty values', () => {
    expect(hostIsLoopback('evil.example')).toBe(false)
    expect(hostIsLoopback('127.0.0.1.evil.example')).toBe(false)
    expect(hostIsLoopback(undefined)).toBe(false)
    expect(hostIsLoopback('')).toBe(false)
    expect(hostIsLoopback('  ')).toBe(false)
  })
})

describe('originIsLoopback', () => {
  it('passes absent and empty Origins (non-browser clients)', () => {
    expect(originIsLoopback(undefined)).toBe(true)
    expect(originIsLoopback('')).toBe(true)
    expect(originIsLoopback('  ')).toBe(true)
  })

  it('accepts loopback origins', () => {
    expect(originIsLoopback('http://127.0.0.1:3080')).toBe(true)
    expect(originIsLoopback('http://localhost:3080')).toBe(true)
    expect(originIsLoopback('http://[::1]:3080')).toBe(true)
  })

  it('rejects non-loopback and unparsable Origins', () => {
    expect(originIsLoopback('http://evil.example')).toBe(false)
    expect(originIsLoopback('http://127.0.0.1.evil.example')).toBe(false)
    expect(originIsLoopback('not a url')).toBe(false)
  })
})

describe('hostIsTrusted', () => {
  it('accepts an exact host:port entry only on that port', () => {
    expect(hostIsTrusted('mssshield.uk:43080', ['mssshield.uk:43080'])).toBe(true)
    expect(hostIsTrusted('mssshield.uk:9999', ['mssshield.uk:43080'])).toBe(false)
  })

  it('accepts a port-less entry on any port', () => {
    // The shape a deployment derives for LAN IP literals, where the bound port
    // may be OS-assigned and is unknowable when the entry is written.
    expect(hostIsTrusted('192.168.6.110:3080', ['192.168.6.110'])).toBe(true)
    expect(hostIsTrusted('192.168.6.110', ['192.168.6.110'])).toBe(true)
  })

  it('ignores case, which never decides trust', () => {
    expect(hostIsTrusted('MSSShield.uk:43080', ['mssshield.uk:43080'])).toBe(true)
  })

  it('refuses everything when no authority is declared', () => {
    expect(hostIsTrusted('mssshield.uk:43080', undefined)).toBe(false)
    expect(hostIsTrusted('mssshield.uk:43080', [])).toBe(false)
  })

  it('does not let a trust entry authorize a different hostname', () => {
    expect(hostIsTrusted('evil.example', ['mssshield.uk'])).toBe(false)
    // A declared suffix must not act as a wildcard.
    expect(hostIsTrusted('mssshield.uk.evil.example', ['mssshield.uk'])).toBe(false)
  })

  it('refuses missing and empty hosts', () => {
    expect(hostIsTrusted(undefined, ['mssshield.uk'])).toBe(false)
    expect(hostIsTrusted('', ['mssshield.uk'])).toBe(false)
  })
})

describe('requestIsTrusted', () => {
  const TRUSTED = ['mssshield.uk:43080']

  it('keeps every loopback request working with no declaration', () => {
    expect(requestIsTrusted('127.0.0.1:3080', undefined, undefined)).toBe(true)
    expect(requestIsTrusted('localhost:3080', 'http://localhost:3080', undefined)).toBe(true)
    expect(requestIsTrusted('[::1]:3080', undefined, undefined)).toBe(true)
  })

  it('accepts a declared authority, with or without a same-origin Origin', () => {
    // This is the regression: a GUI served on a real hostname sends that
    // hostname in both Host and Origin, and every plugin read used to 403.
    expect(requestIsTrusted('mssshield.uk:43080', 'http://mssshield.uk:43080', TRUSTED)).toBe(true)
    expect(requestIsTrusted('mssshield.uk:43080', undefined, TRUSTED)).toBe(true)
  })

  it('still refuses an undeclared authority', () => {
    expect(requestIsTrusted('mssshield.uk:43080', undefined, undefined)).toBe(false)
    expect(requestIsTrusted('evil.example', 'http://evil.example', TRUSTED)).toBe(false)
  })

  it('still refuses a rebound page, which presents neither loopback nor trusted', () => {
    expect(requestIsTrusted('evil.example', undefined, TRUSTED)).toBe(false)
    expect(requestIsTrusted('127.0.0.1.evil.example', undefined, TRUSTED)).toBe(false)
  })

  it('refuses a cross-origin request even from a trusted authority', () => {
    // A page served by one trusted authority must not read another's answers.
    expect(requestIsTrusted('mssshield.uk:43080', 'http://evil.example', TRUSTED)).toBe(false)
    expect(requestIsTrusted('mssshield.uk:43080', 'http://mssshield.uk:9999', TRUSTED)).toBe(false)
    expect(requestIsTrusted('127.0.0.1:3080', 'http://evil.example', undefined)).toBe(false)
  })

  it('refuses a missing host and an unparsable Origin', () => {
    expect(requestIsTrusted(undefined, undefined, TRUSTED)).toBe(false)
    expect(requestIsTrusted('', undefined, TRUSTED)).toBe(false)
    expect(requestIsTrusted('mssshield.uk:43080', 'not a url', TRUSTED)).toBe(false)
  })

  it('resolves a getter per call, so a late-provided service still counts', () => {
    // The regression this shape exists for: `webRuntime` is provided by the
    // Web app bundle from inside its own webServer inject, so a sibling bundle
    // can mount its routes before the service exists. Reading once at mount
    // observed `undefined` and left every route loopback-only — which is the
    // 403 the trusted-host support was added to fix. A getter defers the read
    // to request time, after the tree has settled.
    let declared: readonly string[] | undefined
    const lazy = () => declared
    expect(requestIsTrusted('mssshield.uk:43080', undefined, lazy)).toBe(false)
    declared = TRUSTED
    expect(requestIsTrusted('mssshield.uk:43080', undefined, lazy)).toBe(true)
    // And it tracks withdrawal as well as addition.
    declared = undefined
    expect(requestIsTrusted('mssshield.uk:43080', undefined, lazy)).toBe(false)
  })
})
