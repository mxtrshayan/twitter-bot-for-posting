import type { Cookie } from 'playwright';
const valid = (cookie: Cookie, now: number) => cookie.expires === -1 || cookie.expires > now;
export function hasXAuth(cookies: Cookie[], now = Date.now() / 1000) {
  return cookies.some(cookie => cookie.name === 'auth_token' && !!cookie.value && /^(\.)?x\.com$/.test(cookie.domain) && valid(cookie, now));
}
// The live persistent profile is authoritative; the encrypted snapshot is a recovery backup.
export function recoveryCookies(current: Cookie[], saved: Cookie[], status: string, now = Date.now() / 1000) {
  if (hasXAuth(current, now) || status === 'REJECTED' || !hasXAuth(saved, now)) return [];
  return saved.filter(cookie => valid(cookie, now));
}
export function checkpointCookies(current: Cookie[]) {
  // Do not erase a recoverable snapshot because an error page cleared authentication.
  return hasXAuth(current) ? current : null;
}
export function sessionAfterCheckFailure(status: string, username: string | null, rejected: boolean) {
  if (rejected) return 'REJECTED';
  // Connectivity cannot invalidate a previously identified account.
  if (username && status !== 'REJECTED') return 'VERIFIED';
  return status === 'REJECTED' ? 'REJECTED' : 'CHECK_FAILED';
}
