/**
 * Phase 13 pure-logic tests: WsRateLimiter's sliding window, and the
 * transcript-retention cutoff-date computation. The token auth/
 * verifyClient/maxPayload/connection-cap logic itself is Electron-
 * independent but does need a real WS server to prove end-to-end (see the
 * Phase 13 ephemeral WS-integration script instead — this file covers only
 * what's testable without a live socket).
 * Run: pnpm --filter @kvl/backend test:security-core
 */
import { WsRateLimiter } from '../WsRateLimiter';
import { retentionCutoffIso } from '../../summary/TranscriptRetention';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// --- WsRateLimiter: sliding window ---
{
  const limiter = new WsRateLimiter(3, 1000); // 3 messages per 1000ms
  const t0 = 1_000_000;

  assert(limiter.recordAndCheck(t0) === true, '1st message within the window is allowed');
  assert(limiter.recordAndCheck(t0 + 10) === true, '2nd message within the window is allowed');
  assert(limiter.recordAndCheck(t0 + 20) === true, '3rd message within the window is allowed');
  assert(limiter.recordAndCheck(t0 + 30) === false, '4th message within the same window exceeds the limit');
}

{
  const limiter = new WsRateLimiter(2, 500);
  const t0 = 2_000_000;
  limiter.recordAndCheck(t0);
  limiter.recordAndCheck(t0 + 10);
  assert(limiter.recordAndCheck(t0 + 20) === false, 'limit is hit within the window');
  assert(limiter.recordAndCheck(t0 + 600) === true, 'the window rolls off — old timestamps age out and the connection is allowed again');
}

{
  const limiter = new WsRateLimiter(1, 100);
  assert(limiter.recordAndCheck(0) === true, 'first message always allowed regardless of maxMessages=1');
  assert(limiter.recordAndCheck(50) === false, 'a maxMessages=1 limiter blocks a 2nd message inside the window');
}

// --- retentionCutoffIso: deterministic cutoff-date computation ---
{
  const now = new Date('2026-08-21T12:00:00.000Z');
  assert(retentionCutoffIso('never', now) === null, "'never' has no cutoff — nothing is ever swept");
  assert(retentionCutoffIso('session', now) === null, "'session' has no periodic-sweep cutoff — it's handled by immediate delete on session:end instead");
  assert(retentionCutoffIso('1day', now) === '2026-08-20T12:00:00.000Z', `'1day' cutoff is exactly 24h before now, got ${retentionCutoffIso('1day', now)}`);
  assert(retentionCutoffIso('7days', now) === '2026-08-14T12:00:00.000Z', `'7days' cutoff is exactly 7*24h before now, got ${retentionCutoffIso('7days', now)}`);
  assert(retentionCutoffIso('30days', now) === '2026-07-22T12:00:00.000Z', `'30days' cutoff is exactly 30*24h before now, got ${retentionCutoffIso('30days', now)}`);
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
