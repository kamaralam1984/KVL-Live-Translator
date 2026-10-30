/** Starter business/technical terms that should survive translation
 * untouched, regardless of which provider is used — extend as needed. */
export const DEFAULT_GLOSSARY = [
  'API',
  'backend',
  'frontend',
  'deployment',
  'sprint',
  'standup',
  'roadmap',
  'stakeholder',
  'milestone',
  'staging',
  'production',
  'repository',
  'pull request',
  'merge',
  'endpoint',
  'database',
  'server',
  'client',
  'KVL',
];

export interface ProtectedText {
  text: string;
  mapping: Map<string, string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces each glossary term (whole-word, case-insensitive) with a unique
 * placeholder token before the text reaches any translation provider —
 * provider-agnostic, so this runs once at the router, not per-provider.
 * Direction-agnostic too: used by both the EN→HI translation router (Phase 4)
 * and the HI→EN response router (Phase 6). */
export function protectTerms(text: string, terms: string[] = DEFAULT_GLOSSARY): ProtectedText {
  const mapping = new Map<string, string>();
  let result = text;
  let index = 0;

  for (const term of terms) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi');
    if (!pattern.test(result)) continue;

    const placeholder = `KVLTERM${index}X`;
    index += 1;

    // Re-run with a fresh RegExp (lastIndex from .test() above) — replace
    // every occurrence, but keep the *first* matched casing as the restored form.
    let firstMatch: string | undefined;
    result = result.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'), (match) => {
      firstMatch ??= match;
      return placeholder;
    });
    mapping.set(placeholder, firstMatch ?? term);
  }

  return { text: result, mapping };
}

/** Reverses protectTerms() after translation. Placeholder tokens are
 * plain-alphanumeric on purpose (no punctuation) so they survive round-trip
 * through providers that might otherwise mangle underscores/braces. */
export function restoreTerms(text: string, mapping: Map<string, string>): string {
  let result = text;
  for (const [placeholder, original] of mapping) {
    result = result.replace(new RegExp(placeholder, 'gi'), original);
  }
  return result;
}
