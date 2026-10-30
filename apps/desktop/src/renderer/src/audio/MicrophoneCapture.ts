import { mapMediaError } from './errors';
import { CAPTURE_FORMAT } from './AudioFormat';

export interface MicrophoneCaptureOptions {
  deviceId?: string;
  onDisconnected?: () => void;
}

/**
 * Opens a microphone MediaStream. Raw signal is preferred (echo
 * cancellation / noise suppression / auto-gain disabled) since those
 * browser DSP features can distort speech in ways that hurt downstream
 * VAD/STT more than they help a live meeting recording.
 */
export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;

  async start(options: MicrophoneCaptureOptions = {}): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
          channelCount: CAPTURE_FORMAT.channels,
          sampleRate: CAPTURE_FORMAT.sampleRate,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.stream = stream;
      this.track = stream.getAudioTracks()[0] ?? null;
      this.track?.addEventListener('ended', () => {
        this.stream = null;
        this.track = null;
        options.onDisconnected?.();
      });
      return stream;
    } catch (error) {
      throw mapMediaError(error, 'microphone');
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
  }

  get isActive(): boolean {
    return this.track?.readyState === 'live';
  }

  get currentStream(): MediaStream | null {
    return this.stream;
  }
}
