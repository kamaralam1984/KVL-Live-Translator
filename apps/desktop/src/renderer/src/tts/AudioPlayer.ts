/**
 * Thin wrapper around one <audio> element, shared by the Local/Cloud TTS
 * tiers (both hand back raw audio bytes to play; the Browser tier speaks
 * directly via Web Speech and doesn't use this at all). Object URLs are
 * revoked as soon as they're no longer needed — audio is never written to
 * disk and never kept longer than the current/last utterance (see the
 * Phase 7 plan's "do not store generated audio permanently" requirement).
 */
export class AudioPlayer {
  private readonly audio = new Audio();
  private currentUrl: string | null = null;

  constructor() {
    this.audio.addEventListener('ended', () => this.revokeCurrentUrl());
  }

  private revokeCurrentUrl(): void {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  loadAndPlay(audioBytes: Uint8Array, mimeType: string): void {
    this.revokeCurrentUrl();
    const blob = new Blob([audioBytes.buffer as ArrayBuffer], { type: mimeType });
    this.currentUrl = URL.createObjectURL(blob);
    this.audio.src = this.currentUrl;
    void this.audio.play();
  }

  play(): void {
    void this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  resume(): void {
    void this.audio.play();
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.revokeCurrentUrl();
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  setPlaybackRate(rate: number): void {
    this.audio.playbackRate = Math.max(0.5, Math.min(2, rate));
  }

  async setSinkId(deviceId: string): Promise<void> {
    if (typeof this.audio.setSinkId === 'function') await this.audio.setSinkId(deviceId);
  }

  onEnded(callback: () => void): void {
    this.audio.addEventListener('ended', callback);
  }

  get isPaused(): boolean {
    return this.audio.paused;
  }
}
