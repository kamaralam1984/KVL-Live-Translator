export interface VoiceInfo {
  id: string;
  name: string;
  languageCode: string;
  gender?: 'male' | 'female' | 'neutral';
}
