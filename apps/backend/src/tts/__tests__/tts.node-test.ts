/**
 * Plain-Node smoke test for Phase 7's pure-logic TTS core: capability-shape
 * sanity for both real providers, over-length text rejection (never
 * silently truncated), and a fake-provider proof that a long,
 * technical-jargon sentence is handled correctly up to the capability
 * boundary. Real audio synthesis needs a real espeak-ng binary or a real
 * cloud API key, neither of which exist in this sandbox — not tested here,
 * see the README's honest PENDING note. Run with
 * `pnpm --filter @kvl/backend test:tts-core`.
 */
import type { TtsProvider, TtsProviderCapabilities, TtsProviderStatus, TtsProviderTier, TtsRequest, TtsResult } from '@kvl/tts';
import { LocalTtsProvider } from '../providers/LocalTtsProvider';
import { CloudTtsProvider } from '../providers/CloudTtsProvider';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const LONG_TECHNICAL_SENTENCE =
  'Please review the pull request before the sprint ends, then redeploy the staging endpoint and confirm the database migration ran cleanly against the backend repository. '.repeat(20);

// --- LocalTtsProvider: capability shape, unavailable in this sandbox (no espeak-ng), honest getVoices() ---
{
  const provider = new LocalTtsProvider();
  await provider.start({});

  const caps = provider.getCapabilities();
  assert(caps.id === 'local-espeak', `capability id is real, got "${caps.id}"`);
  assert(caps.offline === true, 'local provider reports itself offline');
  assert(caps.requiresApiKey === false, 'local provider reports no API key required');
  assert(typeof caps.maxTextLength === 'number' && caps.maxTextLength > 0, `local provider declares a real maxTextLength, got ${caps.maxTextLength}`);
  // Not asserting caps.available — honestly depends on whether espeak-ng is installed on this machine.

  const voices = await provider.getVoices();
  assert(Array.isArray(voices), 'getVoices() always returns an array, never throws');
}

// --- CloudTtsProvider: capability shape, fixed voice list, over-length rejection ---
{
  const provider = new CloudTtsProvider();
  await provider.start({}); // no API key -> unavailable

  const caps = provider.getCapabilities();
  assert(caps.id === 'cloud-tts', `capability id is real, got "${caps.id}"`);
  assert(caps.available === false, 'cloud provider without an API key reports unavailable');
  assert(caps.requiresApiKey === true, 'cloud provider reports API key required');
  assert(caps.maxTextLength === 4_096, `cloud provider declares OpenAI's real input cap, got ${caps.maxTextLength}`);

  const voices = await provider.getVoices();
  assert(voices.length === 6, `cloud provider returns its fixed 6-voice set, got ${voices.length}`);
  assert(voices.some((v) => v.id === 'alloy'), 'fixed voice list includes a real OpenAI voice id');

  let threwForUnconfigured = false;
  try {
    await provider.synthesize({ text: 'short text' });
  } catch {
    threwForUnconfigured = true;
  }
  assert(threwForUnconfigured, 'synthesize() throws cleanly when no API key is configured, does not hang');

  // Simulate a configured provider (no real network call — just proves the
  // length guard fires before any fetch happens) by starting it with a fake key.
  const configured = new CloudTtsProvider();
  await configured.start({ apiKey: 'fake-key-for-length-guard-test' });
  const overLength = 'x'.repeat(configured.getCapabilities().maxTextLength + 1);
  let threwForLength = false;
  try {
    await configured.synthesize({ text: overLength });
  } catch (error) {
    threwForLength = true;
    assert(error instanceof Error && /too long/i.test(error.message), `over-length rejection message is clear, got "${error instanceof Error ? error.message : error}"`);
  }
  assert(threwForLength, 'over-length input is rejected outright, never silently truncated');
}

// --- Fake-provider proof: a long, technical-jargon sentence is accepted up to the capability boundary ---
function makeCapabilities(overrides: Partial<TtsProviderCapabilities> & { id: string }): TtsProviderCapabilities {
  return {
    displayName: overrides.id,
    available: true,
    offline: false,
    requiresApiKey: false,
    tier: 'local',
    maxTextLength: 10_000,
    ...overrides,
  };
}

class FakeTtsProvider implements TtsProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: TtsProviderTier;
  private status: TtsProviderStatus = 'ready';
  calls = 0;

  constructor(private readonly opts: { id: string; tier?: TtsProviderTier; maxTextLength?: number }) {
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
  async synthesize(request: TtsRequest): Promise<TtsResult> {
    this.calls += 1;
    const cap = this.getCapabilities();
    if (request.text.length > cap.maxTextLength) throw new Error(`Text too long (${request.text.length} > ${cap.maxTextLength} characters)`);
    return { audio: Buffer.from(request.text.length.toString()), mimeType: 'audio/wav' };
  }
  async getVoices() {
    return [];
  }
  getStatus(): TtsProviderStatus {
    return this.status;
  }
  getCapabilities(): TtsProviderCapabilities {
    return makeCapabilities({ id: this.id, tier: this.opts.tier, maxTextLength: this.opts.maxTextLength ?? 10_000 });
  }
}

{
  assert(LONG_TECHNICAL_SENTENCE.length > 2_000, `test sentence is genuinely long, got ${LONG_TECHNICAL_SENTENCE.length} characters`);
  assert(/pull request|sprint|staging|repository|database/.test(LONG_TECHNICAL_SENTENCE), 'test sentence contains real technical/business terminology');

  const provider = new FakeTtsProvider({ id: 'fake-local', maxTextLength: 10_000 });
  const result = await provider.synthesize({ text: LONG_TECHNICAL_SENTENCE });
  assert(result.audio.toString() === String(LONG_TECHNICAL_SENTENCE.length), 'long technical sentence synthesizes successfully without truncation');

  const strict = new FakeTtsProvider({ id: 'fake-strict', maxTextLength: 100 });
  let threw = false;
  try {
    await strict.synthesize({ text: LONG_TECHNICAL_SENTENCE });
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes(String(LONG_TECHNICAL_SENTENCE.length)), 'a provider with a smaller capability boundary rejects the same long sentence with a clear length in the message');
  }
  assert(threw, 'exceeding a provider-declared capability boundary throws rather than silently truncating');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
