import type { CopilotCategory } from '@kvl/shared';

export interface LocalDetection {
  category: 'question' | 'deadline';
  description: string;
  sourceText: string;
  confidence: number;
  dueText?: string;
}

const QUESTION_START_WORDS = /^(can|could|would|will|do|does|did|are|is|what|when|where|why|how)\b/i;

/** A sentence ending in "?" is a real, ~100%-reliable signal — no LLM
 * needed. Starting with a question word but no "?" (STT punctuation can be
 * unreliable) is a softer, lower-confidence signal. */
function detectQuestion(text: string): LocalDetection | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const endsWithQuestionMark = trimmed.endsWith('?');
  const startsWithQuestionWord = QUESTION_START_WORDS.test(trimmed);
  if (!endsWithQuestionMark && !startsWithQuestionWord) return null;

  return {
    category: 'question',
    description: trimmed,
    sourceText: trimmed,
    confidence: endsWithQuestionMark ? 1.0 : 0.6,
  };
}

/** Real date/time-phrase detection — genuine regex matching, not a stub —
 * but lower confidence than a question mark, since a date phrase isn't
 * always a real meeting deadline (e.g. "Friday's episode of my show"). */
const DEADLINE_PATTERNS: RegExp[] = [
  /\bby\s+(the\s+)?(end of (the )?(day|week)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next week)\b/i,
  /\b(end of (the )?day|EOD|end of (the )?week|EOW)\b/i,
  /\bASAP\b/i,
  /\bnext\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bin\s+\d+\s+(days?|weeks?|hours?)\b/i,
  /\b(today|tomorrow|tonight)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];

function detectDeadline(text: string): LocalDetection | null {
  const trimmed = text.trim();
  for (const pattern of DEADLINE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        category: 'deadline',
        description: trimmed,
        sourceText: trimmed,
        confidence: 0.7,
        dueText: match[0],
      };
    }
  }
  return null;
}

/** Question and deadline can both apply to the same sentence
 * ("Can you finish this by Friday?") — returns whichever match. */
export function detectLocalItems(text: string): LocalDetection[] {
  return [detectQuestion(text), detectDeadline(text)].filter((d): d is LocalDetection => d !== null);
}

/** Trigger-phrase scoring for the 8 categories only a cloud LLM can really
 * judge — this score is NEVER itself a detected item (the spec explicitly
 * warns against treating "should" as an automatic action item; "should" is
 * deliberately absent from every list below). It only decides whether a
 * segment is worth an urgent batch flush — see CopilotBatcher.ts. */
const SIGNAL_KEYWORDS: Record<Exclude<CopilotCategory, 'question' | 'deadline'>, RegExp[]> = {
  decision: [/\bapproved\b/i, /\bagreed\b/i, /\bdecided\b/i, /\blet'?s go with\b/i, /\bwe'?ll use\b/i, /\bfinal(ized)? decision\b/i],
  'action-item': [/\bcan you\b/i, /\bplease\s+(send|prepare|update|share|create|finish|review)\b/i, /\bi'?ll\b/i, /\bwe will\b/i, /\bi will\b/i, /\baction item\b/i],
  requirement: [/\bmust\b/i, /\brequire[sd]?\b/i, /\bneed(s|ed)? to\b/i, /\bhas to\b/i],
  objection: [/\bconcerned? about\b/i, /\bissue with\b/i, /\bproblem with\b/i, /\bnot sure about\b/i, /\bworried about\b/i, /\bdisagree\b/i],
  'pricing-discussion': [/\$\s?\d/, /\bbudget\b/i, /\bpricing?\b/i, /\bcost\b/i, /\bquote\b/i, /\binvoice\b/i],
  'technical-requirement': [/\bAPI\b/i, /\barchitecture\b/i, /\bdatabase\b/i, /\bintegration\b/i, /\bperformance\b/i, /\bsecurity\b/i, /\bscalability\b/i],
  'follow-up': [/\bfollow(\s|-)?up\b/i, /\bcircle back\b/i, /\btouch base\b/i, /\bnext steps?\b/i],
  'client-request': [/\bclient (wants|needs|requested|asked)\b/i, /\bcan we get\b/i, /\bwe would like\b/i],
};

export interface SignalScore {
  category: CopilotCategory;
  score: number;
}

/** Returns the single highest-scoring category, or null if nothing
 * matched. 1 keyword hit -> 0.75, 2+ hits -> 1.0 (floor 0.75, not a
 * detected item — see the doc comment above). */
export function scoreSignal(text: string): SignalScore | null {
  let best: SignalScore | null = null;
  for (const [category, patterns] of Object.entries(SIGNAL_KEYWORDS)) {
    const hits = patterns.filter((p) => p.test(text)).length;
    if (hits === 0) continue;
    const score = Math.min(1, 0.5 + hits * 0.25);
    if (!best || score > best.score) best = { category: category as CopilotCategory, score };
  }
  return best;
}
