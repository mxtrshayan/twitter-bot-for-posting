import { expect, it } from 'vitest';
import type { Cookie } from 'playwright';
import { recoveryCookies, checkpointCookies, sessionAfterCheckFailure } from '../packages/browser/session-cookies';
const auth = (value: string, expires = Date.now() / 1000 + 86400): Cookie => ({name:'auth_token',value,domain:'.x.com',path:'/',httpOnly:true,secure:true,sameSite:'None',expires});
it('keeps the current profile authentication instead of replacing it with an older snapshot', () => {
  expect(recoveryCookies([auth('new-token')], [auth('old-token')], 'VERIFIED')).toEqual([]);
});
it('recovers a missing session from its own valid backup without extending expiry', () => {
  const saved = [auth('browser-one'), {...auth('expired',1), name:'guest_id'}];
  expect(recoveryCookies([], saved, 'VERIFIED')).toEqual([saved[0]]);
  expect(recoveryCookies([], [auth('browser-two')], 'VERIFIED')[0].value).toBe('browser-two');
});
it('does not restore confirmed rejected or expired authentication', () => {
  expect(recoveryCookies([], [auth('revoked')], 'REJECTED')).toEqual([]);
  expect(recoveryCookies([], [auth('expired',1)], 'VERIFIED')).toEqual([]);
});
it('preserves the backup if a signed-out error page removes authentication', () => {
  expect(checkpointCookies([])).toBeNull();
  const live = [auth('refreshed')];
  expect(checkpointCookies(live)).toBe(live);
});

it('keeps identified sessions across network failures but rejects a confirmed sign-out', () => {
  expect(sessionAfterCheckFailure('VERIFIED', '@first', false)).toBe('VERIFIED');
  expect(sessionAfterCheckFailure('CHECK_FAILED', '@second', false)).toBe('VERIFIED');
  expect(sessionAfterCheckFailure('VERIFIED', '@first', true)).toBe('REJECTED');
  expect(sessionAfterCheckFailure('SAVED', null, false)).toBe('CHECK_FAILED');
  expect(sessionAfterCheckFailure('REJECTED', null, false)).toBe('REJECTED');
});
