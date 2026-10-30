import type {
  ResponseProvider,
  ResponseProviderCapabilities,
  ResponseProviderConfig,
  ResponseProviderStatus,
  ResponseRequest,
  ResponseResult,
} from '@kvl/response';

/** Multi-word phrases checked first (longest-match-wins) — mirrors
 * LocalTranslationProvider.ts's phrase-then-word approach. Roman-script
 * Hinglish, since that's the dominant typed/spoken-and-transcribed form for
 * this reverse direction (see the Phase 6 plan's worked example). Small and
 * best-effort on purpose — the always-available baseline, not a replacement
 * for the cloud provider's real restyling. */
const PHRASES: Array<[string, string]> = [
  ['hum friday tak complete kar denge', 'we will complete it by friday'],
  ['humne deployment kal kiya tha', 'we did the deployment yesterday'],
  ['thoda delay ho gaya', 'there was a slight delay'],
  ['ek minute please', 'one moment please'],
  ['mujhe samajh nahi aaya', 'i did not understand'],
];

const WORDS: Record<string, string> = {
  hum: 'we',
  humne: 'we',
  main: 'i',
  mujhe: 'to me',
  aap: 'you',
  aapko: 'to you',
  kal: 'yesterday',
  aaj: 'today',
  abhi: 'now',
  kiya: 'did',
  karenge: 'will do',
  karunga: 'i will do',
  karungi: 'i will do',
  kar: 'do',
  denge: 'will give',
  tha: 'was',
  thi: 'was',
  the: 'were',
  hai: 'is',
  hain: 'are',
  lekin: 'but',
  wajah: 'reason',
  se: 'due to',
  thoda: 'a little',
  delay: 'delay',
  ho: 'is',
  gaya: 'happened',
  gayi: 'happened',
  tak: 'by',
  complete: 'complete',
  deployment: 'deployment',
  deploy: 'deploy',
  testing: 'testing',
  bug: 'bug',
  fix: 'fix',
  meeting: 'meeting',
  project: 'project',
  client: 'client',
  friday: 'Friday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  saturday: 'Saturday',
  sunday: 'Sunday',
  haan: 'yes',
  han: 'yes',
  nahi: 'no',
  nahin: 'no',
  theek: 'fine',
  thik: 'fine',
  please: 'please',
  chahiye: 'is needed',
  samajh: 'understand',
  milega: 'will be available',
};

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-zA-Z']+|[^a-zA-Z\s]+/g) ?? [];
}

/** Zero-dependency, always-available built-in reverse phrasebook. Real code,
 * real (limited) coverage — not a stub. Reports confidence as the fraction
 * of input words it could actually translate, so the router can keep
 * looking when coverage is too low to be useful. Cannot genuinely restyle —
 * only claims the 'professional' style (see getCapabilities). */
export class LocalResponsePhrasebookProvider implements ResponseProvider {
  readonly id = 'local-response-phrasebook';
  readonly displayName = 'Local Phrasebook';
  readonly tier = 'local' as const;

  private status: ResponseProviderStatus = 'ready';

  async start(_config: ResponseProviderConfig): Promise<void> {
    this.status = 'ready';
  }

  async stop(): Promise<void> {
    this.status = 'unavailable';
  }

  async generate(request: ResponseRequest): Promise<ResponseResult> {
    this.status = 'busy';
    try {
      // Token-array-based (not raw-string) phrase matching, so a matched
      // phrase's already-English replacement words never re-enter the
      // coverage count — unlike LocalTranslationProvider's Devanagari
      // output, English replacement text WOULD tokenize as ordinary word
      // tokens and silently dilute the confidence ratio if handled as a
      // string substitution first.
      const tokens = tokenize(request.text.toLowerCase());
      const wordTokens = tokens.filter((t) => /[a-z']/.test(t));

      const outWords: string[] = [];
      let translatedCount = 0;
      let i = 0;
      outer: while (i < tokens.length) {
        for (const [phrase, translation] of PHRASES) {
          const phraseTokens = phrase.split(' ');
          if (tokens.slice(i, i + phraseTokens.length).join(' ') === phraseTokens.join(' ')) {
            outWords.push(translation);
            translatedCount += phraseTokens.length;
            i += phraseTokens.length;
            continue outer;
          }
        }

        const token = tokens[i];
        if (/[a-z']/.test(token) && token in WORDS) {
          outWords.push(WORDS[token]);
          translatedCount += 1;
        } else {
          outWords.push(token);
        }
        i += 1;
      }

      const raw = outWords.join(' ').replace(/\s+/g, ' ').trim();
      const englishText = raw.charAt(0).toUpperCase() + raw.slice(1);
      const confidence = wordTokens.length === 0 ? 1 : Math.min(1, translatedCount / wordTokens.length);

      this.status = 'ready';
      return { englishText, confidence };
    } catch (error) {
      this.status = 'ready';
      throw error;
    }
  }

  getStatus(): ResponseProviderStatus {
    return this.status;
  }

  getCapabilities(): ResponseProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: true,
      offline: true,
      requiresApiKey: false,
      tier: this.tier,
      supportedStyles: ['professional'],
    };
  }
}
