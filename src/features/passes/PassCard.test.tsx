import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { makePass, no } from '@/test/passFactory'

vi.mock('@/lib/firebase', () => ({ app: {} }))
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), ref: (_s: unknown, p: string) => p, getDownloadURL: async (p: string) => `https://photos.test/${p}` }))

import { ChecklistSummary } from './ChecklistSummary'
import { PassCard } from './PassCard'

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe('PassCard', () => {
  it('shows the plate, vehicle, driver and time since submitted', () => {
    wrap(<PassCard pass={makePass()} now={Date.now()} onOpen={vi.fn()} />)
    expect(screen.getByText('WP LJ-4821')).toBeTruthy()
    expect(screen.getByText(/Tipper · Sunil Rathnayake/)).toBeTruthy()
    expect(screen.getByText('5 min ago')).toBeTruthy()
    expect(screen.queryByText(/issue/i)).toBeNull()
  })
  it('shows the contractor when asked and an issues chip when any answer is No', () => {
    wrap(<PassCard pass={makePass({ checklist: [no('a'), no('b')] })} now={Date.now()} contractorName="Lanka Cement" onOpen={vi.fn()} />)
    expect(screen.getByText(/Lanka Cement/)).toBeTruthy()
    expect(screen.getByText('2 issues')).toBeTruthy()
  })
  it('opens on click', async () => {
    const onOpen = vi.fn()
    wrap(<PassCard pass={makePass()} now={Date.now()} onOpen={onOpen} />)
    await userEvent.setup().click(screen.getByText('WP LJ-4821'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
  it('select mode: a clean card toggles, a card with issues has no checkbox and says "Open to review"', async () => {
    const onToggle = vi.fn()
    const onOpen = vi.fn()
    const user = userEvent.setup()
    const { unmount } = wrap(<PassCard pass={makePass()} now={Date.now()} mode="select" selectable onToggle={onToggle} onOpen={onOpen} />)
    await user.click(screen.getByRole('checkbox', { name: /select wp lj-4821/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    unmount()

    wrap(<PassCard pass={makePass({ checklist: [no('a')] })} now={Date.now()} mode="select" selectable={false} onToggle={onToggle} onOpen={onOpen} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Open to review')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /open to review/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('ChecklistSummary', () => {
  it('lists every item; No rows are highlighted and carry the driver’s note', () => {
    render(<ChecklistSummary items={[{ id: 'a', label: 'Dashcam is recording', answer: 'yes' }, no('b')]} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.getAttribute('data-answer')).toBe('yes')
    expect(rows[1]?.getAttribute('data-answer')).toBe('no')
    expect(rows[1]?.className).toContain('bg-danger-soft')
    expect(within(rows[1] as HTMLElement).getByText(/Loose cable/)).toBeTruthy()
    expect(screen.queryByText('All answers are Yes')).toBeNull()
  })
  it('says so when everything is Yes', () => {
    render(<ChecklistSummary items={[{ id: 'a', label: 'Item a', answer: 'yes' }]} />)
    expect(screen.getByText('All answers are Yes')).toBeTruthy()
  })
})
