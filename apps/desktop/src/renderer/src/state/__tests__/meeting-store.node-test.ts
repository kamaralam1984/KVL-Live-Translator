/**
 * Plain-Node smoke test for Phase 14's bounded live-transcript memory —
 * zustand stores are plain JS (create() needs no DOM), so this is the
 * first *.node-test.ts for a renderer STATE store specifically (distinct
 * from apps/desktop/src/renderer/src/audio's existing pure-logic tests).
 * Run with `pnpm --filter @kvl/desktop test:meeting-store-core`.
 */
import { useMeetingStore, pushBounded, MAX_LIVE_SEGMENTS } from '../meetingStore';
import type { TranscriptSegment, TranslationResultDTO } from '@kvl/shared';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function seg(id: string): TranscriptSegment {
  return { id, sessionId: 's1', text: `segment ${id}`, isFinal: true, startMs: 0, endMs: 1000 };
}

// --- pushBounded: pure function ---
{
  let arr: number[] = [];
  for (let i = 0; i < 10; i += 1) arr = pushBounded(arr, i, 5);
  assert(arr.length === 5, `array never exceeds the cap, got length ${arr.length}`);
  assert(arr.join(',') === '5,6,7,8,9', `the MOST RECENT items are kept (oldest dropped, not newest), got [${arr.join(',')}]`);
}

{
  const arr = pushBounded([1, 2], 3, 10);
  assert(arr.join(',') === '1,2,3', 'below the cap, pushBounded behaves like a normal append');
}

// --- meetingStore: a real long-meeting-scale simulation (thousands of segments) ---
{
  useMeetingStore.getState().sessionStarted('sim-session');
  const SEGMENT_COUNT = 5000; // simulates a multi-hour meeting's worth of VAD-bounded chunks
  for (let i = 0; i < SEGMENT_COUNT; i += 1) {
    useMeetingStore.getState().appendTranscript(seg(String(i)));
    useMeetingStore.getState().appendTranslation({
      sessionId: 's1',
      originalText: `segment ${i}`,
      translatedText: `translated ${i}`,
      mode: 'hinglish',
      sourceLang: 'en',
      targetLang: 'hi',
      createdAt: new Date().toISOString(),
    } as TranslationResultDTO);
  }

  const state = useMeetingStore.getState();
  assert(state.transcript.length === MAX_LIVE_SEGMENTS, `after ${SEGMENT_COUNT} pushes, transcript never exceeds MAX_LIVE_SEGMENTS (${MAX_LIVE_SEGMENTS}), got ${state.transcript.length}`);
  assert(state.translations.length === MAX_LIVE_SEGMENTS, `after ${SEGMENT_COUNT} pushes, translations never exceeds MAX_LIVE_SEGMENTS (${MAX_LIVE_SEGMENTS}), got ${state.translations.length}`);
  assert(state.transcript[state.transcript.length - 1].id === String(SEGMENT_COUNT - 1), 'the most recently pushed segment is the last one in the bounded array');
  assert(state.transcript[0].id === String(SEGMENT_COUNT - MAX_LIVE_SEGMENTS), `the oldest RETAINED segment is exactly the ${MAX_LIVE_SEGMENTS}th-from-the-end one — nothing more, nothing less`);
  assert(state.latestTranslation?.originalText === `segment ${SEGMENT_COUNT - 1}`, 'latestTranslation still tracks the true most-recent result, unaffected by the cap');
}

// --- sessionStarted / clearTranscript still fully reset, unaffected by the cap ---
{
  useMeetingStore.getState().sessionStarted('another-session');
  assert(useMeetingStore.getState().transcript.length === 0, 'sessionStarted resets transcript to empty, even after a prior session filled it to the cap');
  assert(useMeetingStore.getState().translations.length === 0, 'sessionStarted resets translations to empty');

  useMeetingStore.getState().appendTranscript(seg('x'));
  useMeetingStore.getState().clearTranscript();
  assert(useMeetingStore.getState().transcript.length === 0, 'clearTranscript empties the live view');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
