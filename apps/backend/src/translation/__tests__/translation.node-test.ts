/**
 * Plain-Node smoke test for Phase 4's pure-logic translation core: glossary
 * protect/restore, Devanagari transliteration, ProviderHealth's quota/
 * circuit-breaker math, and TranslationRouter's mode-filtering + priority +
 * low-confidence-continues behavior — all against fake provider stubs, no
 * real network call or NMT engine needed. Run with
 * `pnpm --filter @kvl/backend test:translation-core`.
 */
import type { TranslationMode } from '@kvl/shared';
import { ProviderHealth, protectTerms, restoreTerms } from '@kvl/shared';
import type {
  TranslationProvider,
  TranslationProviderCapabilities,
  TranslationProviderStatus,
  TranslationProviderTier,
  TranslationRequest,
  TranslationResult,
} from '@kvl/translation';
import { devanagariToRoman } from '../transliterate';
import { LocalTranslationProvider } from '../providers/LocalTranslationProvider';
import { TranslationRouter, type TranslationRouterResult } from '../TranslationRouter';
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

// --- glossary: protect/restore round trip ---
{
  const original = 'Please check the API and merge the pull request before the sprint ends.';
  const { text: protectedText, mapping } = protectTerms(original);
  assert(!/API|merge|pull request|sprint/i.test(protectedText), 'protectTerms removes glossary terms from the text');
  // API, merge, pull request, sprint are all in DEFAULT_GLOSSARY -> 4 unique terms
  assert(mapping.size === 4, `protectTerms records one mapping entry per unique protected term, got ${mapping.size}`);

  const restored = restoreTerms(protectedText, mapping);
  assert(restored === original, `restoreTerms reconstructs the original text exactly, got "${restored}"`);

  const repeated = 'API call failed. Retry the API call.';
  const protectedRepeated = protectTerms(repeated);
  assert(protectedRepeated.mapping.size === 1, 'repeated occurrences of the same term share one placeholder');
  assert(restoreTerms(protectedRepeated.text, protectedRepeated.mapping) === repeated, 'round trip holds for repeated terms too');
}

// --- transliteration: known Devanagari -> Roman ---
{
  assert(devanagariToRoman('नमस्ते') === 'namaste', `namaste transliterates correctly, got "${devanagariToRoman('नमस्ते')}"`);
  // Literal script transliteration keeps the word-final inherent vowel on द
  // (no virama/vowel-sign follows it) — "dhanyavaada", not the schwa-deleted
  // spoken-Hindi spelling "dhanyavaad". That's a phonological rule beyond
  // pure transliteration; devanagariToRoman deliberately doesn't guess at it.
  assert(devanagariToRoman('धन्यवाद') === 'dhanyavaada', `dhanyavaad(a) transliterates correctly, got "${devanagariToRoman('धन्यवाद')}"`);
  assert(devanagariToRoman('हाँ') === 'haan', `haan (with chandrabindu) transliterates correctly, got "${devanagariToRoman('हाँ')}"`);
  assert(devanagariToRoman('English text stays as-is.') === 'English text stays as-is.', 'non-Devanagari text passes through unchanged');
  assert(devanagariToRoman('१२३') === '123', 'Devanagari digits convert to ASCII digits');
}

// --- LocalTranslationProvider: real Devanagari output, hinglish transliteration actually changes it ---
{
  const provider = new LocalTranslationProvider();
  await provider.start({});

  const hindiResult = await provider.translate({ text: 'thank you', sourceLang: 'en', targetLang: 'hi', mode: 'hindi' });
  assert(hindiResult.translatedText === 'धन्यवाद', `'hindi' mode returns real Devanagari, got "${hindiResult.translatedText}"`);
  assert(/[ऀ-ॿ]/.test(hindiResult.translatedText), 'hindi-mode output actually contains Devanagari characters');

  const hinglishResult = await provider.translate({ text: 'thank you', sourceLang: 'en', targetLang: 'hi', mode: 'hinglish' });
  assert(hinglishResult.translatedText === 'dhanyavaada', `'hinglish' mode transliterates to Roman script, got "${hinglishResult.translatedText}"`);
  assert(!/[ऀ-ॿ]/.test(hinglishResult.translatedText), 'hinglish-mode output contains no leftover Devanagari — proves the dictionary bug (Roman values that transliteration silently no-op\'d on) is fixed');

  const highCoverage = await provider.translate({ text: 'yes please', sourceLang: 'en', targetLang: 'hi', mode: 'hindi' });
  assert((highCoverage.confidence ?? 0) > 0.9, `full dictionary coverage yields high confidence, got ${highCoverage.confidence}`);

  const lowCoverage = await provider.translate({ text: 'the deployment architecture requires careful consideration', sourceLang: 'en', targetLang: 'hi', mode: 'hindi' });
  assert((lowCoverage.confidence ?? 1) < 0.6, `mostly-uncovered input yields low confidence, got ${lowCoverage.confidence}`);
}

// --- ProviderHealth: quota + circuit breaker, deterministic via explicit `now` ---
{
  const health = new ProviderHealth({ maxRequestsPerMinute: 3, maxConsecutiveErrors: 2, rateLimitCooldownMs: 5000, circuitCooldownMs: 10000 });
  const t0 = 1_000_000;

  assert(health.canAttempt(t0), 'fresh ProviderHealth allows an attempt');
  health.recordAttempt(t0);
  health.recordAttempt(t0 + 100);
  health.recordAttempt(t0 + 200);
  assert(!health.canAttempt(t0 + 300), 'quota of 3/min is enforced — 4th attempt within the window is blocked');
  assert(health.canAttempt(t0 + 61_000), 'quota window rolls off after 60s');

  const health2 = new ProviderHealth({ maxConsecutiveErrors: 2, circuitCooldownMs: 10_000 });
  health2.recordError({}, t0);
  assert(health2.canAttempt(t0 + 1), 'circuit stays closed after one error (below threshold)');
  health2.recordError({}, t0 + 1);
  assert(!health2.canAttempt(t0 + 2), 'circuit opens after reaching maxConsecutiveErrors');
  assert(health2.canAttempt(t0 + 2 + 10_001), 'circuit closes again after circuitCooldownMs elapses');

  const health3 = new ProviderHealth({ rateLimitCooldownMs: 5000 });
  health3.recordError({ isRateLimit: true }, t0);
  assert(!health3.canAttempt(t0 + 1), 'rate-limit error blocks attempts during the cooldown');
  assert(health3.canAttempt(t0 + 5001), 'rate-limit cooldown expires');
}

// --- TranslationRouter: mode filtering, priority order, low-confidence continues ---
function makeCapabilities(overrides: Partial<TranslationProviderCapabilities> & { id: string }): TranslationProviderCapabilities {
  return {
    displayName: overrides.id,
    available: true,
    offline: false,
    requiresApiKey: false,
    tier: 'local',
    supportedModes: ['hindi', 'hinglish'],
    ...overrides,
  };
}

class FakeTranslationProvider implements TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: TranslationProviderTier;
  private status: TranslationProviderStatus = 'ready';
  calls = 0;

  constructor(
    private readonly opts: {
      id: string;
      tier?: TranslationProviderTier;
      available?: boolean;
      supportedModes?: TranslationMode[];
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
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.calls += 1;
    if (this.opts.shouldFail) throw new Error(`${this.id} simulated failure`);
    return {
      translatedText: this.opts.text ?? `[${this.id}] ${request.text}`,
      confidence: this.opts.confidence,
    };
  }
  getStatus(): TranslationProviderStatus {
    return this.status;
  }
  getCapabilities(): TranslationProviderCapabilities {
    return makeCapabilities({
      id: this.id,
      tier: this.opts.tier,
      available: this.opts.available ?? true,
      supportedModes: this.opts.supportedModes ?? ['hindi', 'hinglish'],
      requiresApiKey: this.opts.requiresApiKey ?? false,
    });
  }
}

function makeRequest(overrides: Partial<TranslationRequest> = {}): TranslationRequest {
  return { text: 'Hello, can we discuss the deployment?', sourceLang: 'en', targetLang: 'hi', mode: 'hindi', ...overrides };
}

// Priority: first available+supported+usable provider wins
{
  const local = new FakeTranslationProvider({ id: 'local', text: 'local result' });
  const cloud = new FakeTranslationProvider({ id: 'cloud', tier: 'paid', text: 'cloud result' });
  const router = new TranslationRouter([local, cloud]);

  const outcome = await router.translateWithFallback(makeRequest());
  assert(outcome.providerId === 'local', `prefers the first usable provider in priority order, got ${outcome.providerId}`);
  assert(cloud.calls === 0, 'does not call a lower-priority provider when a higher one succeeds');
}

// Mode filtering: provider that doesn't support the requested mode is skipped
{
  const nmt = new FakeTranslationProvider({ id: 'nmt', supportedModes: ['hindi'] });
  const llm = new FakeTranslationProvider({ id: 'llm', tier: 'paid', supportedModes: ['hindi', 'hinglish', 'simple-hindi', 'simple-english'], text: 'llm result' });
  const router = new TranslationRouter([nmt, llm]);

  const outcome = await router.translateWithFallback(makeRequest({ mode: 'simple-english' }));
  assert(outcome.providerId === 'llm', `skips a provider that does not support the requested mode, got ${outcome.providerId}`);
  assert(nmt.calls === 0, 'never calls translate() on a mode-unsupported provider');
}

// Low confidence: router keeps looking instead of accepting a weak result
{
  const weak = new FakeTranslationProvider({ id: 'weak', confidence: 0.2, text: 'weak result' });
  const strong = new FakeTranslationProvider({ id: 'strong', tier: 'paid', confidence: 0.95, text: 'strong result' });
  const router = new TranslationRouter([weak, strong]);

  const outcome = await router.translateWithFallback(makeRequest());
  assert(outcome.providerId === 'strong', `continues past a low-confidence result to the next provider, got ${outcome.providerId}`);
  assert(weak.calls === 1 && strong.calls === 1, 'both providers were actually tried');
}

// Glossary integration: protected term round-trips through the router end-to-end
{
  const passthrough = new FakeTranslationProvider({ id: 'echo' });
  passthrough.translate = async (request: TranslationRequest) => ({ translatedText: `translated: ${request.text}` });
  const router = new TranslationRouter([passthrough]);

  const outcome = await router.translateWithFallback(makeRequest({ text: 'Please review the API before the sprint.' }));
  assert(outcome.result.translatedText.includes('API') && outcome.result.translatedText.includes('sprint'), `glossary terms survive the round trip through the router, got "${outcome.result.translatedText}"`);
}

// All fail/unavailable -> throws with details
{
  const unavailable = new FakeTranslationProvider({ id: 'a', available: false });
  const failing = new FakeTranslationProvider({ id: 'b', tier: 'paid', shouldFail: true });
  const router = new TranslationRouter([unavailable, failing]);

  let threw = false;
  try {
    await router.translateWithFallback(makeRequest());
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes('a') && error.message.includes('b'), 'error names every attempted provider');
  }
  assert(threw, 'throws when every provider is unavailable or fails');
}

// --- Phase 11: CostGate wiring ---
{
  const economyGate = { mode: 'economy' as const, isPaidTierAllowed: () => false, localAcceptanceThreshold: (base: number) => Math.max(0.3, base - 0.2), isCachingEnabled: () => false };
  const local = new FakeTranslationProvider({ id: 'local', confidence: 0.45, text: 'local weak result' });
  const cloud = new FakeTranslationProvider({ id: 'cloud', tier: 'paid', requiresApiKey: true, confidence: 0.95, text: 'cloud result' });
  const router = new TranslationRouter([local, cloud], 0.6, economyGate);

  const outcome = await router.translateWithFallback(makeRequest());
  assert(cloud.calls === 0, 'economy mode never attempts the paid (requiresApiKey) provider');
  assert(outcome.providerId === 'local', `economy mode still returns the local result instead of throwing, got ${outcome.providerId}`);
  assert(outcome.result.translatedText === 'local weak result', 'economy mode accepts the local result even though 0.45 is below the base 0.6 threshold — never silently fails');
}

{
  const qualityGate = { mode: 'quality' as const, isPaidTierAllowed: () => true, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => false };
  const local = new FakeTranslationProvider({ id: 'local', confidence: 0.7, text: 'local ok result' });
  const cloud = new FakeTranslationProvider({ id: 'cloud', tier: 'paid', requiresApiKey: true, confidence: 0.9, text: 'cloud better result' });
  const router = new TranslationRouter([local, cloud], 0.6, qualityGate);

  const outcome = await router.translateWithFallback(makeRequest());
  assert(local.calls === 1 && cloud.calls === 1, 'quality mode does not stop at the first accepted result — both providers are tried');
  assert(outcome.providerId === 'cloud', `quality mode picks the higher-confidence result (cloud, 0.9) over the first-found (local, 0.7), got ${outcome.providerId}`);
}

{
  const balancedGate = { mode: 'balanced' as const, isPaidTierAllowed: () => true, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => false };
  const local = new FakeTranslationProvider({ id: 'local', confidence: 0.7, text: 'local ok result' });
  const cloud = new FakeTranslationProvider({ id: 'cloud', tier: 'paid', requiresApiKey: true, confidence: 0.9, text: 'cloud better result' });
  const router = new TranslationRouter([local, cloud], 0.6, balancedGate);

  const outcome = await router.translateWithFallback(makeRequest());
  assert(cloud.calls === 0, 'balanced mode (unlike quality) stops at the first accepted result — identical to pre-Phase-11 behavior');
  assert(outcome.providerId === 'local', `balanced mode returns the first accepted result, got ${outcome.providerId}`);
}

{
  // Cache: second identical request never touches a provider at all
  const cachingGate = { mode: 'balanced' as const, isPaidTierAllowed: () => true, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => true };
  const provider = new FakeTranslationProvider({ id: 'local', text: 'cached result' });
  const cache = new RequestCache<TranslationRouterResult>();
  const router = new TranslationRouter([provider], 0.6, cachingGate, cache);

  await router.translateWithFallback(makeRequest());
  assert(provider.calls === 1, 'first call actually invokes the provider');
  const second = await router.translateWithFallback(makeRequest());
  assert(provider.calls === 1, 'a repeated identical (text, mode) request is served from cache — the provider is not called again');
  assert(second.cacheHit === true, 'the cached result is flagged cacheHit so the Manager skips recording usage for it');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
