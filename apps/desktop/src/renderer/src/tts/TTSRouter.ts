import type { VoiceInfo } from '@kvl/shared';
import type { TTSProvider, TTSSynthesizeOptions, TTSTierId } from './types';
import { BackendTtsProvider } from './BackendTtsProvider';
import { BrowserTTSProvider } from './BrowserTTSProvider';
import { useTtsStore } from '../state/ttsStore';

interface QueueItem {
  text: string;
  options?: TTSSynthesizeOptions;
}

/** Simple FIFO — speaking while something is already playing enqueues
 * rather than interrupting (explicit Phase 7 feature: "Audio queue"). */
class TTSQueue {
  private items: QueueItem[] = [];

  enqueue(item: QueueItem): void {
    this.items.push(item);
  }

  dequeue(): QueueItem | undefined {
    return this.items.shift();
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }
}

/**
 * Owns the real Local -> Browser -> Cloud priority order (the phase spec's
 * own order) — this MUST live in the renderer, since only it can reach the
 * Browser tier and actually play audio; the backend's TtsManager
 * deliberately has no fallback logic of its own (see TtsManager.ts).
 * Advances to the next tier only when the current one is unavailable or
 * throws — that's where "Add fallback when provider fails" actually lives.
 */
export class TTSRouter {
  private readonly local = new BackendTtsProvider('local');
  private readonly browser = new BrowserTTSProvider();
  private readonly cloud = new BackendTtsProvider('cloud');
  private readonly queue = new TTSQueue();

  private activeProvider: TTSProvider | null = null;
  private busy = false;
  private lastSpoken: QueueItem | null = null;

  private tiersFor(offlineOnly: boolean): TTSProvider[] {
    // Cloud is architecturally excluded, not just deprioritized — the real
    // privacy guarantee (see the Phase 7 plan's offline-only decision).
    return offlineOnly ? [this.local, this.browser] : [this.local, this.browser, this.cloud];
  }

  getProvider(tier: TTSTierId): TTSProvider {
    if (tier === 'local') return this.local;
    if (tier === 'browser') return this.browser;
    return this.cloud;
  }

  /** Speaks a short fixed sample through one specific tier, bypassing the
   * queue/fallback chain entirely — used by the panel's "Preview voice"
   * button, which must never touch the main response queue. */
  async previewVoice(tier: TTSTierId, voiceId: string, sampleText = 'This is a preview of this voice.'): Promise<void> {
    await this.getProvider(tier).synthesize(sampleText, { voiceId });
  }

  async speak(text: string, options?: TTSSynthesizeOptions): Promise<void> {
    if (!text.trim()) return;
    this.lastSpoken = { text, options };

    if (this.busy) {
      this.queue.enqueue({ text, options });
      useTtsStore.getState().setQueueLength(this.queue.length);
      return;
    }
    await this.playNow(text, options);
  }

  replay(): void {
    if (this.lastSpoken) void this.speak(this.lastSpoken.text, this.lastSpoken.options);
  }

  private async playNow(text: string, options?: TTSSynthesizeOptions): Promise<void> {
    this.busy = true;
    useTtsStore.getState().setPlaybackState('playing');

    const offlineOnly = useTtsStore.getState().offlineOnly;
    let lastError: unknown;

    for (const provider of this.tiersFor(offlineOnly)) {
      if (!provider.getCapabilities().available) continue;
      try {
        await provider.synthesize(text, options);
        this.activeProvider = provider;
        provider.onEnded(() => this.handleEnded());
        const providerId = provider instanceof BackendTtsProvider ? provider.lastProvider : provider.tier;
        useTtsStore.getState().setLastSpoken(provider.tier, providerId);
        return;
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    this.busy = false;
    useTtsStore.getState().setPlaybackState('idle');
    throw lastError instanceof Error ? lastError : new Error('All TTS tiers are unavailable');
  }

  private handleEnded(): void {
    this.busy = false;
    const next = this.queue.dequeue();
    useTtsStore.getState().setQueueLength(this.queue.length);
    if (next) {
      void this.playNow(next.text, next.options);
    } else {
      useTtsStore.getState().setPlaybackState('idle');
    }
  }

  pause(): void {
    this.activeProvider?.pause();
    useTtsStore.getState().setPlaybackState('paused');
  }

  resume(): void {
    this.activeProvider?.resume();
    useTtsStore.getState().setPlaybackState('playing');
  }

  stop(): void {
    this.activeProvider?.stop();
    this.queue.clear();
    this.busy = false;
    useTtsStore.getState().setQueueLength(0);
    useTtsStore.getState().setPlaybackState('idle');
  }

  async getVoicesForActiveTier(): Promise<VoiceInfo[]> {
    const tier = useTtsStore.getState().lastTier ?? 'browser';
    return this.getProvider(tier).getVoices();
  }

  /** Applies to the Local/Cloud tiers' <audio> elements — the Browser tier
   * (window.speechSynthesis) has no device-selection concept at all. Sticks
   * for the lifetime of these provider instances, so future playback keeps
   * using it without needing to re-apply per call. */
  async setOutputDevice(deviceId: string): Promise<void> {
    await Promise.all([this.local.setSinkId(deviceId), this.cloud.setSinkId(deviceId)]);
  }
}

export const ttsRouter = new TTSRouter();
