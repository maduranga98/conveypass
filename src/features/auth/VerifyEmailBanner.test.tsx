import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendVerification = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
const user = vi.hoisted(() => ({ emailVerified: false, reload: vi.fn(), getIdToken: vi.fn(async () => 't') }))
const authMock = vi.hoisted(() => ({ currentUser: null as unknown }))
let role = 'admin'

vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/firebase', () => ({ auth: authMock }))
vi.mock('@/lib/emailActions', () => ({ sendVerificationEmail: (...a: unknown[]) => sendVerification(...a) }))
vi.mock('./useAuth', () => ({ useAuth: () => ({ session: { uid: 'u1', claims: { role } } }) }))

import { VerifyEmailBanner } from './VerifyEmailBanner'

const renderBanner = (path = '/admin') => render(<MemoryRouter initialEntries={[path]}><VerifyEmailBanner /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  role = 'admin'
  user.emailVerified = false
  user.reload.mockImplementation(async () => undefined)
  authMock.currentUser = user
  sendVerification.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('VerifyEmailBanner', () => {
  it('shows for unverified staff with Resend and "I\'ve verified"', () => {
    for (const r of ['admin', 'officer', 'supervisor', 'security']) {
      role = r
      const { unmount } = renderBanner()
      expect(screen.getByText('Verify your email so you can recover your account')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Resend' })).toBeEnabled()
      expect(screen.getByRole('button', { name: "I've verified" })).toBeEnabled()
      unmount()
    }
  })
  it('is never shown to drivers, to verified users, or on the forced change-password page', () => {
    role = 'driver'
    expect(renderBanner().container).toBeEmptyDOMElement()
    cleanupAll()
    role = 'admin'
    user.emailVerified = true
    expect(renderBanner().container).toBeEmptyDOMElement()
    cleanupAll()
    user.emailVerified = false
    expect(renderBanner('/change-password').container).toBeEmptyDOMElement()
  })
  it('Resend sends the email and then waits 60 seconds', async () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Verification email sent.'))
    expect(sendVerification).toHaveBeenCalledWith(user)
    expect(await screen.findByRole('button', { name: /Resend in \d+ s/ })).toBeDisabled()
    await act(async () => undefined) // let the countdown's effect start
    await act(async () => void vi.advanceTimersByTime(61_000))
    expect(await screen.findByRole('button', { name: 'Resend' })).toBeEnabled()
  })
  it('"I\'ve verified" reloads the user and clears the banner once the email is verified', async () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: "I've verified" }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith("We can't see the verification yet. Open the link in the email first."))
    expect(user.reload).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Verify your email/)).toBeInTheDocument()

    user.reload.mockImplementation(async () => void (user.emailVerified = true))
    fireEvent.click(screen.getByRole('button', { name: "I've verified" }))
    await waitFor(() => expect(screen.queryByText(/Verify your email/)).toBeNull())
    expect(user.getIdToken).toHaveBeenCalledWith(true)
  })
})

function cleanupAll() {
  document.body.innerHTML = ''
}
