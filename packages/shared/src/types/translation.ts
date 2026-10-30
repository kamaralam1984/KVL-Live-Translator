export type TranslationMode = 'hindi' | 'hinglish' | 'simple-hindi' | 'simple-english';

export interface TranslationResultDTO {
  sessionId: string;
  originalText: string;
  translatedText: string;
  suggestedReply?: string;
  mode: TranslationMode;
  sourceLang: string;
  targetLang: string;
  confidence?: number;
  createdAt: string;
}
