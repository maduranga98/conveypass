import { expect, type Page } from '@playwright/test'
import { DRIVER_PHONE, PASSWORD, PIN, STAFF } from './emulator.ts'

export async function loginStaff(page: Page, role: keyof typeof STAFF): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(STAFF[role].email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`/${String(role)}`))
}

export async function loginDriver(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Driver' }).click()
  await page.getByLabel('Phone number').fill(DRIVER_PHONE)
  await page.getByLabel('6-digit PIN').fill(PIN)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/driver/)
}

export const bellBadge = (page: Page) => page.getByTestId('bell-badge')
