export interface TranscriptSegment {
  id: string;
  sessionId: string;
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs: number;
  languageCode?: string;
  confidence?: number;
}
