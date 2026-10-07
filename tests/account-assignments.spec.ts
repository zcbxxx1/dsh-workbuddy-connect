import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_VARIANT_ID,
  allAssignments,
  assignAccount,
  assignedVariantOf,
  unassignAccount,
} from '../src/account-assignments.ts'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'

/**
 * The assignment table decides which variant an imported account serves in.
 * Every case runs against a temp table, so the real `$DSH_HOME` file is never
 * touched; the default (WorkBuddy AI) is the contract users rely on when they
 * import without configuring anything.
 */

const CLEANUP: string[] = []

afterEach(() => {
  for (const dir of CLEANUP.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempTable(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-assign-'))
  CLEANUP.push(dir)
  return join(dir, 'assignments.json')
}

describe('assignedVariantOf', () => {
  it('answers the default for an account nobody assigned', () => {
    expect(assignedVariantOf('acct-1', tempTable())).toBe(DEFAULT_VARIANT_ID)
    expect(DEFAULT_VARIANT_ID).toBe(AI_VARIANT.id)
  })

  it('answers the default for an empty account id', () => {
    expect(assignedVariantOf('', tempTable())).toBe(DEFAULT_VARIANT_ID)
  })

  it('round-trips an explicit assignment to either variant', () => {
    const table = tempTable()
    assignAccount('acct-1', CN_VARIANT.id, table)
    expect(assignedVariantOf('acct-1', table)).toBe(CN_VARIANT.id)
    assignAccount('acct-2', AI_VARIANT.id, table)
    expect(assignedVariantOf('acct-2', table)).toBe(AI_VARIANT.id)
  })

  it('keeps accounts independent', () => {
    const table = tempTable()
    assignAccount('acct-1', CN_VARIANT.id, table)
    expect(assignedVariantOf('acct-2', table)).toBe(DEFAULT_VARIANT_ID)
  })

  it('lets a reassignment move an account between products', () => {
    const table = tempTable()
    assignAccount('acct-1', CN_VARIANT.id, table)
    assignAccount('acct-1', AI_VARIANT.id, table)
    expect(assignedVariantOf('acct-1', table)).toBe(AI_VARIANT.id)
  })

  it('returns to the default when an assignment is removed', () => {
    const table = tempTable()
    assignAccount('acct-1', CN_VARIANT.id, table)
    unassignAccount('acct-1', table)
    expect(assignedVariantOf('acct-1', table)).toBe(DEFAULT_VARIANT_ID)
  })

  it('treats removing an absent assignment as a no-op', () => {
    const table = tempTable()
    expect(() => unassignAccount('acct-1', table)).not.toThrow()
    expect(existsSync(table)).toBe(false)
  })

  it('reads a corrupt table as empty instead of throwing', () => {
    const table = tempTable()
    writeFileSync(table, 'not json {{{')
    expect(assignedVariantOf('acct-1', table)).toBe(DEFAULT_VARIANT_ID)
  })

  it('drops entries whose value is not a known variant', () => {
    const table = tempTable()
    writeFileSync(table, JSON.stringify({ 'acct-1': 'workbuddy-jp', 'acct-2': CN_VARIANT.id }))
    expect(assignedVariantOf('acct-1', table)).toBe(DEFAULT_VARIANT_ID)
    expect(assignedVariantOf('acct-2', table)).toBe(CN_VARIANT.id)
  })

  it('drops entries whose value is not a string', () => {
    const table = tempTable()
    writeFileSync(table, JSON.stringify({ 'acct-1': 42 }))
    expect(assignedVariantOf('acct-1', table)).toBe(DEFAULT_VARIANT_ID)
  })
})

describe('assignAccount', () => {
  it('refuses an unknown variant id', () => {
    expect(() => assignAccount('acct-1', 'workbuddy-jp', tempTable())).toThrow(/unknown variant/)
  })

  it('refuses an empty account id', () => {
    expect(() => assignAccount('', AI_VARIANT.id, tempTable())).toThrow(/no id/)
  })

  it('writes atomically, leaving no temp file behind', () => {
    const table = tempTable()
    assignAccount('acct-1', CN_VARIANT.id, table)
    expect(existsSync(`${table}.tmp`)).toBe(false)
    expect(JSON.parse(readFileSync(table, 'utf8'))).toEqual({ 'acct-1': CN_VARIANT.id })
  })
})

describe('allAssignments', () => {
  it('answers every explicit assignment and nothing for the default', () => {
    const table = tempTable()
    assignAccount('acct-1', CN_VARIANT.id, table)
    expect(allAssignments(table)).toEqual({ 'acct-1': CN_VARIANT.id })
  })

  it('answers an empty object for a missing table', () => {
    expect(allAssignments(tempTable())).toEqual({})
  })
})
