/**
 * Plain-Node smoke test for Phase 9's pure-logic copilot core:
 * EventDetector's real question/deadline detection (plus the phase's own
 * explicit "should is not automatically an action item" negative case) and
 * per-category signal scoring, and CopilotBatcher's every flush trigger —
 * all deterministic via an explicit `now`, no real timers. Run with
 * `pnpm --filter @kvl/backend test:copilot-core`.
 */
import { detectLocalItems, scoreSignal } from '../EventDetector';
import { CopilotBatcher } from '../CopilotBatcher';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// --- EventDetector: questions ---
{
  const q1 = detectLocalItems('Can you finish this by Friday?');
  assert(q1.some((d) => d.category === 'question' && d.confidence === 1.0), `"?"-ending sentence detected as a question with full confidence, got ${JSON.stringify(q1)}`);

  const q2 = detectLocalItems('What is the timeline for this');
  assert(q2.some((d) => d.category === 'question' && d.confidence === 0.6), `question-word start without "?" detected at lower confidence, got ${JSON.stringify(q2)}`);

  const notQ = detectLocalItems('We deployed the update yesterday.');
  assert(!notQ.some((d) => d.category === 'question'), 'a plain statement is not flagged as a question');
}

// --- EventDetector: deadlines ---
{
  const d1 = detectLocalItems('Can you send the proposal tomorrow?');
  const deadline = d1.find((d) => d.category === 'deadline');
  assert(Boolean(deadline), `"tomorrow" is detected as a real deadline signal, got ${JSON.stringify(d1)}`);
  assert(deadline?.dueText?.toLowerCase() === 'tomorrow', `deadline dueText captures the actual phrase, got "${deadline?.dueText}"`);

  const both = detectLocalItems('Can you send the proposal tomorrow?');
  assert(both.some((d) => d.category === 'question') && both.some((d) => d.category === 'deadline'), 'a single sentence can be both a question and a deadline at once');

  const noDeadline = detectLocalItems('The architecture looks good overall.');
  assert(!noDeadline.some((d) => d.category === 'deadline'), 'a sentence with no date phrase is not flagged as a deadline');
}

// --- EventDetector: per-category signal scoring, including the explicit "should" negative case ---
{
  const decision = scoreSignal('We approved the new design.');
  assert(decision?.category === 'decision', `"approved" scores as a decision signal, got ${JSON.stringify(decision)}`);

  const action = scoreSignal('Can you send the updated proposal?');
  assert(action?.category === 'action-item', `"can you send" scores as an action-item signal, got ${JSON.stringify(action)}`);

  const pricing = scoreSignal('What is the budget for this project?');
  assert(pricing?.category === 'pricing-discussion', `"budget" scores as a pricing-discussion signal, got ${JSON.stringify(pricing)}`);

  // The phase's own explicit warning: "should" must NOT create an action item.
  const shouldOnly = scoreSignal('We should probably think about this at some point.');
  assert(shouldOnly === null, `a sentence containing only "should" produces no signal at all (not an action-item, not a requirement), got ${JSON.stringify(shouldOnly)}`);

  const noSignal = scoreSignal('Good morning everyone, thanks for joining.');
  assert(noSignal === null, 'small talk with no trigger phrases produces no signal');
}

// --- CopilotBatcher: max-segments trigger ---
{
  const batcher = new CopilotBatcher({ maxBatchSegments: 3, maxBatchWaitMs: 999_999, highSignalFlushThreshold: 2, minFlushIntervalMs: 0 }); // highSignalFlushThreshold=2 disables the early-flush path for this test
  const t0 = 1_000_000;
  assert(batcher.addSegment('s1', { text: 'a', timestampMs: 0, signalScore: 0 }, t0) === null, 'buffering below max-segments does not flush yet (1/3)');
  assert(batcher.addSegment('s1', { text: 'b', timestampMs: 1000, signalScore: 0 }, t0 + 100) === null, 'buffering below max-segments does not flush yet (2/3)');
  const flush = batcher.addSegment('s1', { text: 'c', timestampMs: 2000, signalScore: 0 }, t0 + 200);
  assert(flush?.reason === 'max-segments' && flush.segments.length === 3, `reaching maxBatchSegments flushes all 3 segments, got ${JSON.stringify(flush)}`);
}

// --- CopilotBatcher: high-signal early flush + min-interval cooldown ---
{
  const batcher = new CopilotBatcher({ maxBatchSegments: 100, maxBatchWaitMs: 999_999, highSignalFlushThreshold: 0.7, minFlushIntervalMs: 8_000 });
  const t0 = 1_000_000;
  const first = batcher.addSegment('s1', { text: 'We approved the design', timestampMs: 0, signalScore: 0.9 }, t0);
  assert(first?.reason === 'high-signal', `a high-signal segment flushes immediately, got ${JSON.stringify(first)}`);

  // A second high-signal segment arriving inside the cooldown window must NOT flush again.
  const withinCooldown = batcher.addSegment('s1', { text: 'We also approved the budget', timestampMs: 1000, signalScore: 0.9 }, t0 + 2_000);
  assert(withinCooldown === null, 'a second high-signal segment inside the min-flush-interval cooldown does not trigger another flush');

  // After the cooldown elapses, a new high-signal segment can flush again.
  const afterCooldown = batcher.addSegment('s1', { text: 'We approved the timeline too', timestampMs: 9000, signalScore: 0.9 }, t0 + 9_000);
  assert(afterCooldown?.reason === 'high-signal', `a high-signal segment after the cooldown elapses flushes again, got ${JSON.stringify(afterCooldown)}`);
}

// --- CopilotBatcher: max-wait time-based flush (checkTimeout, no new segment needed) ---
{
  const batcher = new CopilotBatcher({ maxBatchSegments: 100, maxBatchWaitMs: 25_000, highSignalFlushThreshold: 2, minFlushIntervalMs: 0 });
  const t0 = 1_000_000;
  batcher.addSegment('s1', { text: 'Let us discuss the roadmap', timestampMs: 0, signalScore: 0.5 }, t0);

  assert(batcher.checkTimeout('s1', t0 + 10_000) === null, 'checkTimeout does not flush before maxBatchWaitMs has elapsed');
  const flush = batcher.checkTimeout('s1', t0 + 26_000);
  assert(flush?.reason === 'max-wait' && flush.segments.length === 1, `checkTimeout flushes once maxBatchWaitMs elapses, got ${JSON.stringify(flush)}`);
}

// --- CopilotBatcher: a pure-noise batch (zero signal) is dropped, never flushed — the actual cost-saving mechanism ---
{
  const batcher = new CopilotBatcher({ maxBatchSegments: 100, maxBatchWaitMs: 25_000, highSignalFlushThreshold: 2, minFlushIntervalMs: 0 });
  const t0 = 1_000_000;
  batcher.addSegment('s1', { text: 'Good morning everyone', timestampMs: 0, signalScore: 0 }, t0);
  batcher.addSegment('s1', { text: 'How was your weekend', timestampMs: 1000, signalScore: 0 }, t0 + 500);

  const timedOut = batcher.checkTimeout('s1', t0 + 26_000);
  assert(timedOut === null, 'a batch with zero signal anywhere in it is dropped on timeout instead of being sent to the LLM');

  // Confirms the buffer was actually cleared, not just skipped once.
  const stillEmpty = batcher.checkTimeout('s1', t0 + 27_000);
  assert(stillEmpty === null, 'the dropped noise buffer stays empty afterward (does not re-flush stale segments)');
}

// --- CopilotBatcher: endSession clears the buffer ---
{
  const batcher = new CopilotBatcher();
  const t0 = 1_000_000;
  batcher.addSegment('s1', { text: 'hello', timestampMs: 0, signalScore: 0 }, t0);
  assert(batcher.activeSessionIds().includes('s1'), 'a session with buffered segments is tracked as active');
  batcher.endSession('s1');
  assert(!batcher.activeSessionIds().includes('s1'), 'endSession removes the session from tracking, freeing its buffer');
}

// --- CopilotBatcher: getBufferedCount (Phase 14 performance dashboard) ---
{
  const batcher = new CopilotBatcher({ maxBatchSegments: 100, maxBatchWaitMs: 999_999, highSignalFlushThreshold: 2, minFlushIntervalMs: 0 });
  const t0 = 1_000_000;
  assert(batcher.getBufferedCount('unknown-session') === 0, 'a session that was never seen reports 0 buffered, not undefined/throw');

  batcher.addSegment('s1', { text: 'a', timestampMs: 0, signalScore: 0 }, t0);
  batcher.addSegment('s1', { text: 'b', timestampMs: 100, signalScore: 0 }, t0 + 100);
  assert(batcher.getBufferedCount('s1') === 2, `getBufferedCount reflects segments buffered so far, got ${batcher.getBufferedCount('s1')}`);

  batcher.addSegment('s1', { text: 'c', timestampMs: 200, signalScore: 0 }, t0 + 200);
  assert(batcher.getBufferedCount('s1') === 3, `getBufferedCount reflects all 3 buffered segments right before a flush/drop, got ${batcher.getBufferedCount('s1')}`);
  batcher.checkTimeout('s1', t0 + 1_000_000); // zero-signal batch — dropped on timeout, not flushed (see the test above)
  assert(batcher.getBufferedCount('s1') === 0, `getBufferedCount drops back to 0 once the buffer is cleared (flush or drop), got ${batcher.getBufferedCount('s1')}`);
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
