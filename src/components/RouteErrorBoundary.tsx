import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { ErrorBoundary, type BoundaryVariant } from './ErrorBoundary'

/** A boundary that resets when the route changes, so navigating away from a crashed screen works. */
export function RouteErrorBoundary({ variant, children }: { variant: BoundaryVariant; children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary key={pathname} variant={variant}>
      {children}
    </ErrorBoundary>
  )
}

/** The shared vehicle screen (`/v/:vehicleId`): the gate view for security, the pre-trip form for everyone else. */
export function VehicleRouteBoundary({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  return <RouteErrorBoundary variant={session?.claims.role === 'security' ? 'gate' : 'form'}>{children}</RouteErrorBoundary>
}
