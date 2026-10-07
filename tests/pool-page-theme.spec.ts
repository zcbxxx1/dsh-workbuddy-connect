/**
 * Theme-token hygiene for the pool page.
 *
 * An unknown CSS custom property does not fall back to anything — it resolves
 * to the empty string, so `color: var(--dsh-danger, #e06c75)` looks like it has
 * a fallback and in fact uses one only because the fallback is written inline.
 * A property written without one silently loses its colour.
 *
 * This has gone wrong twice on this page: first with invented `--dsh-*` names,
 * then by copying names out of `WorkBuddyPluginCard` that the live theme does
 * not define either. A static check is what catches it, because the failure is
 * invisible to the type checker and there is no React renderer in this suite.
 *
 * The allow-list is the token set from the client `Theme` inspect provider.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Every token the live theme defines (`Theme.listTokens`). */
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

const POOL_PAGE = join(import.meta.dirname, '..', 'src', 'client', 'WorkBuddyPoolPage.tsx')

/** Every `var(--x)` this file reads, with its line number. */
function tokensUsed(source: string): { name: string, line: number }[] {
  const found: { name: string, line: number }[] = []
  source.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(/var\((--[A-Za-z0-9-]+)/gu)) {
      if (match[1] !== undefined) found.push({ name: match[1], line: index + 1 })
    }
  })
  return found
}

describe('the pool page styles itself with real theme tokens', () => {
  const source = readFileSync(POOL_PAGE, 'utf8')

  it('reads at least one token, so the check is not vacuous', () => {
    expect(tokensUsed(source).length).toBeGreaterThan(4)
  })

  it('never reads a custom property the theme does not define', () => {
    const unknown = tokensUsed(source).filter(token => !THEME_TOKENS.has(token.name))
    expect(unknown.map(token => `${token.name} (line ${token.line})`)).toEqual([])
  })

  it('has no invented prefix of its own', () => {
    // The original mistake: `--dsh-*`, a plausible-looking name that matched
    // nothing. Guarding the prefix catches a future re-introduction directly.
    expect(tokensUsed(source).filter(token => token.name.startsWith('--dsh-'))).toEqual([])
  })
})
