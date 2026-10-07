import { Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { VehicleRouteBoundary } from '@/components/RouteErrorBoundary'
import { PageSpinner } from '@/components/ui/Spinner'
import { ForbiddenPage, NotFoundPage } from '@/features/auth/ErrorPages'
import { RequireAuth, RequireOperator, RequireRole, RoleHomeRedirect } from '@/features/auth/guards'
import { AuthedShell } from '@/features/auth/AuthedShell'
import {
  AdminLayout,
  ApprovalsPage,
  AuditPage,
  AuthActionPage,
  ChangePasswordPage,
  ContractorDetailPage,
  ContractorsPage,
  DashboardPage,
  DriverHome,
  ForgotPasswordPage,
  DriversPage,
  GateHome,
  LoginPage,
  NotificationsPage,
  OfficerLayout,
  OfficerQueue,
  OperatorInvitesPage,
  OperatorOverviewPage,
  OperatorWorkspaceDetailPage,
  OperatorWorkspacesPage,
  PlatformChangePasswordPage,
  PlatformLayout,
  PlatformLoginPage,
  PassesPage,
  PrivacyPage,
  QrLabelsPage,
  QueuePage,
  ReportsPage,
  ReviewPage,
  SecurityLayout,
  SetupPage,
  SettingsPage,
  UserSettingsPage,
  SupervisorHome,
  SupervisorLayout,
  UsersPage,
  VehicleRoute,
  VehiclesPage,
} from './lazyPages'


const lazyEl = (node: ReactNode) => <Suspense fallback={<PageSpinner />}>{node}</Suspense>

export const router = createBrowserRouter([
  { path: '/login', element: lazyEl(<LoginPage />) },
  { path: '/privacy', element: lazyEl(<PrivacyPage />) },
  // Public, outside the auth guard: workspace setup (invite link), staff password reset and Firebase's email action page.
  { path: '/setup', element: lazyEl(<SetupPage />) },
  { path: '/forgot-password', element: lazyEl(<ForgotPasswordPage />) },
  { path: '/auth/action', element: lazyEl(<AuthActionPage />) },
  // `/` sends everyone home (workspace users by role, operators to /platform); it handles auth itself.
  { path: '/', element: <RoleHomeRedirect /> },
  // Module 11: the Super admin sign-in. Public, lazy, noindex; not linked from any workspace screen.
  { path: '/platform/login', element: lazyEl(<PlatformLoginPage />) },
  {
    // Platform operator console (Module 9): operators only, no tenant, no notifications or workspace navigation.
    element: <RequireOperator />,
    children: [
      { path: '/platform/change-password', element: lazyEl(<PlatformChangePasswordPage />) },
      {
        path: '/platform',
        element: lazyEl(<PlatformLayout />),
        children: [
          { index: true, element: lazyEl(<OperatorOverviewPage />) },
          { path: 'invites', element: lazyEl(<OperatorInvitesPage />) },
          { path: 'workspaces', element: lazyEl(<OperatorWorkspacesPage />) },
          { path: 'workspaces/:tenantId', element: lazyEl(<OperatorWorkspaceDetailPage />) },
          { path: 'tenants', element: <Navigate to="/platform/workspaces" replace /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        // Everything below shares one live notification feed (the bell, /notifications and the tab title).
        element: <AuthedShell />,
        children: [
      { path: '/notifications', element: lazyEl(<NotificationsPage />) },
      { path: '/settings', element: lazyEl(<UserSettingsPage />) },
      { path: '/change-password', element: lazyEl(<ChangePasswordPage />) },
      { path: '/v/:vehicleId', element: <VehicleRouteBoundary>{lazyEl(<VehicleRoute />)}</VehicleRouteBoundary> },
      {
        element: <RequireRole roles={['admin']} />,
        children: [
          {
            path: '/admin',
            element: lazyEl(<AdminLayout />),
            children: [
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: 'dashboard', element: lazyEl(<DashboardPage scope="admin" />) },
              { path: 'users', element: lazyEl(<UsersPage />) },
              { path: 'contractors', element: lazyEl(<ContractorsPage />) },
              { path: 'contractors/:contractorId', element: lazyEl(<ContractorDetailPage />) },
              { path: 'vehicles', element: lazyEl(<VehiclesPage scope="admin" />) },
              { path: 'drivers', element: lazyEl(<DriversPage scope="admin" />) },
              { path: 'passes', element: lazyEl(<PassesPage />) },
              { path: 'reports', element: lazyEl(<ReportsPage />) },
              { path: 'audit', element: lazyEl(<AuditPage />) },
              // Module 5's gate log is now a report.
              { path: 'gate-log', element: <Navigate to="/admin/reports?type=gate_log" replace /> },
              { path: 'qr', element: lazyEl(<QrLabelsPage scope="admin" />) },
              { path: 'settings', element: lazyEl(<SettingsPage />) },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['supervisor']} />,
        children: [
          {
            path: '/supervisor',
            element: lazyEl(<SupervisorLayout />),
            children: [
              { index: true, element: lazyEl(<SupervisorHome />) },
              { path: 'approvals', element: lazyEl(<ApprovalsPage />) },
              { path: 'approvals/:passId', element: lazyEl(<ReviewPage />) },
              { path: 'vehicles', element: lazyEl(<VehiclesPage scope="supervisor" />) },
              { path: 'drivers', element: lazyEl(<DriversPage scope="supervisor" />) },
              { path: 'qr', element: lazyEl(<QrLabelsPage scope="supervisor" />) },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['officer']} />,
        children: [
          {
            path: '/officer',
            element: lazyEl(<OfficerLayout />),
            children: [
              { index: true, element: lazyEl(<OfficerQueue />) },
              { path: 'overview', element: lazyEl(<DashboardPage scope="officer" />) },
              { path: 'reports', element: lazyEl(<ReportsPage />) },
            ],
          },
        ],
      },
      {
        element: <RequireRole roles={['driver']} />,
        children: [{ path: '/driver', element: lazyEl(<DriverHome />) }],
      },
      {
        element: <RequireRole roles={['security']} />,
        children: [
          {
            path: '/security',
            element: lazyEl(<SecurityLayout />),
            children: [
              { index: true, element: lazyEl(<GateHome />) },
              { path: 'queue', element: lazyEl(<QueuePage />) },
            ],
          },
        ],
      },
        ],
      },
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '*', element: <NotFoundPage /> },
])
