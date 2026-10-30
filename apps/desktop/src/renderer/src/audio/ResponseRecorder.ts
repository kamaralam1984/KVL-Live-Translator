import { MicrophoneCapture } from './MicrophoneCapture';
import { CAPTURE_FORMAT, EXPORT_FORMAT, downsample, floatTo16BitPCM } from './AudioFormat';
import { bytesToBase64 } from './base64';

const WORKLET_NAME = 'kvl-frame-processor';
// Same already-proven static asset AudioCaptureManager.ts uses — see that
// file and the worklet source for why this can't be a bundled TS import.
const WORKLET_URL = './worklets/frame-processor.worklet.js';

interface AudioFrameMessage {
  samples: Float32Array;
}

export interface RecordedUtterance {
  audioBase64: string;
  durationMs: number;
}

/**
 * A small, mic-only, one-shot recorder for Phase 6's push-to-talk response
 * drafting — deliberately NOT a reuse of AudioCaptureManager, which is built
 * for continuous dual-source VAD-segmented meeting capture (the wrong shape
 * for "hold a button, speak one utterance, release"). Reuses the proven
 * pieces directly: MicrophoneCapture for the raw stream, the same
 * AudioWorklet for PCM frames, and downsample/floatTo16BitPCM/bytesToBase64
 * for the single-shot export at stop() time. Fully independent of whether a
 * meeting session/AudioCaptureManager instance is active.
 */
export class ResponseRecorder {
  private readonly micCapture = new MicrophoneCapture();
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private frames: Float32Array[] = [];
  private recording = false;
  private startedAtMs = 0;

  get isRecording(): boolean {
    return this.recording;
  }

  async start(): Promise<void> {
    if (this.recording) return;

    const stream = await this.micCapture.start();
    this.audioContext = new AudioContext({ sampleRate: CAPTURE_FORMAT.sampleRate });
    await this.audioContext.audioWorklet.addModule(WORKLET_URL);

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, WORKLET_NAME);
    this.workletNode.port.onmessage = (event: MessageEvent<AudioFrameMessage>) => {
      if (this.recording) this.frames.push(event.data.samples);
    };
    this.sourceNode.connect(this.workletNode);

    this.frames = [];
    this.recording = true;
    this.startedAtMs = performance.now();
  }

  /** Returns null if nothing usable was recorded (stopped immediately, or
   * never started) — caller decides how to surface that. */
  async stop(): Promise<RecordedUtterance | null> {
    if (!this.recording) return null;
    this.recording = false;
    const durationMs = Math.round(performance.now() - this.startedAtMs);

    this.workletNode?.port.close();
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    await this.audioContext?.close();
    this.micCapture.stop();
    this.audioContext = null;
    this.sourceNode = null;
    this.workletNode = null;

    const frames = this.frames;
    this.frames = [];
    if (frames.length === 0) return null;

    const totalSamples = frames.reduce((sum, f) => sum + f.length, 0);
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const frame of frames) {
      merged.set(frame, offset);
      offset += frame.length;
    }

    const exported = downsample(merged, CAPTURE_FORMAT.sampleRate, EXPORT_FORMAT.sampleRate);
    const pcm16 = floatTo16BitPCM(exported);
    const audioBase64 = bytesToBase64(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength));

    return { audioBase64, durationMs };
  }

  /** Discards whatever was recorded without exporting — used if the user
   * cancels mid-recording. */
  async cancel(): Promise<void> {
    await this.stop();
  }
}
