import type { ExplanationContextMode, TranscriptSegment } from '@kvl/shared';

const CURRENT_TOPIC_GAP_MS = 20_000;
const CURRENT_TOPIC_MAX_SEGMENTS = 30;

/**
 * Resolves which transcript segments to hand the explanation provider as
 * context, given a target sentence and the full session transcript
 * (already startMs-sorted, from speechManager.getTranscript). Only looks
 * backward from the target — future segments the speaker hasn't said yet
 * aren't relevant context for "what does this mean".
 */
export function resolveContextWindow(allSegments: TranscriptSegment[], targetSegmentId: string, mode: ExplanationContextMode): TranscriptSegment[] {
  const targetIndex = allSegments.findIndex((s) => s.id === targetSegmentId);
  if (targetIndex === -1) throw new Error(`Segment ${targetSegmentId} not found in this session's transcript`);
  const target = allSegments[targetIndex];

  if (mode === 'selected') return [target];

  if (mode === 'last-1min' || mode === 'last-5min') {
    const windowMs = mode === 'last-1min' ? 60_000 : 300_000;
    const cutoff = target.endMs - windowMs;
    return allSegments.slice(0, targetIndex + 1).filter((s) => s.startMs >= cutoff);
  }

  // 'current-topic' — an explicit HEURISTIC, not real topic detection: walk
  // backward while consecutive segments stay within a short pause of each
  // other, capped so one very chatty topic can't send an unbounded prompt.
  const result: TranscriptSegment[] = [target];
  for (let i = targetIndex - 1; i >= 0 && result.length < CURRENT_TOPIC_MAX_SEGMENTS; i -= 1) {
    const current = allSegments[i];
    const next = allSegments[i + 1];
    if (next.startMs - current.endMs > CURRENT_TOPIC_GAP_MS) break;
    result.unshift(current);
  }
  return result;
}
