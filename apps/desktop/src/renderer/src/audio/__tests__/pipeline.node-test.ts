/**
 * Plain-Node smoke test for the DOM-free half of the audio engine
 * (AudioBuffer, VoiceActivityDetector, MockSignalGenerator,
 * AudioChunkProcessor, MicRetryPolicy). Run with `pnpm --filter @kvl/desktop test:audio-core`.
 * Everything touching getUserMedia/getDisplayMedia/AudioWorklet can't run
 * here — it's covered by typecheck + build + manual verification instead.
 */
import { MockSignalGenerator, DEFAULT_MOCK_PATTERN } from '../MockAudioSource';
import { AudioChunkProcessor } from '../AudioChunkProcessor';
import { AudioBuffer } from '../AudioBuffer';
import { VoiceActivityDetector } from '../VoiceActivityDetector';
import { audioEventBus } from '../eventBus';
import { FRAME_DURATION_MS } from '../AudioFormat';
import { MicRetryPolicy, MIC_RETRY_DELAYS_MS } from '../MicRetryPolicy';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// --- Test 1: AudioBuffer bounded growth + backpressure ---
{
  let overflowCount = 0;
  const buf = new AudioBuffer({ maxDurationMs: 200, frameDurationMs: 20, onOverflow: () => (overflowCount += 1) });
  for (let i = 0; i < 30; i += 1) {
    buf.push({ timestamp: i * 20, samples: new Float32Array(4), rms: 0 });
  }
  assert(buf.frameCount === 10, `AudioBuffer caps at 10 frames (maxDurationMs/frameDurationMs), got ${buf.frameCount}`);
  assert(overflowCount === 20, `AudioBuffer reports overflow for each dropped frame, got ${overflowCount}`);
  assert(buf.bufferedDurationMs === 200, `AudioBuffer bufferedDurationMs === 200, got ${buf.bufferedDurationMs}`);
  const drained = buf.drain();
  assert(drained.length === 10 && buf.frameCount === 0, 'AudioBuffer.drain() empties the buffer');
}

// --- Test 2: VAD state transitions with hysteresis ---
{
  const vad = new VoiceActivityDetector({ sensitivity: 0.05, minSpeechDurationMs: 60, minSilenceDurationMs: 100 });
  const loud = { timestamp: 0, samples: new Float32Array(1), rms: 0.3 };
  const quiet = { timestamp: 0, samples: new Float32Array(1), rms: 0.001 };

  assert(vad.currentState === 'silence', 'VAD starts in silence');
  vad.processFrame(quiet);
  assert(vad.currentState === 'silence', 'VAD stays silent on quiet frames');

  vad.processFrame(loud);
  vad.processFrame(loud);
  const afterThreeLoud = vad.processFrame(loud);
  assert(afterThreeLoud === 'speech-start', `VAD fires speech-start after minSpeechDurationMs, got ${afterThreeLoud}`);

  const afterFourthLoud = vad.processFrame(loud);
  assert(afterFourthLoud === 'speech', `VAD settles into steady speech, got ${afterFourthLoud}`);

  vad.processFrame(quiet);
  vad.processFrame(quiet);
  vad.processFrame(quiet);
  vad.processFrame(quiet);
  const afterFiveQuiet = vad.processFrame(quiet);
  assert(afterFiveQuiet === 'speech-end', `VAD fires speech-end after minSilenceDurationMs, got ${afterFiveQuiet}`);

  const backToSilence = vad.processFrame(quiet);
  assert(backToSilence === 'silence', `VAD returns to silence after speech-end, got ${backToSilence}`);
}

// --- Test 3: MockSignalGenerator determinism ---
{
  const genA = new MockSignalGenerator([{ kind: 'tone', durationMs: 40 }, { kind: 'silence', durationMs: 40 }]);
  const genB = new MockSignalGenerator([{ kind: 'tone', durationMs: 40 }, { kind: 'silence', durationMs: 40 }]);
  let identical = true;
  for (let i = 0; i < 10; i += 1) {
    const a = genA.nextFrame();
    const b = genB.nextFrame();
    if (a.rms !== b.rms || a.timestamp !== b.timestamp) identical = false;
  }
  assert(identical, 'MockSignalGenerator produces identical output across independent instances (deterministic)');

  const toneGen = new MockSignalGenerator([{ kind: 'tone', durationMs: 40 }, { kind: 'silence', durationMs: 40 }]);
  const toneFrame = toneGen.nextFrame();
  assert(toneFrame.rms > 0.05, `Tone segment produces non-trivial RMS, got ${toneFrame.rms}`);

  for (let i = 0; i < 1; i += 1) toneGen.nextFrame(); // 2 frames total = 40ms tone consumed
  const silenceFrame = toneGen.nextFrame();
  assert(silenceFrame.rms === 0, `Silence segment produces zero RMS, got ${silenceFrame.rms}`);
}

// --- Test 4: AudioChunkProcessor end-to-end via mock generator + event bus ---
{
  const chunks: unknown[] = [];
  const unsubscribe = audioEventBus.on('chunk:ready', (payload) => chunks.push(payload));

  const processor = new AudioChunkProcessor({
    sessionId: 'test-session',
    source: 'mixed',
    vad: { sensitivity: 0.05, minSpeechDurationMs: 40, minSilenceDurationMs: 60 },
  });
  const generator = new MockSignalGenerator(DEFAULT_MOCK_PATTERN); // 2s tone, 1s silence

  const framesFor = (ms: number) => Math.round(ms / FRAME_DURATION_MS);
  for (let i = 0; i < framesFor(3200); i += 1) {
    processor.pushFrame(generator.nextFrame());
  }

  unsubscribe();
  assert(chunks.length >= 1, `AudioChunkProcessor emits at least one chunk for a 3.2s tone+silence pattern, got ${chunks.length}`);

  const first = chunks[0] as { speechDetected: boolean; sequenceNumber: number; audioData: Float32Array; format: { sampleRate: number } };
  assert(first.speechDetected === true, 'Emitted chunk is marked speechDetected=true');
  assert(first.sequenceNumber === 1, `First chunk has sequenceNumber 1, got ${first.sequenceNumber}`);
  assert(first.audioData.length > 0, 'Emitted chunk carries non-empty audio data');
  assert(first.format.sampleRate === 16000, `Chunk exported at 16kHz (downsampled from 48kHz), got ${first.format.sampleRate}`);

  const diag = processor.diagnostics;
  assert(diag.ringBufferedMs <= 10000, `Ring buffer stays bounded at <=10000ms, got ${diag.ringBufferedMs}`);
}

// --- Test 5: MicRetryPolicy — bounded same-device retry counter ---
{
  const policy = new MicRetryPolicy();
  assert(MIC_RETRY_DELAYS_MS.length === 3, `exactly 3 bounded retry attempts configured, got ${MIC_RETRY_DELAYS_MS.length}`);
  assert(!policy.exhausted, 'a fresh policy is not exhausted');
  assert(policy.attemptNumber === 0, 'a fresh policy starts at attempt 0');

  const delays: number[] = [];
  while (!policy.exhausted) delays.push(policy.nextDelayMs());

  assert(delays.length === 3, `exactly 3 delays are handed out before exhaustion, got ${delays.length}`);
  assert(delays.join(',') === MIC_RETRY_DELAYS_MS.join(','), `delays match the configured table in order, got [${delays.join(',')}]`);
  assert(policy.exhausted, 'the policy reports exhausted after 3 attempts');
  assert(policy.attemptNumber === 3, `attemptNumber reflects the 3 consumed attempts, got ${policy.attemptNumber}`);

  policy.reset();
  assert(!policy.exhausted, 'reset() clears exhaustion — a fresh start() call can retry from scratch');
  assert(policy.attemptNumber === 0, 'reset() zeroes the attempt counter');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
