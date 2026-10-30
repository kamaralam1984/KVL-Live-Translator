import { AudioCaptureError, mapMediaError } from './errors';
import type { AppPlatform } from './types';

export interface SystemAudioFallbackInfo {
  platform: AppPlatform;
  message: string;
  guideUrl?: string;
}

/** Per-OS guidance shown when system audio capture isn't available (spec §20-21). */
export function getSystemAudioFallbackInfo(platform: AppPlatform): SystemAudioFallbackInfo {
  switch (platform) {
    case 'darwin':
      return {
        platform,
        message:
          'macOS blocks direct system-audio loopback for privacy reasons. Install a virtual audio device (e.g. BlackHole) and select it from the microphone list to route meeting audio in.',
      };
    case 'linux':
      return {
        platform,
        message:
          'Linux system audio depends on PipeWire/PulseAudio. If the share-screen prompt has no audio option, pick your output device\'s ".monitor" source from the microphone list instead.',
      };
    case 'win32':
      return {
        platform,
        message: 'System audio should be captured via the screen/window share prompt — check "Share system audio" if offered.',
      };
    default:
      return { platform: 'unknown', message: 'System audio capture is not available on this platform through the current configuration.' };
  }
}

/**
 * Captures system/meeting audio via getDisplayMedia (video required by the
 * browser API even though we discard the video track immediately). Chromium
 * only reliably includes an audio track here on Windows and some Linux
 * PipeWire setups — we detect the absence at runtime rather than assuming
 * success, per spec §20 ("never fake success").
 */
export class SystemAudioCapture {
  private stream: MediaStream | null = null;

  async start(): Promise<MediaStream> {
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (error) {
      throw mapMediaError(error, 'system-audio');
    }

    displayStream.getVideoTracks().forEach((track) => track.stop());
    const audioTracks = displayStream.getAudioTracks();

    if (audioTracks.length === 0) {
      throw new AudioCaptureError('SYSTEM_AUDIO_UNAVAILABLE', 'The selected source did not include an audio track');
    }

    const audioOnlyStream = new MediaStream(audioTracks);
    this.stream = audioOnlyStream;
    return audioOnlyStream;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  get isActive(): boolean {
    return (this.stream?.getAudioTracks()[0]?.readyState ?? 'ended') === 'live';
  }

  get currentStream(): MediaStream | null {
    return this.stream;
  }
}
