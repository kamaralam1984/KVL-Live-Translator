import type { VoiceInfo } from '@kvl/tts';
import { LocalTtsProvider } from './providers/LocalTtsProvider';
import { CloudTtsProvider } from './providers/CloudTtsProvider';
import { requestDecryptedKey } from '../speech/keyRelay';
import { providersRepository } from '../db/repositories/providersRepository';
import { broadcast } from '../ws/connectionRegistry';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { childLogger } from '../logger';

const log = childLogger('tts-manager');

/**
 * Owns the two backend-synthesizable TTS tiers. Deliberately NOT a
 * priority-fallback router like TranslationManager/ResponseManager — the
 * renderer's TTSRouter (apps/desktop/src/renderer/src/tts/TTSRouter.ts)
 * owns the real Local -> Browser -> Cloud order, since only it can reach
 * the Browser tier and actually play audio. This class just exposes each
 * tier as an explicit, independent synthesis call.
 */
export class TtsManager {
  private readonly localProvider = new LocalTtsProvider();
  private readonly cloudProvider = new CloudTtsProvider();

  async initialize(): Promise<void> {
    await this.localProvider.start({});
    await this.refreshCloudProvider();
  }

  /** Re-reads the active 'tts' provider config and (re)connects the cloud
   * provider. Safe to call again after Settings changes. */
  async refreshCloudProvider(): Promise<void> {
    const active = providersRepository.getActiveByKind('tts');
    if (!active || !active.hasApiKey) {
      await this.cloudProvider.stop();
      return;
    }

    try {
      const apiKey = await requestDecryptedKey(active.id);
      await this.cloudProvider.start({ apiKey, baseUrl: active.baseUrl, model: active.model });
      log.info({ providerId: active.id }, 'cloud tts provider ready');
    } catch (error) {
      log.warn({ err: error, providerId: active.id }, 'could not activate cloud tts provider');
      await this.cloudProvider.stop();
    }
  }

  /** One minimal real synthesize() call through the already-active cloud
   * provider, for the API Providers "Test key" button. */
  async testCloudProvider(): Promise<{ ok: boolean; message?: string }> {
    if (!this.cloudProvider.getCapabilities().available) return { ok: false, message: 'Not the active provider for this kind, or no key configured.' };
    try {
      await this.cloudProvider.synthesize({ text: 'Test' });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async synthesize(requestId: string, tier: 'local' | 'cloud', text: string, voiceId?: string, speed?: number): Promise<void> {
    const provider = tier === 'local' ? this.localProvider : this.cloudProvider;

    if (tier === 'cloud' && !costGate.isPaidTierAllowed()) {
      broadcast({ type: 'tts:error', requestId, code: 'COST_MODE_BLOCKED', message: 'Cloud voice is unavailable right now (budget limit, local-only mode, or economy cost mode).' });
      broadcast({ type: 'tts:status', providerId: provider.id, status: 'error' });
      return;
    }

    try {
      const result = await provider.synthesize({ text, voiceId, speed });
      broadcast({ type: 'tts:audio', requestId, audioBase64: result.audio.toString('base64'), mimeType: result.mimeType, providerId: provider.id });
      broadcast({ type: 'tts:status', providerId: provider.id, status: 'ready' });
      costManager.record({
        kind: 'tts',
        providerId: provider.getCapabilities().requiresApiKey ? provider.id : null,
        providerLabel: provider.getCapabilities().displayName,
        tier: provider.getCapabilities().tier,
        requiresApiKey: provider.getCapabilities().requiresApiKey,
        requestType: 'synthesize',
        inputUnits: text.length,
        meetingSessionId: null, // Speak is usable standalone, outside any meeting
      });
    } catch (error) {
      log.error({ err: error, requestId, tier }, 'tts synthesis failed');
      broadcast({ type: 'tts:error', requestId, code: 'TTS_SYNTHESIZE_FAILED', message: error instanceof Error ? error.message : String(error) });
      broadcast({ type: 'tts:status', providerId: provider.id, status: 'error' });
    }
  }

  async listVoices(requestId: string, tier: 'local' | 'cloud'): Promise<void> {
    const provider = tier === 'local' ? this.localProvider : this.cloudProvider;
    let voices: VoiceInfo[] = [];
    try {
      voices = await provider.getVoices();
    } catch (error) {
      log.warn({ err: error, tier }, 'could not list voices');
    }
    broadcast({ type: 'tts:voices', requestId, voices });
  }
}

export const ttsManager = new TtsManager();
