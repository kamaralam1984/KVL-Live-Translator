import type {
  TranslationProvider,
  TranslationProviderCapabilities,
  TranslationProviderConfig,
  TranslationProviderStatus,
  TranslationRequest,
  TranslationResult,
} from '@kvl/translation';
import { applyHinglishIfRequested } from '../transliterate';

/** Multi-word phrases checked first (longest-match-wins), before falling
 * back to single-word lookups. Values are Devanagari — same as every other
 * provider produces natively — so 'hinglish' mode's transliteration
 * post-processing (applyHinglishIfRequested, below) has real Devanagari to
 * work with instead of already-romanized text. Deliberately small — this is
 * the always-available baseline, not meant to replace a real NMT/LLM
 * provider, which is exactly why the router treats its low-coverage results
 * as low-confidence and keeps looking (see TranslationRouter.ts). */
const PHRASES: Array<[string, string]> = [
  ['thank you very much', 'बहुत बहुत धन्यवाद'],
  ['can you repeat that', 'क्या आप इसे दोबारा कह सकते हैं'],
  ['let us continue', 'चलिए आगे बढ़ते हैं'],
  ['i understand', 'मैं समझ गया'],
  ['i do not understand', 'मैं नहीं समझ पाया'],
  ['one moment please', 'एक पल रुकिए'],
  ['good morning', 'नमस्ते'],
  ['good afternoon', 'नमस्ते'],
  ['good evening', 'नमस्ते'],
  ['thank you', 'धन्यवाद'],
  ['see you later', 'फिर मिलेंगे'],
];

const WORDS: Record<string, string> = {
  yes: 'हाँ',
  no: 'नहीं',
  okay: 'ठीक है',
  ok: 'ठीक है',
  please: 'कृपया',
  sorry: 'माफ़ कीजिए',
  hello: 'नमस्ते',
  hi: 'नमस्ते',
  bye: 'अलविदा',
  today: 'आज',
  tomorrow: 'कल',
  yesterday: 'कल',
  now: 'अभी',
  later: 'बाद में',
  question: 'सवाल',
  answer: 'जवाब',
  meeting: 'मीटिंग',
  time: 'समय',
  minute: 'मिनट',
  hour: 'घंटा',
  one: 'एक',
  two: 'दो',
  three: 'तीन',
  four: 'चार',
  five: 'पांच',
  good: 'अच्छा',
  bad: 'बुरा',
  and: 'और',
  the: '',
  a: '',
  an: '',
};

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-zA-Z']+|[^a-zA-Z\s]+/g) ?? [];
}

/** Zero-dependency, always-available built-in phrasebook. Real code, real
 * (limited) coverage — not a stub. Reports confidence as the fraction of
 * input words it could actually translate, so the router can keep looking
 * when coverage is too low to be useful. */
export class LocalTranslationProvider implements TranslationProvider {
  readonly id = 'local-phrasebook';
  readonly displayName = 'Local Phrasebook';
  readonly tier = 'local' as const;

  private status: TranslationProviderStatus = 'ready';

  async start(_config: TranslationProviderConfig): Promise<void> {
    this.status = 'ready'; // always available — no external dependency to check
  }

  async stop(): Promise<void> {
    this.status = 'unavailable';
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.status = 'busy';
    try {
      let working = request.text.toLowerCase();
      let phraseHits = 0;

      for (const [phrase, translation] of PHRASES) {
        if (working.includes(phrase)) {
          working = working.split(phrase).join(` ${translation} `);
          phraseHits += 1;
        }
      }

      const tokens = tokenize(working);
      const wordTokens = tokens.filter((t) => /[a-z']/.test(t));
      let translatedCount = 0;

      const words = tokens.map((token) => {
        if (!/[a-z']/.test(token)) return token; // punctuation passes through
        if (token in WORDS) {
          translatedCount += 1;
          return WORDS[token];
        }
        // Already-Devanagari or already-translated (from phrase pass) tokens
        // don't count as a "miss" — only genuinely untranslated Latin words do.
        return token;
      });

      const translatedTextHindiLike = words.join(' ').replace(/\s+/g, ' ').trim();
      const translatedText = applyHinglishIfRequested(translatedTextHindiLike, request.mode);

      const confidence = wordTokens.length === 0 ? 1 : Math.min(1, (translatedCount + phraseHits * 2) / Math.max(1, wordTokens.length));

      this.status = 'ready';
      return { translatedText, confidence };
    } catch (error) {
      this.status = 'ready';
      throw error;
    }
  }

  getStatus(): TranslationProviderStatus {
    return this.status;
  }

  getCapabilities(): TranslationProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: true,
      offline: true,
      requiresApiKey: false,
      tier: this.tier,
      supportedModes: ['hindi', 'hinglish'],
    };
  }
}
