import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  BACKEND_WS_PORT: z.coerce.number().int().positive().default(4319),
  BACKEND_DB_PATH: z.string().default('./data/kvl.sqlite3'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  /** Phase 3 — path to a whisper.cpp CLI binary + ggml model. Unset means
   * LocalWhisperProvider reports itself unavailable rather than guessing a path. */
  WHISPER_CPP_BINARY_PATH: z.string().optional(),
  WHISPER_CPP_MODEL_PATH: z.string().optional(),
  /** Phase 7 — espeak-ng CLI binary for LocalTtsProvider. Defaults to relying
   * on PATH (like ArgosTranslateProvider's python3 default) since espeak-ng
   * needs no separate model file, unlike whisper.cpp. */
  ESPEAK_BINARY_PATH: z.string().default('espeak-ng'),
  /** Phase 13 — required WS auth shared secret (see .env.example for the
   * full rationale). Fails fast at boot if missing/too short rather than
   * silently running the WS server unauthenticated. */
  BACKEND_WS_TOKEN: z.string().min(32, 'BACKEND_WS_TOKEN must be set (see .env.example) — the WS server refuses to start without it'),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);
