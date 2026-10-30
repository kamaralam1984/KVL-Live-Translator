/**
 * Plain-Node smoke test for SpeechProviderRouter's fallback ordering and
 * TranscriptBuffer's sort-on-insert, using fake provider stubs — no real
 * whisper.cpp binary or network call needed. Run with
 * `pnpm --filter @kvl/backend test:speech-core`.
 */
import type { SpeechInputChunk, SpeechProvider, SpeechProviderCapabilities, SpeechProviderStatus } from '@kvl/speech';
import type { TranscriptSegment } from '@kvl/shared';
import { SpeechProviderRouter } from '../SpeechProviderRouter';
import { TranscriptBuffer } from '../TranscriptBuffer';
import { pcm16ToWav } from '../wavEncoder';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function makeChunk(overrides: Partial<SpeechInputChunk> = {}): SpeechInputChunk {
  return {
    sessionId: 'test-session',
    chunkId: 'chunk-1',
    sequenceNumber: 1,
    timestampMs: 0,
    durationMs: 1000,
    sampleRateHz: 16000,
    channelCount: 1,
    audio: Buffer.alloc(320),
    ...overrides,
  };
}

class FakeProvider implements SpeechProvider {
  readonly id: string;
  readonly displayName: string;
  private status: SpeechProviderStatus = 'ready';
  private readonly available: boolean;
  private readonly shouldFail: boolean;
  private readonly text: string;
  calls = 0;

  constructor(opts: { id: string; available?: boolean; shouldFail?: boolean; text?: string }) {
    this.id = opts.id;
    this.displayName = opts.id;
    this.available = opts.available ?? true;
    this.shouldFail = opts.shouldFail ?? false;
    this.text = opts.text ?? `transcribed by ${opts.id}`;
  }

  async start(): Promise<void> {
    this.status = 'ready';
  }
  async stop(): Promise<void> {
    this.status = 'unavailable';
  }
  async transcribe() {
    this.calls += 1;
    if (this.shouldFail) throw new Error(`${this.id} simulated failure`);
    return { text: this.text, languageCode: 'en', confidence: 0.9, isFinal: true };
  }
  getStatus(): SpeechProviderStatus {
    return this.status;
  }
  getCapabilities(): SpeechProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      streaming: false,
      offline: this.id === 'local',
      supportedLanguages: ['auto'],
      requiresApiKey: this.id !== 'local',
    };
  }
}

// --- Test 1: local unavailable -> falls through to cloud, cloud succeeds ---
{
  const local = new FakeProvider({ id: 'local', available: false });
  const cloud = new FakeProvider({ id: 'cloud', text: 'hello from cloud' });
  const router = new SpeechProviderRouter([local, cloud]);

  const outcome = await router.transcribeWithFallback(makeChunk());
  assert(outcome.providerId === 'cloud', `falls through unavailable local to cloud, got ${outcome.providerId}`);
  assert(outcome.result.text === 'hello from cloud', 'returns the succeeding provider\'s result');
  assert(outcome.attempts.length === 2, `records both attempts, got ${outcome.attempts.length}`);
  assert(local.calls === 0, 'never calls transcribe() on an unavailable provider');
  assert(cloud.calls === 1, 'calls transcribe() exactly once on the provider that succeeds');
}

// --- Test 2: local available but fails -> falls through to cloud ---
{
  const local = new FakeProvider({ id: 'local', shouldFail: true });
  const cloud = new FakeProvider({ id: 'cloud' });
  const router = new SpeechProviderRouter([local, cloud]);

  const outcome = await router.transcribeWithFallback(makeChunk());
  assert(outcome.providerId === 'cloud', `falls through failing local to cloud, got ${outcome.providerId}`);
  assert(local.calls === 1 && cloud.calls === 1, 'tries local (fails) then cloud (succeeds)');
}

// --- Test 3: local succeeds -> cloud never tried ---
{
  const local = new FakeProvider({ id: 'local' });
  const cloud = new FakeProvider({ id: 'cloud' });
  const router = new SpeechProviderRouter([local, cloud]);

  const outcome = await router.transcribeWithFallback(makeChunk());
  assert(outcome.providerId === 'local', 'prefers the first available/succeeding provider');
  assert(cloud.calls === 0, 'does not call a fallback provider when the primary succeeds');
}

// --- Test 4: all providers fail/unavailable -> throws with details ---
{
  const local = new FakeProvider({ id: 'local', available: false });
  const cloud = new FakeProvider({ id: 'cloud', shouldFail: true });
  const router = new SpeechProviderRouter([local, cloud]);

  let threw = false;
  try {
    await router.transcribeWithFallback(makeChunk());
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes('local') && error.message.includes('cloud'), 'error message names every failed provider');
  }
  assert(threw, 'throws when every provider is unavailable or fails');
}

// --- Test 5: TranscriptBuffer sorts out-of-order arrivals by startMs ---
{
  const buffer = new TranscriptBuffer();
  const seg = (id: string, startMs: number): TranscriptSegment => ({
    id,
    sessionId: 'sess-1',
    text: id,
    isFinal: true,
    startMs,
    endMs: startMs + 500,
  });

  buffer.insert(seg('third', 4000));
  buffer.insert(seg('first', 0));
  buffer.insert(seg('second', 2000));

  const ordered = buffer.getSegments('sess-1').map((s) => s.id);
  assert(ordered.join(',') === 'first,second,third', `sorts by startMs regardless of insertion order, got ${ordered.join(',')}`);

  buffer.clearSession('sess-1');
  assert(buffer.getSegments('sess-1').length === 0, 'clearSession empties that session only');
}

// --- Test 6: wavEncoder produces a valid-looking WAV header ---
{
  const pcm = Buffer.alloc(320); // 160 samples * 2 bytes
  const wav = pcm16ToWav(pcm, { sampleRate: 16000, channels: 1, bitDepth: 16 });
  assert(wav.length === 44 + pcm.length, `header + data = ${44 + pcm.length} bytes, got ${wav.length}`);
  assert(wav.toString('ascii', 0, 4) === 'RIFF', 'starts with RIFF magic');
  assert(wav.toString('ascii', 8, 12) === 'WAVE', 'declares WAVE format');
  assert(wav.readUInt32LE(24) === 16000, 'encodes the sample rate correctly');
}

// --- Test 7 (Phase 11): economy cost mode blocks the paid (requiresApiKey) provider ---
{
  const local = new FakeProvider({ id: 'local', available: false }); // forces fallthrough attempt
  const cloud = new FakeProvider({ id: 'cloud', text: 'hello from cloud' }); // requiresApiKey: true (id !== 'local')
  const economyGate = { mode: 'economy' as const, isPaidTierAllowed: () => false, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => false };
  const router = new SpeechProviderRouter([local, cloud], economyGate);

  let threw = false;
  try {
    await router.transcribeWithFallback(makeChunk());
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes('cost-mode-blocked'), 'error names the cost-mode-blocked reason for the skipped paid provider');
  }
  assert(threw, 'throws when the only remaining provider is paid and economy mode blocks it (local unavailable here, so nothing else to fall back to)');
  assert(cloud.calls === 0, 'economy mode never actually calls transcribe() on the paid provider');
}

// --- Test 8 (Phase 11): balanced mode (default) still reaches the paid provider ---
{
  const local = new FakeProvider({ id: 'local', available: false });
  const cloud = new FakeProvider({ id: 'cloud', text: 'hello from cloud' });
  const balancedGate = { mode: 'balanced' as const, isPaidTierAllowed: () => true, localAcceptanceThreshold: (base: number) => base, isCachingEnabled: () => false };
  const router = new SpeechProviderRouter([local, cloud], balancedGate);

  const outcome = await router.transcribeWithFallback(makeChunk());
  assert(outcome.providerId === 'cloud', `balanced mode still reaches the paid provider when local is unavailable, got ${outcome.providerId}`);
  assert(cloud.calls === 1, 'the paid provider was actually called under balanced mode');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
