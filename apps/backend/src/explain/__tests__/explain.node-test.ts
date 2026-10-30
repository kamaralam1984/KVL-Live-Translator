/**
 * Plain-Node smoke test for Phase 8's pure-logic explanation core:
 * contextWindow's 4 modes (including the current-topic heuristic's gap
 * boundary), termGlossary's whole-word matching, and ExplanationRouter's
 * priority/low-confidence-continue/best-partial-fallback/all-fail behavior
 * — all against fake providers or hand-built transcript fixtures, no real
 * network call needed. Run with
 * `pnpm --filter @kvl/backend test:explain-core`.
 */
import type { TranscriptSegment } from '@kvl/shared';
import type {
  ExplanationProvider,
  ExplanationProviderCapabilities,
  ExplanationProviderStatus,
  ExplanationProviderTier,
  ExplanationRequest,
  ExplanationResult,
} from '@kvl/explain';
import { resolveContextWindow } from '../contextWindow';
import { findKnownTerms } from '../termGlossary';
import { ExplanationRouter } from '../ExplanationRouter';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function seg(id: string, startMs: number, endMs: number, text: string): TranscriptSegment {
  return { id, sessionId: 's1', text, isFinal: true, startMs, endMs };
}

// --- contextWindow: 'selected' mode ---
{
  const segments = [seg('a', 0, 1000, 'first'), seg('b', 1500, 2500, 'second')];
  const result = resolveContextWindow(segments, 'b', 'selected');
  assert(result.length === 1 && result[0].id === 'b', `'selected' mode returns exactly the target segment, got ${result.map((s) => s.id).join(',')}`);
}

// --- contextWindow: 'last-1min' mode ---
{
  const segments = [seg('a', 0, 1000, 'old'), seg('b', 30_000, 31_000, 'mid'), seg('c', 70_000, 71_000, 'recent'), seg('d', 100_000, 102_000, 'target')];
  const result = resolveContextWindow(segments, 'd', 'last-1min');
  assert(
    result.map((s) => s.id).join(',') === 'c,d',
    `'last-1min' excludes segments older than 60s before the target, got ${result.map((s) => s.id).join(',')}`,
  );
}

// --- contextWindow: 'last-5min' mode ---
{
  const segments = [seg('a', 0, 1000, 'old'), seg('b', 200_000, 201_000, 'mid'), seg('c', 290_000, 291_000, 'recent'), seg('d', 320_000, 322_000, 'target')];
  const result = resolveContextWindow(segments, 'd', 'last-5min');
  assert(
    result.map((s) => s.id).join(',') === 'b,c,d',
    `'last-5min' excludes segments older than 300s before the target, got ${result.map((s) => s.id).join(',')}`,
  );
}

// --- contextWindow: 'current-topic' heuristic ---
{
  const segments = [
    seg('a', 0, 2000, 'hello everyone'),
    seg('b', 2500, 5000, 'lets discuss the architecture'),
    seg('c', 5500, 8000, 'can you walk me through the deployment'),
    // >20s gap here — a real topic shift by this heuristic's own rule
    seg('d', 40_000, 43_000, 'now lets talk about the budget'),
    seg('e', 43_500, 46_000, 'what is the timeline'),
  ];
  const result = resolveContextWindow(segments, 'e', 'current-topic');
  assert(
    result.map((s) => s.id).join(',') === 'd,e',
    `'current-topic' stops at a >20s gap, got ${result.map((s) => s.id).join(',')}`,
  );
}

// --- contextWindow: unknown segmentId throws ---
{
  let threw = false;
  try {
    resolveContextWindow([seg('a', 0, 1000, 'x')], 'missing', 'selected');
  } catch {
    threw = true;
  }
  assert(threw, 'resolveContextWindow throws for an unknown segmentId rather than silently returning empty');
}

// --- termGlossary: whole-word matching, including a real substring-collision non-match ---
{
  const terms = findKnownTerms('Can you explain the API and the deployment architecture?');
  const found = terms.map((t) => t.term).sort();
  assert(found.join(',') === 'api,architecture,deployment', `finds all real known terms in the sentence, got ${found.join(',')}`);

  const noMatch = findKnownTerms('We have an emergency meeting');
  assert(noMatch.length === 0, `'merge' does not match inside 'emergency' (whole-word boundary respected), got ${noMatch.map((t) => t.term).join(',')}`);

  const multiWord = findKnownTerms('Please open a pull request against the load balancer config');
  assert(multiWord.some((t) => t.term === 'pull request') && multiWord.some((t) => t.term === 'load balancer'), 'multi-word terms match correctly');
}

// --- ExplanationRouter: priority, low-confidence-continue, best-partial-fallback, all-fail ---
function makeCapabilities(overrides: Partial<ExplanationProviderCapabilities> & { id: string }): ExplanationProviderCapabilities {
  return { displayName: overrides.id, available: true, offline: false, requiresApiKey: false, tier: 'local', ...overrides };
}

class FakeExplanationProvider implements ExplanationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: ExplanationProviderTier;
  private status: ExplanationProviderStatus = 'ready';
  calls = 0;

  constructor(
    private readonly opts: { id: string; tier?: ExplanationProviderTier; available?: boolean; shouldFail?: boolean; confidence?: number; text?: string; requiresApiKey?: boolean },
  ) {
    this.id = opts.id;
    this.displayName = opts.id;
    this.tier = opts.tier ?? 'local';
  }

  async start(): Promise<void> {
    this.status = 'ready';
  }
  async stop(): Promise<void> {
    this.status = 'unavailable';
  }
  async explain(_request: ExplanationRequest): Promise<ExplanationResult> {
    this.calls += 1;
    if (this.opts.shouldFail) throw new Error(`${this.id} simulated failure`);
    return {
      simpleMeaning: this.opts.text ?? `[${this.id}] meaning`,
      whatTheyAreAsking: 'asking',
      importantContext: 'context',
      terms: [],
      suggestedResponse: 'response',
      confidence: this.opts.confidence,
    };
  }
  getStatus(): ExplanationProviderStatus {
    return this.status;
  }
  getCapabilities(): ExplanationProviderCapabilities {
    return makeCapabilities({ id: this.id, tier: this.opts.tier, available: this.opts.available ?? true, requiresApiKey: this.opts.requiresApiKey ?? false });
  }
}

function makeRequest(): ExplanationRequest {
  return { sentence: 'Can you walk me through the deployment architecture?', contextSegments: ['Can you walk me through the deployment architecture?'] };
}

// Priority: first available+usable provider wins
{
  const local = new FakeExplanationProvider({ id: 'local', text: 'local meaning' });
  const cloud = new FakeExplanationProvider({ id: 'cloud', tier: 'cloud', text: 'cloud meaning' });
  const router = new ExplanationRouter([local, cloud]);

  const outcome = await router.explainWithFallback(makeRequest());
  assert(outcome.providerId === 'local', `prefers the first usable provider in priority order, got ${outcome.providerId}`);
  assert(cloud.calls === 0, 'does not call a lower-priority provider when a higher one succeeds');
}

// Low confidence: router keeps looking instead of accepting a weak result, when something better exists
{
  const weak = new FakeExplanationProvider({ id: 'weak', confidence: 0.3, text: 'weak meaning' });
  const strong = new FakeExplanationProvider({ id: 'strong', tier: 'cloud', text: 'strong meaning' }); // no confidence set -> accepted immediately, same as CloudTranslationProvider/CloudResponseProvider
  const router = new ExplanationRouter([weak, strong]);

  const outcome = await router.explainWithFallback(makeRequest());
  assert(outcome.providerId === 'strong', `continues past a low-confidence result to the next provider, got ${outcome.providerId}`);
  assert(weak.calls === 1 && strong.calls === 1, 'both providers were actually tried');
}

// Best-partial-fallback: when NOTHING clears the confidence bar (e.g. no
// cloud key configured, same as this real sandbox), the router returns the
// low-confidence result instead of throwing — this is the real behavior
// LocalExplanationProvider depends on to ever produce output at all.
{
  const onlyWeak = new FakeExplanationProvider({ id: 'local-explanation', confidence: 0.3, text: 'partial meaning' });
  const router = new ExplanationRouter([onlyWeak]);

  const outcome = await router.explainWithFallback(makeRequest());
  assert(outcome.providerId === 'local-explanation', `falls back to the best low-confidence result rather than throwing when nothing better is available, got ${outcome.providerId}`);
  assert(outcome.result.simpleMeaning === 'partial meaning', 'the returned partial result is the real (if low-confidence) one, not a fabricated substitute');
}

// All fail/unavailable -> throws with details
{
  const unavailable = new FakeExplanationProvider({ id: 'a', available: false });
  const failing = new FakeExplanationProvider({ id: 'b', tier: 'cloud', shouldFail: true });
  const router = new ExplanationRouter([unavailable, failing]);

  let threw = false;
  try {
    await router.explainWithFallback(makeRequest());
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes('a') && error.message.includes('b'), 'error names every attempted provider');
  }
  assert(threw, 'throws when every provider is unavailable or fails with no partial result available');
}

// --- Phase 11: CostGate wiring ---
{
  const economyGate = { mode: 'economy' as const, isPaidTierAllowed: () => false, localAcceptanceThreshold: (base: number) => Math.max(0.3, base - 0.2), isCachingEnabled: () => false };
  const local = new FakeExplanationProvider({ id: 'local', confidence: 0.45, text: 'local weak meaning' });
  const cloud = new FakeExplanationProvider({ id: 'cloud', tier: 'cloud', requiresApiKey: true, text: 'cloud meaning' });
  const router = new ExplanationRouter([local, cloud], 0.6, economyGate);

  const outcome = await router.explainWithFallback(makeRequest());
  assert(cloud.calls === 0, 'economy mode never attempts the paid (requiresApiKey) provider');
  assert(outcome.providerId === 'local', `economy mode accepts the local result (lowered threshold) instead of throwing, got ${outcome.providerId}`);
}

{
  const qualityGate = { mode: 'quality' as const, isPaidTierAllowed: () => true, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => false };
  const local = new FakeExplanationProvider({ id: 'local', confidence: 0.7, text: 'local ok meaning' });
  const cloud = new FakeExplanationProvider({ id: 'cloud', tier: 'cloud', requiresApiKey: true, confidence: 0.9, text: 'cloud better meaning' });
  const router = new ExplanationRouter([local, cloud], 0.6, qualityGate);

  const outcome = await router.explainWithFallback(makeRequest());
  assert(local.calls === 1 && cloud.calls === 1, 'quality mode does not stop at the first accepted result — both providers are tried');
  assert(outcome.providerId === 'cloud', `quality mode picks the higher-confidence result over the first-found, got ${outcome.providerId}`);
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
