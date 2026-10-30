/** Register/tone the user wants their Hindi/Hinglish reply rewritten into —
 * an axis of its own, distinct from TranslationMode's target-language axis
 * (Phase 6 always targets English; this picks the voice). */
export type ResponseStyle =
  | 'professional'
  | 'friendly'
  | 'short'
  | 'detailed'
  | 'client-friendly'
  | 'technical'
  | 'simple-english';

export interface ResponseResultDTO {
  id: string;
  sourceText: string;
  englishText: string;
  style: ResponseStyle;
  providerId: string;
  createdAt: string;
}
