import type { MeetingSession, TranslationMode } from '@kvl/shared';
import { sessionsRepository, type CreateSessionInput } from '../db/repositories/sessionsRepository';
import { childLogger } from '../logger';

const log = childLogger('sessionManager');

/**
 * Phase 1 stub: tracks sessions in memory + persists start/end to SQLite.
 * Phase 2 records the client's chosen capture mode/format alongside the
 * session (audio capture itself runs in the renderer, see apps/desktop's
 * audio engine) — no STT/translation pipeline is wired yet.
 */
const activeSessions = new Map<string, MeetingSession>();

export const sessionManager = {
  startSession(id: string, mode: TranslationMode, title?: string, audioInfo: CreateSessionInput = {}): MeetingSession {
    const session = sessionsRepository.create(id, mode, title, audioInfo);
    activeSessions.set(id, session);
    log.info({ sessionId: id, mode, captureMode: audioInfo.captureMode }, 'session started');
    return session;
  },

  endSession(id: string): void {
    if (!activeSessions.has(id)) {
      log.warn({ sessionId: id }, 'endSession called for unknown/inactive session');
    }
    sessionsRepository.end(id);
    activeSessions.delete(id);
    log.info({ sessionId: id }, 'session ended');
  },

  isActive(id: string): boolean {
    return activeSessions.has(id);
  },
};
