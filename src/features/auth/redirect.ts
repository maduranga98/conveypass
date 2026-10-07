/** Only same-origin absolute paths; blocks open redirects like `//evil.com` or `/\evil.com`. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return null
  return next
}

export function loginUrl(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`
}

export function changePasswordUrl(next: string): string {
  return `/change-password?next=${encodeURIComponent(next)}`
}
