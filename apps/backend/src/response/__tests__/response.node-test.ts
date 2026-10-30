/**
 * Plain-Node smoke test for Phase 6's pure-logic response core:
 * ResponseStyleEngine's style-instruction completeness,
 * LocalResponsePhrasebookProvider's real coverage-based confidence, and
 * ResponseRouter's style-filtering + priority + low-confidence-continues
 * behavior — all against fake provider stubs, no real network call needed.
 * ProviderHealth and glossary protect/restore are already covered by
 * translation.node-test.ts (both moved to @kvl/shared, unchanged) — not
 * re-tested here. Run with `pnpm --filter @kvl/backend test:response-core`.
 */
import type { ResponseStyle } from '@kvl/shared';
import type {
  ResponseProvider,
  ResponseProviderCapabilities,
  ResponseProviderStatus,
  ResponseProviderTier,
  ResponseRequest,
  ResponseResult,
} from '@kvl/response';
import { ALL_RESPONSE_STYLES, STYLE_INSTRUCTIONS, RESPONSE_STYLE_LABELS } from '../ResponseStyleEngine';
import { LocalResponsePhrasebookProvider } from '../providers/LocalResponsePhrasebookProvider';
import { ResponseRouter, type ResponseRouterResult } from '../ResponseRouter';
import { RequestCache } from '../../cost/RequestCache';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// --- ResponseStyleEngine: every style has a real prompt fragment and label ---
{
  for (const style of ALL_RESPONSE_STYLES) {
    assert(typeof STYLE_INSTRUCTIONS[style] === 'string' && STYLE_INSTRUCTIONS[style].length > 10, `style '${style}' has a real instruction fragment`);
    assert(typeof RESPONSE_STYLE_LABELS[style] === 'string' && RESPONSE_STYLE_LABELS[style].length > 0, `style '${style}' has a real label`);
  }
  assert(ALL_RESPONSE_STYLES.length === 7, `all 7 styles from the spec are present, got ${ALL_RESPONSE_STYLES.length}`);
}

// --- LocalResponsePhrasebookProvider: real coverage-based output, matches the spec's worked example ---
{
  const provider = new LocalResponsePhrasebookProvider();
  await provider.start({});

  const worked = await provider.generate({ text: 'Hum Friday tak complete kar denge', style: 'professional' });
  assert(worked.englishText.toLowerCase() === 'we will complete it by friday', `matches the spec's own worked example, got "${worked.englishText}"`);
  assert((worked.confidence ?? 0) > 0.9, `full phrase-match yields high confidence, got ${worked.confidence}`);

  const lowCoverage = await provider.generate({ text: 'yeh architecture completely unfamiliar naya paradigm shift hai', style: 'professional' });
  assert((lowCoverage.confidence ?? 1) < 0.6, `mostly-uncovered input yields low confidence, got ${lowCoverage.confidence}`);

  const caps = provider.getCapabilities();
  assert(caps.supportedStyles.length === 1 && caps.supportedStyles[0] === 'professional', 'local phrasebook only claims the professional style — it cannot genuinely restyle');
}

// --- ResponseRouter: style filtering, priority order, low-confidence continues ---
function makeCapabilities(overrides: Partial<ResponseProviderCapabilities> & { id: string }): ResponseProviderCapabilities {
  return {
    displayName: overrides.id,
    available: true,
    offline: false,
    requiresApiKey: false,
    tier: 'local',
    supportedStyles: ['professional'],
    ...overrides,
  };
}

class FakeResponseProvider implements ResponseProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: ResponseProviderTier;
  private status: ResponseProviderStatus = 'ready';
  calls = 0;

  constructor(
    private readonly opts: {
      id: string;
      tier?: ResponseProviderTier;
      available?: boolean;
      supportedStyles?: ResponseStyle[];
      shouldFail?: boolean;
      confidence?: number;
      text?: string;
      requiresApiKey?: boolean;
    },
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
  async generate(request: ResponseRequest): Promise<ResponseResult> {
    this.calls += 1;
    if (this.opts.shouldFail) throw new Error(`${this.id} simulated failure`);
    return {
      englishText: this.opts.text ?? `[${this.id}] ${request.text}`,
      confidence: this.opts.confidence,
    };
  }
  getStatus(): ResponseProviderStatus {
    return this.status;
  }
  getCapabilities(): ResponseProviderCapabilities {
    return makeCapabilities({
      id: this.id,
      tier: this.opts.tier,
      available: this.opts.available ?? true,
      supportedStyles: this.opts.supportedStyles ?? ['professional'],
      requiresApiKey: this.opts.requiresApiKey ?? false,
    });
  }
}

function makeRequest(overrides: Partial<ResponseRequest> = {}): ResponseRequest {
  return { text: 'Humne deployment kal kiya tha lekin testing ke wajah se thoda delay ho gaya.', style: 'professional', ...overrides };
}

// Priority: first available+supported+usable provider wins
{
  const local = new FakeResponseProvider({ id: 'local', text: 'local result' });
  const cloud = new FakeResponseProvider({ id: 'cloud', tier: 'paid', text: 'cloud result' });
  const router = new ResponseRouter([local, cloud]);

  const outcome = await router.generateWithFallback(makeRequest());
  assert(outcome.providerId === 'local', `prefers the first usable provider in priority order, got ${outcome.providerId}`);
  assert(cloud.calls === 0, 'does not call a lower-priority provider when a higher one succeeds');
}

// Style filtering: provider that doesn't support the requested style is skipped
{
  const literal = new FakeResponseProvider({ id: 'literal', supportedStyles: ['professional'] });
  const llm = new FakeResponseProvider({ id: 'llm', tier: 'paid', supportedStyles: ALL_RESPONSE_STYLES, text: 'llm result' });
  const router = new ResponseRouter([literal, llm]);

  const outcome = await router.generateWithFallback(makeRequest({ style: 'client-friendly' }));
  assert(outcome.providerId === 'llm', `skips a provider that does not support the requested style, got ${outcome.providerId}`);
  assert(literal.calls === 0, 'never calls generate() on a style-unsupported provider');
}

// Low confidence: router keeps looking instead of accepting a weak result
{
  const weak = new FakeResponseProvider({ id: 'weak', confidence: 0.2, text: 'weak result' });
  const strong = new FakeResponseProvider({ id: 'strong', tier: 'paid', confidence: 0.95, text: 'strong result' });
  const router = new ResponseRouter([weak, strong]);

  const outcome = await router.generateWithFallback(makeRequest());
  assert(outcome.providerId === 'strong', `continues past a low-confidence result to the next provider, got ${outcome.providerId}`);
  assert(weak.calls === 1 && strong.calls === 1, 'both providers were actually tried');
}

// Glossary integration: protected term round-trips through the router end-to-end
{
  const passthrough = new FakeResponseProvider({ id: 'echo' });
  passthrough.generate = async (request: ResponseRequest) => ({ englishText: `translated: ${request.text}` });
  const router = new ResponseRouter([passthrough]);

  const outcome = await router.generateWithFallback(makeRequest({ text: 'Please review the API before the deployment.' }));
  assert(outcome.result.englishText.includes('API') && outcome.result.englishText.includes('deployment'), `glossary terms survive the round trip through the router, got "${outcome.result.englishText}"`);
}

// All fail/unavailable -> throws with details
{
  const unavailable = new FakeResponseProvider({ id: 'a', available: false });
  const failing = new FakeResponseProvider({ id: 'b', tier: 'paid', shouldFail: true });
  const router = new ResponseRouter([unavailable, failing]);

  let threw = false;
  try {
    await router.generateWithFallback(makeRequest());
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes('a') && error.message.includes('b'), 'error names every attempted provider');
  }
  assert(threw, 'throws when every provider is unavailable or fails');
}

// --- Phase 11: CostGate wiring (mirrors translation.node-test.ts) ---
{
  const economyGate = { mode: 'economy' as const, isPaidTierAllowed: () => false, localAcceptanceThreshold: (base: number) => Math.max(0.3, base - 0.2), isCachingEnabled: () => false };
  const local = new FakeResponseProvider({ id: 'local', confidence: 0.45, text: 'local weak result' });
  const cloud = new FakeResponseProvider({ id: 'cloud', tier: 'paid', requiresApiKey: true, confidence: 0.95, text: 'cloud result' });
  const router = new ResponseRouter([local, cloud], 0.6, economyGate);

  const outcome = await router.generateWithFallback(makeRequest());
  assert(cloud.calls === 0, 'economy mode never attempts the paid (requiresApiKey) provider');
  assert(outcome.providerId === 'local', `economy mode still returns the local result instead of throwing, got ${outcome.providerId}`);
}

{
  const qualityGate = { mode: 'quality' as const, isPaidTierAllowed: () => true, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => false };
  const local = new FakeResponseProvider({ id: 'local', confidence: 0.7, text: 'local ok result' });
  const cloud = new FakeResponseProvider({ id: 'cloud', tier: 'paid', requiresApiKey: true, confidence: 0.9, text: 'cloud better result' });
  const router = new ResponseRouter([local, cloud], 0.6, qualityGate);

  const outcome = await router.generateWithFallback(makeRequest());
  assert(local.calls === 1 && cloud.calls === 1, 'quality mode does not stop at the first accepted result — both providers are tried');
  assert(outcome.providerId === 'cloud', `quality mode picks the higher-confidence result over the first-found, got ${outcome.providerId}`);
}

{
  const cachingGate = { mode: 'balanced' as const, isPaidTierAllowed: () => true, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => true };
  const provider = new FakeResponseProvider({ id: 'local', text: 'cached result' });
  const cache = new RequestCache<ResponseRouterResult>();
  const router = new ResponseRouter([provider], 0.6, cachingGate, cache);

  await router.generateWithFallback(makeRequest());
  const second = await router.generateWithFallback(makeRequest());
  assert(provider.calls === 1, 'a repeated identical (text, style) request is served from cache — the provider is not called again');
  assert(second.cacheHit === true, 'the cached result is flagged cacheHit');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
