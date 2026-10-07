/**
 * Theme-token hygiene across the whole client half.
 *
 * An unknown CSS custom property does not fall back to anything — it resolves
 * to the empty string. So `color: var(--dsw-alias-label-tertiary)` is not a
 * subtle shade: it is no colour at all, and the element inherits. Where a
 * fallback is written inline the colour does appear, but it is a hardcoded
 * light-theme value that ignores the active theme.
 *
 * This had gone wrong in five files: invented `--dsh-*` names on the pool page,
 * and names copied from `dsh-codex-connect` (`button-primary-fill`,
 * `label-primary-foreground`) and from the plugin card itself
 * (`bg-module-platform`, `label-tertiary`, `label-dimmed`) in the probe control,
 * the update notice and the card. Copying a wrong name propagates it, which is
 * why the check covers every client file rather than the one being edited.
 *
 * A static check is the only option: the type checker cannot see inside a
 * `var()` string, and this suite has no React renderer.
 *
 * The allow-list is the token set from DSH's client `Theme` inspect provider.
 * `--dsw-shadow-*` is deliberately absent — the theme exposes no shadow token,
 * so a shadow must be a literal rather than a variable resolving to nothing.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Every token DSH's client `Theme` provider defines (`Theme.listTokens`). */
const THEME_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
])

const CLIENT_DIR = join(import.meta.dirname, '..', 'src', 'client')

/** Every client source file. */
function clientFiles(): string[] {
  return readdirSync(CLIENT_DIR).filter(name => name.endsWith('.tsx') || name.endsWith('.ts'))
}

/** Every `var(--x)` a file reads, with its line number. */
function tokensUsed(source: string): { name: string, line: number }[] {
  const found: { name: string, line: number }[] = []
  source.split('\n').forEach((text, index) => {
    // A comment may legitimately NAME a bad token while explaining why it is
    // gone, so comments are stripped — otherwise the explanation would fail the
    // very check it documents.
    const code = text.replace(/\/\/.*$/u, '').replace(/\/\*.*$/u, '').replace(/^\s*\*.*$/u, '')
    for (const match of code.matchAll(/var\((--[A-Za-z0-9-]+)/gu)) {
      if (match[1] !== undefined) found.push({ name: match[1], line: index + 1 })
    }
  })
  return found
}

describe('the client half styles itself with real theme tokens', () => {
  const files = clientFiles()

  it('found the client sources, so the check is not vacuous', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('reads tokens somewhere, so a renamed directory cannot pass it', () => {
    const total = files.reduce((sum, name) => sum + tokensUsed(readFileSync(join(CLIENT_DIR, name), 'utf8')).length, 0)
    expect(total).toBeGreaterThan(20)
  })

  it('never reads a custom property the theme does not define', () => {
    const unknown: string[] = []
    for (const name of files) {
      for (const token of tokensUsed(readFileSync(join(CLIENT_DIR, name), 'utf8'))) {
        if (!THEME_TOKENS.has(token.name)) unknown.push(`${name}:${token.line} ${token.name}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('has no invented --dsh- prefix anywhere', () => {
    // The original mistake: a plausible-looking name matching nothing.
    const invented: string[] = []
    for (const name of files) {
      for (const token of tokensUsed(readFileSync(join(CLIENT_DIR, name), 'utf8'))) {
        if (token.name.startsWith('--dsh-')) invented.push(`${name}:${token.line} ${token.name}`)
      }
    }
    expect(invented).toEqual([])
  })

  it('never reads a shadow token, because the theme defines none', () => {
    // A shadow must be a literal: `var(--dsw-shadow-lv2)` resolved to nothing,
    // so the bubbles had no elevation at all.
    const shadows: string[] = []
    for (const name of files) {
      for (const token of tokensUsed(readFileSync(join(CLIENT_DIR, name), 'utf8'))) {
        if (token.name.startsWith('--dsw-shadow')) shadows.push(`${name}:${token.line} ${token.name}`)
      }
    }
    expect(shadows).toEqual([])
  })
})
