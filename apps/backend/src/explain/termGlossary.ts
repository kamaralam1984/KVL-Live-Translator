import type { ExplanationTerm } from '@kvl/shared';

/** Common technical/business terms with real, short definitions — same
 * spirit as translation/glossary.ts's DEFAULT_GLOSSARY, but for explaining
 * meaning rather than protecting text from mistranslation. Zero-dependency,
 * always available, used by LocalExplanationProvider. Deliberately small —
 * the honest local baseline, not a substitute for real LLM reasoning. */
export const TERM_DEFINITIONS: Record<string, string> = {
  api: 'A defined way for two pieces of software to talk to each other.',
  backend: 'The server-side part of an app that the user does not see directly.',
  frontend: 'The part of an app the user sees and interacts with.',
  deployment: 'The process of putting new code live for real users.',
  architecture: 'The overall structure/design of how a system\'s parts fit together.',
  scalability: 'How well a system keeps working as more users/traffic are added.',
  sprint: 'A short, fixed period of work (often 1-2 weeks) with a defined goal.',
  standup: 'A short daily team meeting to share progress and blockers.',
  roadmap: 'A high-level plan showing what will be built and roughly when.',
  stakeholder: 'A person with an interest in or influence over a project\'s outcome.',
  milestone: 'A significant checkpoint or goal in a project\'s timeline.',
  staging: 'A test environment that mirrors production, used before a real release.',
  production: 'The live environment real users actually use.',
  repository: 'Where a project\'s code is stored and version-controlled.',
  'pull request': 'A request to merge a code change, usually reviewed by teammates first.',
  merge: 'Combining one set of code changes into another (e.g. into the main codebase).',
  endpoint: 'A specific URL/address an API exposes for a particular action.',
  database: 'Where an application\'s data is stored persistently.',
  latency: 'The delay between a request and its response.',
  throughput: 'How much work/traffic a system can handle in a given time.',
  'load balancer': 'A component that spreads incoming traffic across multiple servers.',
  microservice: 'A small, independently-deployable service that does one job.',
  monolith: 'A single large application where all functionality lives together.',
  'ci/cd': 'Automated pipelines that build, test, and deploy code changes.',
  authentication: 'Verifying who a user is (e.g. logging in).',
  authorization: 'Verifying what an already-identified user is allowed to do.',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (or whole-phrase, for multi-word terms), case-insensitive
 * match against the given text — "class" must not match inside
 * "classroom". Returns matched terms in the order they're defined above,
 * each only once even if it appears multiple times in the text. */
export function findKnownTerms(text: string): ExplanationTerm[] {
  const found: ExplanationTerm[] = [];
  for (const [term, definition] of Object.entries(TERM_DEFINITIONS)) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
    if (pattern.test(text)) found.push({ term, definition });
  }
  return found;
}
