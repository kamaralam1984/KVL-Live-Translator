import type { VoiceInfo } from '@kvl/shared';
import type { TTSCapabilities, TTSProvider, TTSSynthesizeOptions } from './types';

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    window.speechSynthesis.addEventListener(
      'voiceschanged',
      () => resolve(window.speechSynthesis.getVoices()),
      { once: true },
    );
  });
}

/**
 * Wraps the browser's built-in Web Speech API directly — supersedes Phase
 * 6's responseTtsService.ts MVP. Synthesize and playback are one native
 * call here (there's no separate "get raw audio bytes" API in Web Speech),
 * unlike the Local/Cloud tiers which round-trip through the backend and
 * play via AudioPlayer.
 */
export class BrowserTTSProvider implements TTSProvider {
  readonly tier = 'browser' as const;
  readonly displayName = 'Browser';

  private endedCallbacks: Array<() => void> = [];
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  async synthesize(text: string, options: TTSSynthesizeOptions = {}): Promise<void> {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    if (options.speed) utterance.rate = Math.max(0.5, Math.min(2, options.speed));
    if (typeof options.volume === 'number') utterance.volume = Math.max(0, Math.min(1, options.volume));

    if (options.voiceId) {
      const voices = await loadVoices();
      const match = voices.find((v) => v.voiceURI === options.voiceId);
      if (match) utterance.voice = match;
    }

    utterance.addEventListener('end', () => this.endedCallbacks.forEach((cb) => cb()));
    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  play(): void {
    if (this.currentUtterance) window.speechSynthesis.speak(this.currentUtterance);
  }

  pause(): void {
    window.speechSynthesis.pause();
  }

  resume(): void {
    window.speechSynthesis.resume();
  }

  stop(): void {
    window.speechSynthesis.cancel();
  }

  async getVoices(): Promise<VoiceInfo[]> {
    const voices = await loadVoices();
    return voices.map((v) => ({ id: v.voiceURI, name: v.name, languageCode: v.lang }));
  }

  getCapabilities(): TTSCapabilities {
    return {
      tier: this.tier,
      displayName: this.displayName,
      available: typeof window !== 'undefined' && 'speechSynthesis' in window,
    };
  }

  onEnded(callback: () => void): void {
    this.endedCallbacks.push(callback);
  }
}
