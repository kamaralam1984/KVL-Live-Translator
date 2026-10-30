import type { ClientMessage, CopilotCategory, ServerMessage } from '@kvl/shared';
import { useConnectionStore } from '../state/connectionStore';
import { useMeetingStore } from '../state/meetingStore';
import { useSttStore } from '../state/sttStore';
import { useTranslationStatusStore } from '../state/translationStatusStore';
import { useResponseStore } from '../state/responseStore';
import { useResponseStatusStore } from '../state/responseStatusStore';
import { resolveTtsAudio, rejectTtsSynthesize, resolveTtsVoices } from '../tts/ttsBridge';
import { useExplainStore } from '../state/explainStore';
import { useCopilotStore } from '../state/copilotStore';
import { useSummaryStore } from '../state/summaryStore';
import { useMeetingHistoryStore } from '../state/meetingHistoryStore';
import { useInterruptedSessionsStore } from '../state/interruptedSessionsStore';
import { useUsageStore } from '../state/usageStore';

/** Timestamp of the most recent transcript:update per session, used to
 * compute "processing latency" for the matching translation:update. Correct
 * under the current architecture — one chunk in flight per session at a
 * time (Phases 2-3) — not a general-purpose correlation mechanism. */
const transcriptReceivedAt = new Map<string, number>();

/** Phase 14 renderer-observed latency: send-time stamped in send() itself
 * (the single chokepoint every caller already goes through) for the 3
 * request/response pipelines whose correlation lives in this file (response,
 * explain, summary) — mirrors transcriptReceivedAt's map-by-id shape. TTS's
 * equivalent lives in ttsBridge.ts, since that pipeline's correlation is
 * entirely there, not in this file's switch. */
const responseRequestSentAt = new Map<string, number>();
const explainRequestSentAt = new Map<string, number>();
const summaryRequestSentAt = new Map<string, number>();

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

type ErrorNotifier = (code: string, message: string) => void;
/** Only called for "high-value" categories — see HIGH_VALUE_CATEGORIES
 * below. "Do not interrupt the user unnecessarily" is enforced here, not
 * left to the UI to filter after the fact. */
type CopilotNotifier = (message: string) => void;
type ProvidersListener = (message: Extract<ServerMessage, { type: 'providers:data' }>) => void;
type SettingsListener = (message: Extract<ServerMessage, { type: 'settings:data' }>) => void;
type HistoryListener = (message: Extract<ServerMessage, { type: 'history:data' }>) => void;
type ProvidersHealthListener = (message: Extract<ServerMessage, { type: 'providers:health-data' }>) => void;
type ProvidersTestListener = (message: Extract<ServerMessage, { type: 'providers:test-result' }>) => void;
type UsageSessionCostListener = (message: Extract<ServerMessage, { type: 'usage:session-cost' }>) => void;
type BudgetNotifier = (message: Extract<ServerMessage, { type: 'usage:threshold' }>) => void;
type CopilotQueueListener = (message: Extract<ServerMessage, { type: 'copilot:queue-data' }>) => void;

const HIGH_VALUE_CATEGORIES = new Set<CopilotCategory>(['action-item', 'deadline', 'decision', 'client-request']);
const CATEGORY_LABEL: Record<CopilotCategory, string> = {
  question: 'Question',
  decision: 'Decision',
  'action-item': 'Action Item',
  deadline: 'Deadline',
  requirement: 'Requirement',
  objection: 'Objection',
  'pricing-discussion': 'Pricing',
  'technical-requirement': 'Technical Requirement',
  'follow-up': 'Follow-up',
  'client-request': 'Client Request',
};

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let lastPongAt = Date.now();
let errorNotifier: ErrorNotifier | null = null;
let copilotNotifier: CopilotNotifier | null = null;
let budgetNotifier: BudgetNotifier | null = null;
const providersListeners = new Set<ProvidersListener>();
const settingsListeners = new Set<SettingsListener>();
const historyListeners = new Set<HistoryListener>();
const providersHealthListeners = new Set<ProvidersHealthListener>();
const providersTestListeners = new Set<ProvidersTestListener>();
const usageSessionCostListeners = new Set<UsageSessionCostListener>();
const copilotQueueListeners = new Set<CopilotQueueListener>();

export function setErrorNotifier(fn: ErrorNotifier | null): void {
  errorNotifier = fn;
}

export function setCopilotNotifier(fn: CopilotNotifier | null): void {
  copilotNotifier = fn;
}

/** Fired the first time a new 80/90/100% monthly budget threshold is
 * crossed this month — set once near the app root, mirrors setErrorNotifier. */
export function setBudgetNotifier(fn: BudgetNotifier | null): void {
  budgetNotifier = fn;
}

export function onProvidersData(listener: ProvidersListener): () => void {
  providersListeners.add(listener);
  return () => providersListeners.delete(listener);
}

export function onSettingsData(listener: SettingsListener): () => void {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

export function onHistoryData(listener: HistoryListener): () => void {
  historyListeners.add(listener);
  return () => historyListeners.delete(listener);
}

export function onProvidersHealthData(listener: ProvidersHealthListener): () => void {
  providersHealthListeners.add(listener);
  return () => providersHealthListeners.delete(listener);
}

export function onProvidersTestResult(listener: ProvidersTestListener): () => void {
  providersTestListeners.add(listener);
  return () => providersTestListeners.delete(listener);
}

export function onUsageSessionCost(listener: UsageSessionCostListener): () => void {
  usageSessionCostListeners.add(listener);
  return () => usageSessionCostListeners.delete(listener);
}

export function onCopilotQueueData(listener: CopilotQueueListener): () => void {
  copilotQueueListeners.add(listener);
  return () => copilotQueueListeners.delete(listener);
}

export function send(message: ClientMessage): void {
  // Phase 14 renderer-observed latency: stamp send-time for the pipelines
  // correlated in this file (response:transcript is intentionally excluded —
  // only response:generate, the actual reply-composition call, is timed).
  if (message.type === 'response:generate') responseRequestSentAt.set(message.requestId, Date.now());
  else if (message.type === 'explain:request') explainRequestSentAt.set(message.requestId, Date.now());
  else if (message.type === 'summary:generate') summaryRequestSentAt.set(message.requestId, Date.now());

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function handleServerMessage(message: ServerMessage): void {
  const meeting = useMeetingStore.getState();

  switch (message.type) {
    case 'welcome':
      useConnectionStore.getState().setStatus('connected');
      return;
    case 'pong':
      lastPongAt = Date.now();
      return;
    case 'session:started':
      meeting.sessionStarted(message.sessionId);
      return;
    case 'session:ended':
      meeting.sessionEnded();
      return;
    case 'session:interrupted-data':
      useInterruptedSessionsStore.getState().setSessions(message.sessions);
      return;
    case 'session:recovered':
      useInterruptedSessionsStore.getState().removeSession(message.sessionId);
      return;
    case 'transcript:update':
      meeting.appendTranscript(message.segment);
      transcriptReceivedAt.set(message.sessionId, Date.now());
      return;
    case 'translation:update': {
      meeting.appendTranslation(message.result);
      const startedAt = transcriptReceivedAt.get(message.sessionId);
      if (startedAt) {
        useTranslationStatusStore.getState().setLatency(Date.now() - startedAt);
        transcriptReceivedAt.delete(message.sessionId);
      }
      return;
    }
    case 'status:mic':
      meeting.setMicStatus(message.state);
      return;
    case 'status:speaker':
      meeting.setSpeakerStatus(message.state);
      return;
    case 'providers:data':
      providersListeners.forEach((listener) => listener(message));
      return;
    case 'settings:data':
      settingsListeners.forEach((listener) => listener(message));
      return;
    case 'history:data':
      historyListeners.forEach((listener) => listener(message));
      return;
    case 'error':
      errorNotifier?.(message.code, message.message);
      return;
    case 'stt:status':
      useSttStore.getState().setStatus(message.providerId, message.status);
      return;
    case 'translation:status':
      useTranslationStatusStore.getState().setStatus(message.providerId, message.status);
      return;
    case 'response:status':
      useResponseStatusStore.getState().setStatus(message.providerId, message.status);
      return;
    case 'response:transcript':
      useResponseStore.getState().receiveTranscript(message.requestId, message.text);
      return;
    case 'response:result': {
      useResponseStore.getState().receiveResult(message.requestId, message.result.englishText, message.result.providerId);
      const startedAt = responseRequestSentAt.get(message.requestId);
      if (startedAt) {
        useResponseStatusStore.getState().setLatency(Date.now() - startedAt);
        responseRequestSentAt.delete(message.requestId);
      }
      return;
    }
    case 'response:error':
      useResponseStore.getState().receiveError(message.requestId, message.message);
      errorNotifier?.(message.code, message.message);
      responseRequestSentAt.delete(message.requestId);
      return;
    case 'tts:status':
      // No dedicated store for this — the TTS panel surfaces which tier
      // actually spoke after each request instead (see ttsStore.lastTier).
      return;
    case 'tts:audio':
      resolveTtsAudio(message.requestId, message.audioBase64, message.mimeType, message.providerId);
      return;
    case 'tts:voices':
      resolveTtsVoices(message.requestId, message.voices);
      return;
    case 'tts:error':
      rejectTtsSynthesize(message.requestId, message.message);
      return;
    case 'explain:status':
      return; // no dedicated store — same "not surfaced separately" call as tts:status
    case 'explain:result': {
      useExplainStore.getState().receiveResult(message.requestId, message.result);
      const startedAt = explainRequestSentAt.get(message.requestId);
      if (startedAt) {
        useExplainStore.getState().setLatency(Date.now() - startedAt);
        explainRequestSentAt.delete(message.requestId);
      }
      return;
    }
    case 'explain:saved':
      useExplainStore.getState().receiveSaved(message.requestId);
      return;
    case 'explain:error':
      useExplainStore.getState().receiveError(message.requestId, message.message);
      errorNotifier?.(message.code, message.message);
      explainRequestSentAt.delete(message.requestId);
      return;
    case 'copilot:status':
      return; // no dedicated store, same pattern as tts:status/explain:status
    case 'copilot:item':
      useCopilotStore.getState().upsertItem(message.item);
      if (HIGH_VALUE_CATEGORIES.has(message.item.category)) {
        copilotNotifier?.(`${CATEGORY_LABEL[message.item.category]}: ${message.item.description}`);
      }
      return;
    case 'copilot:items':
      useCopilotStore.getState().setItems(message.items);
      return;
    case 'copilot:updated':
      useCopilotStore.getState().upsertItem(message.item);
      return;
    case 'copilot:deleted':
      useCopilotStore.getState().removeItem(message.itemId);
      return;
    case 'summary:status':
      return; // no dedicated store, same pattern as tts:status/explain:status
    case 'summary:result': {
      useSummaryStore.getState().receiveResult(message.requestId, message.result);
      // summaryRequestSentAt is only ever seeded on summary:generate sends
      // (not summary:get) — a fetch of an already-saved summary naturally
      // has no entry here, so this only ever times real generation.
      const startedAt = summaryRequestSentAt.get(message.requestId);
      if (startedAt) {
        useSummaryStore.getState().setLatency(Date.now() - startedAt);
        summaryRequestSentAt.delete(message.requestId);
      }
      return;
    }
    case 'summary:saved':
      useSummaryStore.getState().receiveSaved(message.requestId);
      return;
    case 'summary:deleted':
      useSummaryStore.getState().receiveDeleted(message.requestId);
      return;
    case 'summary:error':
      useSummaryStore.getState().receiveError(message.requestId, message.message);
      errorNotifier?.(message.code, message.message);
      summaryRequestSentAt.delete(message.requestId);
      return;
    case 'meetings:data':
      useMeetingHistoryStore.getState().setMeetings(message.meetings);
      return;
    case 'meetings:deleted':
      useMeetingHistoryStore.getState().removeMeeting(message.sessionId);
      useInterruptedSessionsStore.getState().removeSession(message.sessionId);
      return;
    case 'usage:data':
      useUsageStore.getState().setUsage(message.usage);
      return;
    case 'usage:session-cost':
      usageSessionCostListeners.forEach((listener) => listener(message));
      return;
    case 'usage:threshold':
      budgetNotifier?.(message);
      return;
    case 'providers:health-data':
      providersHealthListeners.forEach((listener) => listener(message));
      return;
    case 'providers:test-result':
      providersTestListeners.forEach((listener) => listener(message));
      return;
    case 'copilot:queue-data':
      copilotQueueListeners.forEach((listener) => listener(message));
      return;
    case 'providers:key-request':
      // Only the main process (via safeStorage) can decrypt — this relays
      // the backend's request through the existing preload API and replies
      // over the same WS connection. See apps/backend/src/speech/keyRelay.ts.
      window.kvlAPI
        .decryptSecret(message.encryptedApiKeyBase64)
        .then((apiKey) => send({ type: 'providers:key-response', requestId: message.requestId, apiKey }))
        .catch(() => send({ type: 'providers:key-response', requestId: message.requestId, apiKey: null }));
      return;
    default: {
      const exhaustiveCheck: never = message;
      console.warn('Unhandled server message', exhaustiveCheck);
    }
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  lastPongAt = Date.now();
  heartbeatInterval = setInterval(() => {
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      useConnectionStore.getState().setStatus('disconnected', 'No heartbeat response');
      ws?.close();
      return;
    }
    send({ type: 'ping', ts: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

let lastPort = 4319;
let lastToken = '';

function scheduleReconnect(): void {
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempt += 1;
  setTimeout(() => connect(lastPort, lastToken), delay);
}

/** Phase 13: `token` is required now that the backend's WS verifyClient
 * rejects unauthenticated upgrade requests — without it the connection
 * never opens at all (rejected at the HTTP-upgrade layer, before 'open' or
 * even 'error' would normally fire the way an app-level rejection would). */
export function connect(port: number = 4319, token: string = ''): void {
  lastPort = port;
  lastToken = token;
  useConnectionStore.getState().setStatus('connecting');
  ws = new WebSocket(`ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`);

  ws.addEventListener('open', () => {
    reconnectAttempt = 0;
    send({ type: 'hello', clientVersion: '0.1.0' });
    startHeartbeat();
  });

  ws.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data as string) as ServerMessage;
      handleServerMessage(message);
    } catch {
      console.error('Received malformed WS message', event.data);
    }
  });

  ws.addEventListener('close', () => {
    stopHeartbeat();
    useConnectionStore.getState().setStatus('disconnected');
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    useConnectionStore.getState().setStatus('disconnected', 'WebSocket error');
  });
}
