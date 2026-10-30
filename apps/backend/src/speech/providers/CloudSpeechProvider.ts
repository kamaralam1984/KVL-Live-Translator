import type { SpeechInputChunk, SpeechProvider, SpeechProviderCapabilities, SpeechProviderConfig, SpeechProviderStatus, SpeechTranscriptionResult } from '@kvl/speech';
import { pcm16ToWav } from '../wavEncoder';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'whisper-1';

interface CloudTranscriptionResponse {
  text?: string;
  language?: string;
}

/**
 * OpenAI-compatible cloud transcription REST client (POST
 * /audio/transcriptions, multipart WAV upload). baseUrl/model are
 * configurable (already columns on the api_providers table from Phase 1),
 * so any OpenAI-shaped endpoint works, not just OpenAI itself. The API key
 * is handed to start() already decrypted by the caller (see
 * apps/backend/src/speech/SpeechManager.ts + keyRelay.ts) — this class
 * never touches the encrypted blob or SQLite directly.
 */
export class CloudSpeechProvider implements SpeechProvider {
  readonly id = 'cloud-stt';
  readonly displayName = 'Cloud Speech-to-Text';

  private status: SpeechProviderStatus = 'unavailable';
  private apiKey: string | undefined;
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private available = false;

  async start(speechConfig: SpeechProviderConfig): Promise<void> {
    this.status = 'initializing';
    this.apiKey = speechConfig.apiKey;
    this.baseUrl = speechConfig.baseUrl || DEFAULT_BASE_URL;
    this.model = speechConfig.model || DEFAULT_MODEL;
    this.available = Boolean(this.apiKey);
    this.status = this.available ? 'ready' : 'unavailable';
  }

  async stop(): Promise<void> {
    this.apiKey = undefined;
    this.available = false;
    this.status = 'unavailable';
  }

  async transcribe(chunk: SpeechInputChunk): Promise<SpeechTranscriptionResult> {
    if (!this.available || !this.apiKey) {
      throw new Error('CloudSpeechProvider is not configured (no API key)');
    }

    this.status = 'busy';
    try {
      const wav = pcm16ToWav(chunk.audio, { sampleRate: chunk.sampleRateHz, channels: chunk.channelCount, bitDepth: 16 });

      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), `${chunk.chunkId}.wav`);
      form.append('model', this.model);
      form.append('response_format', 'verbose_json'); // needed to get detected language back

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Cloud STT request failed (${response.status}): ${errorBody.slice(0, 300)}`);
      }

      const data = (await response.json()) as CloudTranscriptionResponse;
      return {
        text: data.text ?? '',
        languageCode: data.language, // never hardcode 'en' — report whatever the API auto-detected
        isFinal: true,
      };
    } finally {
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  getStatus(): SpeechProviderStatus {
    return this.status;
  }

  getCapabilities(): SpeechProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      streaming: false,
      offline: false,
      supportedLanguages: ['auto'],
      requiresApiKey: true,
    };
  }
}
