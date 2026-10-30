import type {
  ExplanationProvider,
  ExplanationProviderCapabilities,
  ExplanationProviderConfig,
  ExplanationProviderStatus,
  ExplanationRequest,
  ExplanationResult,
} from '@kvl/explain';
import { LocalTranslationProvider } from '../../translation/providers/LocalTranslationProvider';
import { findKnownTerms } from '../termGlossary';

const NEEDS_CLOUD_NOTE = 'Local mode cannot determine this — configure a cloud AI provider (API Providers screen) for a full analysis.';
/** Fixed and low on purpose — the router's existing low-confidence-continue
 * logic (identical mechanism to TranslationRouter/ResponseRouter) then
 * naturally prefers Cloud whenever it's configured, and only surfaces this
 * partial result when Cloud is the only thing unavailable. */
const PARTIAL_CONFIDENCE = 0.3;

/**
 * Honestly partial — explaining intent and drafting a response genuinely
 * needs an LLM, which this isn't. Reuses the real, already-working
 * LocalTranslationProvider (Phase 4) for a literal Hinglish rendering of
 * the sentence, and a real built-in term-definition dictionary
 * (termGlossary.ts) for any recognized technical terms. Never invents the
 * two fields it can't derive — returns a clear placeholder instead.
 */
export class LocalExplanationProvider implements ExplanationProvider {
  readonly id = 'local-explanation';
  readonly displayName = 'Local (partial)';
  readonly tier = 'local' as const;

  private readonly translator = new LocalTranslationProvider();
  private status: ExplanationProviderStatus = 'ready';

  async start(_config: ExplanationProviderConfig): Promise<void> {
    await this.translator.start({});
    this.status = 'ready';
  }

  async stop(): Promise<void> {
    this.status = 'unavailable';
  }

  async explain(request: ExplanationRequest): Promise<ExplanationResult> {
    this.status = 'busy';
    try {
      const translated = await this.translator.translate({
        text: request.sentence,
        sourceLang: 'en',
        targetLang: 'hi',
        mode: 'hinglish',
      });

      const contextText = request.contextSegments.join(' ');
      const terms = findKnownTerms(`${request.sentence} ${contextText}`);

      return {
        simpleMeaning: translated.translatedText,
        whatTheyAreAsking: NEEDS_CLOUD_NOTE,
        importantContext: NEEDS_CLOUD_NOTE,
        terms,
        suggestedResponse: NEEDS_CLOUD_NOTE,
        confidence: PARTIAL_CONFIDENCE,
      };
    } finally {
      this.status = 'ready';
    }
  }

  getStatus(): ExplanationProviderStatus {
    return this.status;
  }

  getCapabilities(): ExplanationProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: true,
      offline: true,
      requiresApiKey: false,
      tier: this.tier,
    };
  }
}
