/**
 * Per-account variant assignment: which product an account serves in.
 *
 * Why this exists. A credential file never says which product it belongs to —
 * both apps write the same format into the same directory (differing only by
 * basename, which imports lose), and discovery scans the shared import
 * directory for BOTH variants. So one imported account appears under
 * `workbuddy` and `workbuddy-ai` at once, and each variant would serve the
 * same account's models: duplicated groups in the picker, and a "default"
 * question with no answer.
 *
 * The upstream endpoint is decided by the credential's own `domain`, not by
 * the variant (see `upstream.ts`'s `chatBase`), so serving one account under
 * one variant is safe on either side — this table is presentation and
 * resolution policy, not a security boundary. That is also why the
 * `store.current()` region guard does not apply here: it protects the
 * desktop-file and plugin-copy paths from misconfigured `authFile` env vars,
 * a different failure mode from "one imported file, two variants".
 *
 * Storage is one JSON document of `accountId -> variantId`, written whole on
 * every change (the file is small and writes are rare). Accounts not in the
 * table take the configured default — WorkBuddy AI — so the common case
 * ("I imported a credential, where does it show?") needs no configuration.
 *
 * @module dsh-workbuddy-connect/account-assignments
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { workbuddyAssignmentsPath } from './credential-paths.ts'
import { AI_VARIANT, CN_VARIANT } from './variants.ts'

/** The variant an unassigned account serves in. */
export const DEFAULT_VARIANT_ID = AI_VARIANT.id

/** The stored document: account id -> variant id. */
type AssignmentDocument = Record<string, string>

/**
 * Whether a stored value names a shipped variant. Unknown ids are dropped on
 * read rather than served: a hand-edited file or a removed variant must not
 * make discovery compare against a descriptor that does not exist.
 */
function isKnownVariant(value: string): value is typeof CN_VARIANT.id | typeof AI_VARIANT.id {
  return value === CN_VARIANT.id || value === AI_VARIANT.id
}

/** Read the whole table. A missing, corrupt, or mis-typed file reads as empty. */
function load(path = workbuddyAssignmentsPath()): AssignmentDocument {
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && isKnownVariant(entry[1]))
    return Object.fromEntries(entries)
  } catch {
    // A corrupt table must not take discovery down: unassigned defaults are
    // the honest degradation, and the next write replaces the file wholesale.
    return {}
  }
}

/** Write the whole table atomically (temp file plus rename). */
function store(document: AssignmentDocument, path = workbuddyAssignmentsPath()): void {
  const directory = dirname(path)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

/** The variant id an account is assigned to, or the default when unassigned. */
export function assignedVariantOf(accountId: string, path?: string): string {
  if (accountId === '') return DEFAULT_VARIANT_ID
  return load(path)[accountId] ?? DEFAULT_VARIANT_ID
}

/** Every explicit assignment, as the pool page's controls read it. */
export function allAssignments(path?: string): Record<string, string> {
  return load(path)
}

/** Assign one account to a variant. Unknown variant ids are refused. */
export function assignAccount(accountId: string, variantId: string, path?: string): void {
  if (accountId === '') throw new Error('cannot assign an account with no id')
  if (!isKnownVariant(variantId)) throw new Error(`unknown variant: ${variantId}`)
  const document = load(path)
  document[accountId] = variantId
  store(document, path)
}

/**
 * Remove one account's explicit assignment, returning it to the default.
 * Removing an absent assignment is a no-op, matching `Map.delete`.
 */
export function unassignAccount(accountId: string, path?: string): void {
  if (accountId === '') return
  const document = load(path)
  if (!(accountId in document)) return
  delete document[accountId]
  store(document, path)
}
