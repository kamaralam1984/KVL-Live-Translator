import type { ClientMessage, ServerMessage } from '@kvl/shared';
import { settingsRepository } from '../db/repositories/settingsRepository';
import { providersRepository } from '../db/repositories/providersRepository';
import { historyRepository } from '../db/repositories/historyRepository';
import { sessionsRepository } from '../db/repositories/sessionsRepository';
import { sessionManager } from '../pipeline/sessionManager';
import { speechManager } from '../speech/SpeechManager';
import { resolveKeyResponse } from '../speech/keyRelay';
import { translationManager } from '../translation/TranslationManager';
import { responseManager } from '../response/ResponseManager';
import { ttsManager } from '../tts/TtsManager';
import { explanationManager } from '../explain/ExplanationManager';
import { copilotManager } from '../copilot/CopilotManager';
import { copilotItemsRepository } from '../db/repositories/copilotItemsRepository';
import { summaryManager } from '../summary/SummaryManager';
import { deleteTranscriptIfSessionPolicy } from '../summary/TranscriptRetention';
import { broadcast } from './connectionRegistry';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { providerHealthRegistry } from '../providers/ProviderHealthRegistry';
import type { ProviderKind, ProviderHealthEntryDTO } from '@kvl/shared';
import { childLogger } from '../logger';

/** Every Manager exposes an identical testCloudProvider() for the "Test
 * key" button — routes by provider kind to the manager that owns that
 * kind's cloudProvider instance. */
const MANAGER_BY_KIND: Record<ProviderKind, { testCloudProvider(): Promise<{ ok: boolean; message?: string }> }> = {
  stt: speechManager,
  translation: translationManager,
  response: responseManager,
  tts: ttsManager,
  explanation: explanationManager,
  copilot: copilotManager,
  summary: summaryManager,
};

const log = childLogger('ws-protocol');

const SERVER_VERSION = '0.1.0';

export type Send = (message: ServerMessage) => void;

export function handleClientMessage(message: ClientMessage, send: Send): void {
  switch (message.type) {
    case 'hello':
      send({ type: 'welcome', serverVersion: SERVER_VERSION, capabilities: ['session', 'settings', 'providers', 'history'] });
      return;

    case 'ping':
      send({ type: 'pong', ts: message.ts });
      return;

    case 'session:start':
      sessionManager.startSession(message.sessionId, message.mode, message.title, {
        captureMode: message.captureMode,
        audioFormat: message.audioFormat,
        micDeviceLabel: message.micDeviceLabel,
      });
      send({ type: 'session:started', sessionId: message.sessionId });
      return;

    case 'session:end':
      sessionManager.endSession(message.sessionId);
      copilotManager.endSession(message.sessionId); // clears that session's batch buffer
      // Safe now that transcript_segments durably backs up every segment
      // before this clears SpeechManager's in-memory TranscriptBuffer —
      // closes a real memory-leak-across-multiple-meetings gap.
      speechManager.clearSession(message.sessionId);
      // Phase 13: the 'session' transcript retention policy's immediate-
      // delete semantics — a no-op unless the user opted into that policy.
      deleteTranscriptIfSessionPolicy(message.sessionId);
      send({ type: 'session:ended', sessionId: message.sessionId });
      return;

    case 'session:check-interrupted':
      send({
        type: 'session:interrupted-data',
        sessions: sessionsRepository.findInterrupted().filter((s) => !sessionManager.isActive(s.id)),
      });
      return;

    case 'session:recover':
      // Deliberately bypasses sessionManager/copilotManager/speechManager —
      // there is no live in-memory pipeline for a session left over from a
      // process that already exited; only the DB row needs to be closed out.
      sessionsRepository.end(message.sessionId);
      broadcast({ type: 'session:recovered', sessionId: message.sessionId });
      return;

    case 'settings:get':
      send({ type: 'settings:data', settings: settingsRepository.getAll() });
      return;

    case 'settings:update':
      settingsRepository.update(message.patch);
      costManager.refreshSettings();
      costGate.refreshSettings();
      send({ type: 'settings:data', settings: settingsRepository.getAll() });
      return;

    case 'providers:list':
      send({ type: 'providers:data', providers: providersRepository.list() });
      return;

    case 'providers:upsert':
      providersRepository.upsert(message.provider);
      send({ type: 'providers:data', providers: providersRepository.list() });
      if (message.provider.kind === 'stt') void speechManager.refreshCloudProvider().catch((error) => logRefreshFailure('stt', error));
      if (message.provider.kind === 'translation') void translationManager.refreshCloudProvider().catch((error) => logRefreshFailure('translation', error));
      // 'response' falls back to the active 'translation' key when unset (see
      // ResponseManager.refreshCloudProvider), so a translation-key change
      // must also refresh it, not just an explicit 'response' provider change.
      if (message.provider.kind === 'response' || message.provider.kind === 'translation') void responseManager.refreshCloudProvider().catch((error) => logRefreshFailure('response', error));
      if (message.provider.kind === 'tts') void ttsManager.refreshCloudProvider().catch((error) => logRefreshFailure('tts', error));
      // 'explanation' falls back to the active 'response' key when unset
      // (see ExplanationManager.refreshCloudProvider) — same reasoning.
      if (message.provider.kind === 'explanation' || message.provider.kind === 'response') void explanationManager.refreshCloudProvider().catch((error) => logRefreshFailure('explanation', error));
      // 'copilot' falls back to the active 'response' key when unset (see
      // CopilotManager.refreshCloudProvider) — same reasoning.
      if (message.provider.kind === 'copilot' || message.provider.kind === 'response') void copilotManager.refreshCloudProvider().catch((error) => logRefreshFailure('copilot', error));
      // 'summary' falls back to the active 'response' key when unset (see
      // SummaryManager.refreshCloudProvider) — same reasoning.
      if (message.provider.kind === 'summary' || message.provider.kind === 'response') void summaryManager.refreshCloudProvider().catch((error) => logRefreshFailure('summary', error));
      return;

    case 'providers:delete': {
      const deleted = providersRepository.list().find((p) => p.id === message.id);
      providersRepository.delete(message.id);
      send({ type: 'providers:data', providers: providersRepository.list() });
      if (deleted?.kind === 'stt') void speechManager.refreshCloudProvider().catch((error) => logRefreshFailure('stt', error));
      if (deleted?.kind === 'translation') void translationManager.refreshCloudProvider().catch((error) => logRefreshFailure('translation', error));
      if (deleted?.kind === 'response' || deleted?.kind === 'translation') void responseManager.refreshCloudProvider().catch((error) => logRefreshFailure('response', error));
      if (deleted?.kind === 'tts') void ttsManager.refreshCloudProvider().catch((error) => logRefreshFailure('tts', error));
      if (deleted?.kind === 'explanation' || deleted?.kind === 'response') void explanationManager.refreshCloudProvider().catch((error) => logRefreshFailure('explanation', error));
      if (deleted?.kind === 'copilot' || deleted?.kind === 'response') void copilotManager.refreshCloudProvider().catch((error) => logRefreshFailure('copilot', error));
      if (deleted?.kind === 'summary' || deleted?.kind === 'response') void summaryManager.refreshCloudProvider().catch((error) => logRefreshFailure('summary', error));
      return;
    }

    case 'history:list': {
      const { entries, total } = historyRepository.list(message.sessionId, message.limit ?? 50, message.offset ?? 0);
      send({ type: 'history:data', entries, total });
      return;
    }

    case 'history:clear':
      sessionsRepository.deleteAll();
      send({ type: 'history:data', entries: [], total: 0 });
      return;

    case 'audio:chunk':
      void speechManager
        .handleChunk(
          {
            sessionId: message.sessionId,
            chunkId: message.chunkId,
            sequenceNumber: message.sequenceNumber,
            timestampMs: message.timestampMs,
            durationMs: message.durationMs,
            sampleRateHz: message.format.sampleRate,
            channelCount: message.format.channels,
            audio: Buffer.from(message.audioBase64, 'base64'),
          },
          message.sessionId,
        )
        .catch((error) => handleError(error, send));
      return;

    case 'providers:key-response':
      resolveKeyResponse(message.requestId, message.apiKey);
      return;

    case 'translation:pause':
      translationManager.pauseSession(message.sessionId);
      broadcast({ type: 'translation:status', sessionId: message.sessionId, providerId: 'router', status: 'unavailable' });
      return;

    case 'translation:resume':
      translationManager.resumeSession(message.sessionId);
      broadcast({ type: 'translation:status', sessionId: message.sessionId, providerId: 'router', status: 'ready' });
      return;

    case 'response:transcribe':
      void responseManager.transcribe(message.requestId, message.audioBase64, message.durationMs).catch((error) => handleError(error, send));
      return;

    case 'response:generate':
      void responseManager.generate(message.requestId, message.sourceText, message.style).catch((error) => handleError(error, send));
      return;

    case 'tts:synthesize':
      void ttsManager.synthesize(message.requestId, message.tier, message.text, message.voiceId, message.speed).catch((error) => handleError(error, send));
      return;

    case 'tts:list-voices':
      void ttsManager.listVoices(message.requestId, message.tier).catch((error) => handleError(error, send));
      return;

    case 'explain:request':
      void explanationManager.explain(message.requestId, message.sessionId, message.segmentId, message.contextMode).catch((error) => handleError(error, send));
      return;

    case 'explain:save':
      explanationManager.save(message.requestId, message.sessionId, message.draft);
      return;

    case 'copilot:list':
      send({ type: 'copilot:items', sessionId: message.sessionId, items: copilotItemsRepository.list(message.sessionId) });
      return;

    case 'copilot:confirm': {
      const item = copilotItemsRepository.setStatus(message.itemId, 'confirmed');
      if (item) broadcast({ type: 'copilot:updated', item });
      return;
    }

    case 'copilot:complete': {
      const item = copilotItemsRepository.setStatus(message.itemId, 'completed');
      if (item) broadcast({ type: 'copilot:updated', item });
      return;
    }

    case 'copilot:edit': {
      const item = copilotItemsRepository.update(message.itemId, message.patch);
      if (item) broadcast({ type: 'copilot:updated', item });
      return;
    }

    case 'copilot:delete':
      copilotItemsRepository.delete(message.itemId);
      broadcast({ type: 'copilot:deleted', itemId: message.itemId });
      return;

    case 'summary:generate':
      void summaryManager.generate(message.requestId, message.sessionId).catch((error) => handleError(error, send));
      return;

    case 'summary:save':
      summaryManager.save(message.requestId, message.sessionId, message.draft);
      return;

    case 'summary:delete':
      summaryManager.delete(message.requestId, message.sessionId);
      return;

    case 'summary:get': {
      const result = summaryManager.get(message.sessionId);
      if (result) send({ type: 'summary:result', requestId: message.requestId, result });
      else send({ type: 'summary:error', requestId: message.requestId, code: 'NOT_FOUND', message: 'No saved summary for this meeting yet.' });
      return;
    }

    case 'meetings:list':
      send({ type: 'meetings:data', meetings: sessionsRepository.listMeetingHistory() });
      return;

    case 'meetings:delete':
      sessionsRepository.delete(message.sessionId); // cascades every per-session table
      broadcast({ type: 'meetings:deleted', sessionId: message.sessionId });
      return;

    case 'usage:get':
      send({ type: 'usage:data', usage: costManager.getSummary() });
      return;

    case 'usage:get-session':
      send({ type: 'usage:session-cost', requestId: message.requestId, cost: costManager.getSessionCost(message.sessionId) });
      return;

    case 'providers:health': {
      const healthByProvider = new Map(providerHealthRegistry.snapshot().map((h) => [h.providerId, h]));
      const entries: ProviderHealthEntryDTO[] = providersRepository.list().map((p) => {
        if (!p.isActive || !p.hasApiKey) {
          return { providerId: p.id, kind: p.kind, label: p.name, status: 'disabled', requestsInLastMinute: 0, consecutiveErrors: 0 };
        }
        const health = healthByProvider.get(p.id);
        return {
          providerId: p.id,
          kind: p.kind,
          label: p.name,
          status: health?.status ?? 'healthy',
          requestsInLastMinute: health?.requestsInLastMinute ?? 0,
          consecutiveErrors: health?.consecutiveErrors ?? 0,
        };
      });
      send({ type: 'providers:health-data', providers: entries });
      return;
    }

    case 'providers:test': {
      const provider = providersRepository.list().find((p) => p.id === message.providerId);
      if (!provider) {
        send({ type: 'providers:test-result', requestId: message.requestId, ok: false, message: 'Provider not found.' });
        return;
      }
      MANAGER_BY_KIND[provider.kind]
        .testCloudProvider()
        .then((result) => {
          send({ type: 'providers:test-result', requestId: message.requestId, ok: result.ok, message: result.message });
        })
        .catch((error) => handleError(error, send));
      return;
    }

    case 'copilot:queue-status':
      send({ type: 'copilot:queue-data', sessionId: message.sessionId, count: copilotManager.getBufferedCount(message.sessionId) });
      return;

    case 'cache:clear':
      translationManager.clearCache();
      responseManager.clearCache();
      send({ type: 'usage:data', usage: costManager.getSummary() });
      return;

    default: {
      const exhaustiveCheck: never = message;
      log.warn({ message: exhaustiveCheck }, 'unknown client message type');
    }
  }
}

export function handleError(error: unknown, send: Send): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  log.error({ err: error }, 'error handling client message');
  send({ type: 'error', code: 'INTERNAL_ERROR', message });
}

/** refreshCloudProvider() is a fire-and-forget side effect of providers:upsert/
 * delete (which already sent its own reply) — there's no single client
 * request this failure is "about", so it's just logged, not turned into an
 * `error` message that would misleadingly attach to whichever connection
 * happens to be current. Each Manager's refreshCloudProvider() already
 * catches its own failures internally (falls back to cloudProvider.stop()),
 * so in practice this should never fire — defense in depth against the
 * process-wide unhandledRejection crash if a future Manager ever forgets
 * that internal catch. */
function logRefreshFailure(kind: string, error: unknown): void {
  log.error({ err: error, kind }, 'refreshCloudProvider failed');
}
