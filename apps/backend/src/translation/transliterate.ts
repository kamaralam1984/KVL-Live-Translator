/**
 * Approximate Devanagari -> Roman transliteration. Used as a post-processing
 * step so pure-NMT providers (which only ever produce standard Devanagari
 * Hindi) can approximate the 'hinglish' mode's romanized output — this is a
 * real, deterministic algorithm, not a claim of genuine casual code-mixing
 * (see the Phase 4 plan's note on why true Hinglish needs an LLM).
 */

const INDEPENDENT_VOWELS: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo',
  ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
};

const VOWEL_SIGNS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const CONSONANTS: Record<string, string> = {
  क: 'ka', ख: 'kha', ग: 'ga', घ: 'gha', ङ: 'nga',
  च: 'cha', छ: 'chha', ज: 'ja', झ: 'jha', ञ: 'nya',
  ट: 'ta', ठ: 'tha', ड: 'da', ढ: 'dha', ण: 'na',
  त: 'ta', थ: 'tha', द: 'da', ध: 'dha', न: 'na',
  प: 'pa', फ: 'pha', ब: 'ba', भ: 'bha', म: 'ma',
  य: 'ya', र: 'ra', ल: 'la', व: 'va',
  श: 'sha', ष: 'sha', स: 'sa', ह: 'ha',
};

const VIRAMA = '्';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';
const NUKTA = '़';

const DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

/** Applied uniformly by every pure-NMT-style provider (Local/Argos/LibreTranslate)
 * so the 'hinglish' approximation logic lives in one place, not duplicated
 * three times — see the Phase 4 plan's note on why true Hinglish needs an LLM. */
export function applyHinglishIfRequested(hindiText: string, mode: string): string {
  return mode === 'hinglish' ? devanagariToRoman(hindiText) : hindiText;
}

export function devanagariToRoman(text: string): string {
  let out = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch in CONSONANTS) {
      const base = CONSONANTS[ch].slice(0, -1); // drop the inherent 'a'
      if (next && next in VOWEL_SIGNS) {
        out += base + VOWEL_SIGNS[next];
        i += 1;
      } else if (next === VIRAMA) {
        out += base;
        i += 1;
      } else if (next === NUKTA) {
        out += base + 'a';
        i += 1;
      } else {
        out += CONSONANTS[ch]; // full syllable, inherent 'a' kept
      }
      continue;
    }

    if (ch in INDEPENDENT_VOWELS) {
      out += INDEPENDENT_VOWELS[ch];
      continue;
    }
    if (ch in DIGITS) {
      out += DIGITS[ch];
      continue;
    }
    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      out += 'n';
      continue;
    }
    if (ch === VISARGA) {
      out += 'h';
      continue;
    }
    if (ch === VIRAMA || ch === NUKTA) {
      continue; // handled inline above when following a consonant; standalone is a no-op
    }

    out += ch; // spaces, punctuation, already-Roman text pass through untouched
  }

  return out;
}
