/**
 * Plain-Node smoke test for Phase 10's pure-logic summary core:
 * truncateTranscript's cap-and-keep-most-recent behavior, and
 * filterConfirmedFacts's confirmed/completed-only rule (the phase's own
 * "confirmed meeting intelligence" requirement — unreviewed 'new' items
 * must never appear as a summary section). DB-dependent proofs (Meeting
 * History's aggregate query, full generate/save/delete round trips) are
 * covered by the ephemeral integration scripts, not here — same "pure
 * logic first" convention as every prior phase's test file. Run with
 * `pnpm --filter @kvl/backend test:summary-core`.
 */
import type { CopilotItemDTO } from '@kvl/shared';
import { truncateTranscript, MAX_TRANSCRIPT_CHARS } from '../providers/CloudSummaryProvider';
import { filterConfirmedFacts } from '../SummaryManager';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// --- truncateTranscript ---
{
  const short = 'A short transcript.';
  assert(truncateTranscript(short) === short, 'text under the cap is returned unchanged');

  const long = 'x'.repeat(MAX_TRANSCRIPT_CHARS + 5000);
  const truncated = truncateTranscript(long);
  assert(truncated.length === MAX_TRANSCRIPT_CHARS, `text over the cap is trimmed to exactly MAX_TRANSCRIPT_CHARS, got ${truncated.length}`);

  const marked = `OLDEST_MARKER${'a'.repeat(5000)}${'b'.repeat(MAX_TRANSCRIPT_CHARS)}NEWEST_MARKER`;
  const keptRecent = truncateTranscript(marked);
  assert(keptRecent === marked.slice(marked.length - MAX_TRANSCRIPT_CHARS), 'truncation keeps exactly the tail (most recent) text');
  assert(keptRecent.includes('NEWEST_MARKER') && !keptRecent.includes('OLDEST_MARKER'), 'the most recent text is preserved and the oldest text is dropped, not the reverse');
  assert(keptRecent.length === MAX_TRANSCRIPT_CHARS, `truncated length is exactly the cap regardless of input size, got ${keptRecent.length}`);

  // A meeting of any length — 15min/30min/60min/2hr — never exceeds the cap.
  for (const simulatedChars of [3_000, 15_000, 60_000, 240_000]) {
    const result = truncateTranscript('y'.repeat(simulatedChars));
    assert(result.length <= MAX_TRANSCRIPT_CHARS, `a ${simulatedChars}-char simulated transcript never exceeds MAX_TRANSCRIPT_CHARS, got ${result.length}`);
  }
}

// --- filterConfirmedFacts: only confirmed/completed items count, 'new' items are excluded ---
{
  function item(overrides: Partial<CopilotItemDTO> & { id: string }): CopilotItemDTO {
    return {
      sessionId: 's1',
      category: 'action-item',
      description: overrides.id,
      sourceText: overrides.id,
      timestampMs: 0,
      confidence: 0.8,
      status: 'new',
      providerId: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  const items: CopilotItemDTO[] = [
    item({ id: 'a', category: 'action-item', status: 'confirmed' }),
    item({ id: 'b', category: 'action-item', status: 'completed' }),
    item({ id: 'c', category: 'action-item', status: 'new' }), // unreviewed — must NOT appear
    item({ id: 'd', category: 'decision', status: 'confirmed' }), // wrong category — must NOT appear
  ];

  const actionItems = filterConfirmedFacts(items, 'action-item');
  assert(actionItems.length === 2 && actionItems.every((i) => i.id === 'a' || i.id === 'b'), `only confirmed/completed action-items are included, got ${JSON.stringify(actionItems.map((i) => i.id))}`);
  assert(!actionItems.some((i) => i.id === 'c'), "an unreviewed 'new' item never appears in the summary — the phase's own 'confirmed meeting intelligence' requirement");

  const decisions = filterConfirmedFacts(items, 'decision');
  assert(decisions.length === 1 && decisions[0].id === 'd', 'category filtering is exact — an action-item never leaks into the decisions section');

  const noneConfirmed: CopilotItemDTO[] = [item({ id: 'e', category: 'deadline', status: 'new' })];
  assert(filterConfirmedFacts(noneConfirmed, 'deadline').length === 0, 'a category with only unreviewed items yields an empty (not fabricated) section');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
