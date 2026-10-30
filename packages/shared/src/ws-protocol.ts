import type { TranscriptSegment } from './types/transcript';
import type { TranslationMode, TranslationResultDTO } from './types/translation';
import type { ResponseStyle, ResponseResultDTO } from './types/response';
import type { VoiceInfo } from './types/tts';
import type { ExplanationContextMode, ExplanationDTO, ExplanationHistoryDTO } from './types/explain';
import type { CopilotItemDTO } from './types/copilot';
import type { MeetingHistoryEntryDTO, MeetingSummaryDTO, MeetingSummaryHistoryDTO } from './types/summary';
import type { ProviderConfigInput, ProviderConfigPublic } from './types/provider';
import type { AudioFormat, AudioSourceTag, CaptureMode } from './types/audio';
import type { ProviderHealthEntryDTO, SessionCostDTO, UsageSummaryDTO } from './types/usage';
import type { MeetingSession } from './types/session';

export type ClientMessage =
  | { type: 'hello'; clientVersion: string }
  | { type: 'ping'; ts: number }
  | {
      type: 'session:start';
      sessionId: string;
      mode: TranslationMode;
      title?: string;
      /** Phase 2 additions — optional so older callers still satisfy this type. */
      captureMode?: CaptureMode;
      audioFormat?: AudioFormat;
      micDeviceLabel?: string;
    }
  | { type: 'session:end'; sessionId: string }
  | {
      /** Sent once at renderer boot — asks whether any meeting_sessions row
       * has started_at set but ended_at still NULL, meaning the app crashed
       * or was force-quit mid-meeting rather than ending cleanly. */
      type: 'session:check-interrupted';
    }
  | {
      /** Marks a crash-interrupted session cleanly ended via the same
       * sessionsRepository.end() a normal session:end uses — but, unlike
       * session:end, does NOT touch sessionManager/copilotManager/
       * speechManager, since there is no live in-memory pipeline for a
       * session from a process that already exited. */
      type: 'session:recover';
      sessionId: string;
    }
  | { type: 'settings:get' }
  | { type: 'settings:update'; patch: Record<string, unknown> }
  | { type: 'providers:list' }
  | { type: 'providers:upsert'; provider: ProviderConfigInput }
  | { type: 'providers:delete'; id: string }
  | { type: 'history:list'; sessionId?: string; limit?: number; offset?: number }
  | { type: 'history:clear' }
  | {
      /** A Phase 2 VAD-bounded speech segment, ready to transcribe. */
      type: 'audio:chunk';
      sessionId: string;
      chunkId: string;
      source: AudioSourceTag;
      sequenceNumber: number;
      timestampMs: number;
      durationMs: number;
      format: AudioFormat;
      /** Base64-encoded PCM16LE mono. */
      audioBase64: string;
    }
  | {
      /** Reply to a providers:key-request, decrypted client-side via window.kvlAPI.decryptSecret. */
      type: 'providers:key-response';
      requestId: string;
      apiKey: string | null;
    }
  | { type: 'translation:pause'; sessionId: string }
  | { type: 'translation:resume'; sessionId: string }
  | {
      /** Phase 6 push-to-talk: one full recorded utterance, not a streamed
       * chunk — the whole thing is sent at once when recording stops. */
      type: 'response:transcribe';
      requestId: string;
      durationMs: number;
      /** Base64-encoded PCM16LE mono. */
      audioBase64: string;
    }
  | {
      /** Also used for "Regenerate" — the client just resends this. */
      type: 'response:generate';
      requestId: string;
      sourceText: string;
      style: ResponseStyle;
    }
  | {
      /** The renderer's TTSRouter picks the tier explicitly (Local ->
       * Browser -> Cloud order lives client-side) — the backend never
       * auto-falls-back between local/cloud on its own. */
      type: 'tts:synthesize';
      requestId: string;
      tier: 'local' | 'cloud';
      text: string;
      voiceId?: string;
      speed?: number;
    }
  | { type: 'tts:list-voices'; requestId: string; tier: 'local' | 'cloud' }
  | {
      /** "What does this mean?" — the backend resolves the context window
       * from its own TranscriptBuffer (speechManager.getTranscript), not
       * from a copy sent over the wire. */
      type: 'explain:request';
      requestId: string;
      sessionId: string;
      segmentId: string;
      contextMode: ExplanationContextMode;
    }
  | {
      /** The client resends the already-received draft rather than the
       * backend caching unsaved results — avoids a cleanup/expiry problem
       * for something that may never be saved. */
      type: 'explain:save';
      requestId: string;
      sessionId: string;
      draft: ExplanationDTO;
    }
  | { type: 'copilot:list'; sessionId: string }
  | { type: 'copilot:confirm'; itemId: string }
  | { type: 'copilot:edit'; itemId: string; patch: { description?: string; owner?: string; dueText?: string } }
  | { type: 'copilot:delete'; itemId: string }
  | { type: 'copilot:complete'; itemId: string }
  | {
      /** Also used for "Regenerate" — the client just resends this. Confirmed
       * facts are resolved live from copilot_items backend-side, not sent. */
      type: 'summary:generate';
      requestId: string;
      sessionId: string;
    }
  | {
      /** The client resends the already-received draft (same pattern as
       * explain:save) — generating a summary does not auto-persist it. */
      type: 'summary:save';
      requestId: string;
      sessionId: string;
      draft: MeetingSummaryDTO;
    }
  | { type: 'summary:delete'; requestId: string; sessionId: string }
  | {
      /** Fetches an already-saved summary without regenerating it (no LLM
       * call) — used by Meeting History's "view" action. Distinct from
       * summary:generate, which always re-synthesizes the AI fields. */
      type: 'summary:get';
      requestId: string;
      sessionId: string;
    }
  | { type: 'meetings:list' }
  | { type: 'meetings:delete'; sessionId: string }
  | { type: 'usage:get' }
  | { type: 'usage:get-session'; requestId: string; sessionId: string }
  | { type: 'providers:health' }
  | { type: 'providers:test'; requestId: string; providerId: string }
  | {
      /** Phase 14 performance dashboard — how many segments CopilotBatcher
       * currently has buffered for this session, awaiting a batch flush. */
      type: 'copilot:queue-status';
      sessionId: string;
    }
  | { type: 'cache:clear' };

export type ServerMessage =
  | { type: 'welcome'; serverVersion: string; capabilities: string[] }
  | { type: 'pong'; ts: number }
  | { type: 'session:started'; sessionId: string }
  | { type: 'session:ended'; sessionId: string }
  | { type: 'session:interrupted-data'; sessions: MeetingSession[] }
  | { type: 'session:recovered'; sessionId: string }
  | { type: 'transcript:update'; sessionId: string; segment: TranscriptSegment }
  | { type: 'translation:update'; sessionId: string; result: TranslationResultDTO }
  | { type: 'status:mic'; state: 'idle' | 'listening' | 'error'; message?: string }
  | { type: 'status:speaker'; state: 'idle' | 'listening' | 'error'; message?: string }
  | { type: 'settings:data'; settings: Record<string, unknown> }
  | { type: 'providers:data'; providers: ProviderConfigPublic[] }
  | { type: 'history:data'; entries: TranslationResultDTO[]; total: number }
  | { type: 'error'; code: string; message: string }
  | {
      /** Backend needs a provider's encrypted key decrypted — only the main
       * process (via safeStorage) can do that, so it asks the renderer. */
      type: 'providers:key-request';
      requestId: string;
      providerId: string;
      encryptedApiKeyBase64: string;
    }
  | { type: 'stt:status'; sessionId: string; providerId: string; status: 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error' }
  | { type: 'translation:status'; sessionId: string; providerId: string; status: 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error' }
  | { type: 'response:status'; providerId: string; status: 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error' }
  | { type: 'response:transcript'; requestId: string; text: string; languageCode?: string }
  | { type: 'response:result'; requestId: string; result: ResponseResultDTO }
  | { type: 'response:error'; requestId: string; code: string; message: string }
  | { type: 'tts:status'; providerId: string; status: 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error' }
  | { type: 'tts:audio'; requestId: string; audioBase64: string; mimeType: string; providerId: string }
  | { type: 'tts:voices'; requestId: string; voices: VoiceInfo[] }
  | { type: 'tts:error'; requestId: string; code: string; message: string }
  | { type: 'explain:status'; providerId: string; status: 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error' }
  | { type: 'explain:result'; requestId: string; result: ExplanationDTO }
  | { type: 'explain:saved'; requestId: string; entry: ExplanationHistoryDTO }
  | { type: 'explain:error'; requestId: string; code: string; message: string }
  | { type: 'copilot:status'; providerId: string; status: 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error' }
  | {
      /** Broadcast the instant a Local (Question/Deadline) or a flushed
       * Cloud-batch item is persisted — not a request/response reply, since
       * detection is automatic, not click-triggered. */
      type: 'copilot:item';
      item: CopilotItemDTO;
    }
  | { type: 'copilot:items'; sessionId: string; items: CopilotItemDTO[] }
  | { type: 'copilot:updated'; item: CopilotItemDTO }
  | { type: 'copilot:deleted'; itemId: string }
  | { type: 'summary:status'; providerId: string; status: 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error' }
  | { type: 'summary:result'; requestId: string; result: MeetingSummaryDTO }
  | { type: 'summary:saved'; requestId: string; entry: MeetingSummaryHistoryDTO }
  | { type: 'summary:deleted'; requestId: string; sessionId: string }
  | { type: 'summary:error'; requestId: string; code: string; message: string }
  | { type: 'meetings:data'; meetings: MeetingHistoryEntryDTO[] }
  | { type: 'meetings:deleted'; sessionId: string }
  | { type: 'usage:data'; usage: UsageSummaryDTO }
  | { type: 'usage:session-cost'; requestId: string; cost: SessionCostDTO }
  | {
      /** Proactively pushed the first time a new 80/90/100% monthly budget
       * threshold is crossed this month (see CostManager.record()) — not a
       * reply to a client request, same broadcast shape as copilot:item. */
      type: 'usage:threshold';
      percent: 80 | 90 | 100;
      monthCostUsd: number;
      monthlyBudgetUsd: number;
    }
  | { type: 'providers:health-data'; providers: ProviderHealthEntryDTO[] }
  | { type: 'providers:test-result'; requestId: string; ok: boolean; message?: string }
  | { type: 'copilot:queue-data'; sessionId: string; count: number };
