import type { VoiceInfo } from '@kvl/shared';
import type { TTSCapabilities, TTSProvider, TTSSynthesizeOptions } from './types';
import { AudioPlayer } from './AudioPlayer';
import { requestSynthesize, requestVoices } from './ttsBridge';

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * One class for both the 'local' and 'cloud' backend-synthesizable tiers —
 * they differ only by which tier string is sent over WS. Round-trips
 * through the backend's TtsManager (apps/backend/src/tts/TtsManager.ts) via
 * ttsBridge.ts's requestId correlation, then plays the returned audio bytes
 * through a private AudioPlayer.
 */
export class BackendTtsProvider implements TTSProvider {
  readonly tier: 'local' | 'cloud';
  readonly displayName: string;

  private readonly player = new AudioPlayer();
  private available = true; // optimistic until a synthesize attempt proves otherwise
  private lastProviderId = '';

  constructor(tier: 'local' | 'cloud') {
    this.tier = tier;
    this.displayName = tier === 'local' ? 'Local (offline)' : 'Cloud';
  }

  async synthesize(text: string, options: TTSSynthesizeOptions = {}): Promise<void> {
    const { audioBase64, mimeType, providerId } = await requestSynthesize(this.tier, text, options.voiceId, options.speed);
    this.lastProviderId = providerId;
    this.available = true;
    if (typeof options.volume === 'number') this.player.setVolume(options.volume);
    if (options.speed) this.player.setPlaybackRate(options.speed);
    this.player.loadAndPlay(base64ToBytes(audioBase64), mimeType);
  }

  play(): void {
    this.player.play();
  }

  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.resume();
  }

  stop(): void {
    this.player.stop();
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return requestVoices(this.tier);
  }

  getCapabilities(): TTSCapabilities {
    return { tier: this.tier, displayName: this.displayName, available: this.available };
  }

  onEnded(callback: () => void): void {
    this.player.onEnded(callback);
  }

  /** For Settings' Audio Output Device selector. */
  setSinkId(deviceId: string): Promise<void> {
    return this.player.setSinkId(deviceId);
  }

  get lastProvider(): string {
    return this.lastProviderId;
  }

  markUnavailable(): void {
    this.available = false;
  }
}
