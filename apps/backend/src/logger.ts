import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  // Defense-in-depth, not a functional fix — nothing in this codebase logs
  // a raw/decrypted key today (confirmed by inspection), but this ensures
  // a future accidental `log.info({ apiKey })` still comes out redacted.
  redact: {
    paths: ['*.apiKey', '*.encryptedApiKey', '*.decryptedApiKey', '*.encryptedApiKeyBase64'],
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});

export function childLogger(module: string) {
  return logger.child({ module });
}
