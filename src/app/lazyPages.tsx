import { lazy } from 'react'

export const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
export const ChangePasswordPage = lazy(() => import('@/features/auth/ChangePasswordPage'))
export const RolePlaceholder = lazy(() => import('@/features/auth/RolePlaceholder'))
export const VehiclePlaceholder = lazy(() => import('@/features/auth/VehiclePlaceholder'))
export const AdminLayout = lazy(() => import('@/features/admin/AdminLayout'))
export const UsersPage = lazy(() => import('@/features/admin/UsersPage'))
export const ContractorsPage = lazy(() => import('@/features/admin/ContractorsPage'))
