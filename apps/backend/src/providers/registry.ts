import { createProviderRegistry } from '@kvl/shared';
import type { SpeechProvider } from '@kvl/speech';
import type { TranslationProvider } from '@kvl/translation';
import type { TtsProvider } from '@kvl/tts';

/**
 * Phase 1 scaffolding: registries exist and are typed against the real
 * interfaces (Phase 3 finished @kvl/speech, Phase 4 finished
 * @kvl/translation). Note that SpeechManager/TranslationManager currently
 * own and instantiate their concrete providers directly rather than
 * populating these registries — they're kept as the intended seam for a
 * future dynamic-registration use case (e.g. Phase 11's provider dashboard),
 * not because anything reads from them today.
 */
export const sttRegistry = createProviderRegistry<SpeechProvider>();
export const translationRegistry = createProviderRegistry<TranslationProvider>();
export const ttsRegistry = createProviderRegistry<TtsProvider>();
