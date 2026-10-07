import { useCallback, useMemo, useState } from 'react'
import { issueCount, isExpired } from './passView'
import type { PassWithId } from '@/types/passes'

/**
 * Only a pass with every checklist answer Yes, from today, can be picked for bulk approval. The server refuses the
 * others anyway (`has_issues`); the UI just does not offer them.
 */
export const isBulkSelectable = (pass: Pick<PassWithId, 'checklist' | 'status' | 'dateKey'>, today: string): boolean =>
  issueCount(pass) === 0 && !isExpired(pass, today)

/** Toggle one pass in a selection. Passes that are not selectable are never added. */
export function toggleSelection(selected: ReadonlySet<string>, pass: PassWithId, today: string): Set<string> {
  const next = new Set(selected)
  if (next.has(pass.id)) next.delete(pass.id)
  else if (isBulkSelectable(pass, today)) next.add(pass.id)
  return next
}

/** Ids of every selectable pass in the list. */
export const selectableIds = (items: readonly PassWithId[], today: string): string[] =>
  items.filter((p) => isBulkSelectable(p, today)).map((p) => p.id)

/** Drops ids whose pass left the list or stopped being selectable (decided elsewhere, resubmitted with issues, ...). */
export function pruneSelection(selected: ReadonlySet<string>, items: readonly PassWithId[], today: string): Set<string> {
  const ok = new Set(selectableIds(items, today))
  return new Set([...selected].filter((id) => ok.has(id)))
}

/** Select mode state for a live list. */
export function useBulkSelection(items: readonly PassWithId[], today: string | null) {
  const [active, setActive] = useState(false)
  const [raw, setSelected] = useState<ReadonlySet<string>>(new Set())
  // The list is live: a selected pass may vanish or stop being selectable under the user, so what counts as
  // selected is always the stored choice filtered through the current list.
  const selected = useMemo(() => (today ? pruneSelection(raw, items, today) : raw), [raw, items, today])

  const toggle = useCallback((pass: PassWithId) => today && setSelected((s) => toggleSelection(s, pass, today)), [today])
  const clear = useCallback(() => setSelected(new Set()), [])
  const selectAll = useCallback(() => today && setSelected(new Set(selectableIds(items, today))), [items, today])
  const exit = useCallback(() => {
    setActive(false)
    setSelected(new Set())
  }, [])
  const chosen = useMemo(() => items.filter((p) => selected.has(p.id)), [items, selected])

  return { active, enter: () => setActive(true), exit, selected, chosen, toggle, clear, selectAll }
}
