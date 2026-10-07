import { describe, expect, it } from 'vitest'
import { makePass, no, TODAY, YESTERDAY } from '@/test/passFactory'
import { isBulkSelectable, pruneSelection, selectableIds, toggleSelection } from './bulk'

const clean = makePass({ id: 'clean' })
const issue = makePass({ id: 'issue', checklist: [no('a')] })
const old = makePass({ id: 'old', dateKey: YESTERDAY })

describe('bulk selection', () => {
  it('only passes with every answer Yes, from today, are selectable', () => {
    expect(isBulkSelectable(clean, TODAY)).toBe(true)
    expect(isBulkSelectable(issue, TODAY)).toBe(false)
    expect(isBulkSelectable(old, TODAY)).toBe(false)
  })
  it('toggling a pass with issues never selects it', () => {
    expect(toggleSelection(new Set(), issue, TODAY).size).toBe(0)
    expect(toggleSelection(new Set(), old, TODAY).size).toBe(0)
    const picked = toggleSelection(new Set(), clean, TODAY)
    expect([...picked]).toEqual(['clean'])
    expect(toggleSelection(picked, clean, TODAY).size).toBe(0)
  })
  it('"select all" leaves the issue passes out', () => {
    expect(selectableIds([clean, issue, old, makePass({ id: 'c2' })], TODAY)).toEqual(['clean', 'c2'])
  })
  it('drops ids that left the list or got issues in the meantime', () => {
    const picked = new Set(['clean', 'gone', 'issue'])
    expect([...pruneSelection(picked, [clean, issue], TODAY)]).toEqual(['clean'])
  })
})
