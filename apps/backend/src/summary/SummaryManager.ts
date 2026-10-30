import type { CopilotCategory, CopilotItemDTO, MeetingSummaryDTO, MeetingSummaryHistoryDTO } from '@kvl/shared';
import { CloudSummaryProvider } from './providers/CloudSummaryProvider';
import { requestDecryptedKey } from '../speech/keyRelay';
import { providersRepository } from '../db/repositories/providersRepository';
import { transcriptSegmentsRepository } from '../db/repositories/transcriptSegmentsRepository';
import { copilotItemsRepository } from '../db/repositories/copilotItemsRepository';
import { meetingSummaryRepository } from '../db/repositories/meetingSummaryRepository';
import { settingsRepository } from '../db/repositories/settingsRepository';
import { broadcast } from '../ws/connectionRegistry';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { childLogger } from '../logger';

const log = childLogger('summary-manager');
const NO_CLOUD_PROVIDER_ID = 'none-local-only';

/** Phase 13: distinguishes "you haven't configured a key" from "you HAVE a
 * key but your own privacy setting is blocking it" — the generic
 * "configure a cloud provider" message was misleading in the second case
 * (the user would think they need to add a key they already added). */
function unavailableAiNote(hasCloudKey: boolean): string {
  if (costGate.isLocalOnly()) return 'Local-Only Mode is on — cloud AI summary is disabled. Turn it off in Settings → Cost & Budget to enable it.';
  if (hasCloudKey && costManager.isBudgetExceeded()) return "This month's AI budget has been reached — cloud AI summary is paused until next month (or raise your budget in Settings).";
  if (hasCloudKey && costGate.mode === 'economy') return 'Economy cost mode never uses a paid provider — switch to Balanced or Quality in Settings → Cost & Budget for a synthesized summary.';
  return 'Configure a cloud AI provider (API Providers screen) for a synthesized summary.';
}

interface AiFields {
  executiveSummary: string;
  meetingObjective: string;
  keyDiscussionPoints: string[];
  suggestedNextSteps: string[];
}

/** Only items the user actually confirmed count as "confirmed meeting
 * intelligence" — unreviewed 'new' items are excluded (see the Phase 10
 * plan). Pure and exported so it's directly unit-testable with hand-built
 * fixtures — no DB needed to prove the filtering rule itself. */
export function filterConfirmedFacts(items: CopilotItemDTO[], category: CopilotCategory): CopilotItemDTO[] {
  return items.filter((item) => item.category === category && (item.status === 'confirmed' || item.status === 'completed'));
}

/**
 * Orchestrates Phase 10's summary generation. No router, no Local provider
 * class — the 7 confirmed-fact sections are a direct DB query (zero AI
 * needed), and only the 4 prose fields ever touch CloudSummaryProvider (see
 * the Phase 10 plan for why this deliberately isn't the router-per-tier
 * shape every other pipeline uses).
 */
export class SummaryManager {
  private readonly cloudProvider = new CloudSummaryProvider();

  async initialize(): Promise<void> {
    await this.refreshCloudProvider();
  }

  /** Falls back to the active 'response' provider's key if no dedicated
   * 'summary' provider is configured — same one-hop precedent as Phase 6/8/9. */
  async refreshCloudProvider(): Promise<void> {
    const active = providersRepository.getActiveByKind('summary') ?? providersRepository.getActiveByKind('response');
    if (!active || !active.hasApiKey) {
      await this.cloudProvider.stop();
      return;
    }

    try {
      const apiKey = await requestDecryptedKey(active.id);
      await this.cloudProvider.start({ apiKey, baseUrl: active.baseUrl, model: active.model });
      log.info({ providerId: active.id }, 'cloud summary provider ready');
    } catch (error) {
      log.warn({ err: error, providerId: active.id }, 'could not activate cloud summary provider');
      await this.cloudProvider.stop();
    }
  }

  /** One minimal real synthesize() call through the already-active cloud
   * provider, for the API Providers "Test key" button. */
  async testCloudProvider(): Promise<{ ok: boolean; message?: string }> {
    if (!this.cloudProvider.getCapabilities().available) return { ok: false, message: 'Not the active provider for this kind, or no key configured.' };
    try {
      await this.cloudProvider.synthesize({ transcriptText: 'This is a connection test.' });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private buildDto(sessionId: string, ai: AiFields, providerId: string): MeetingSummaryDTO {
    const allItems = copilotItemsRepository.list(sessionId); // one query, filtered 7 ways in memory
    return {
      sessionId,
      executiveSummary: ai.executiveSummary,
      meetingObjective: ai.meetingObjective,
      keyDiscussionPoints: ai.keyDiscussionPoints,
      suggestedNextSteps: ai.suggestedNextSteps,
      clientRequirements: filterConfirmedFacts(allItems, 'requirement'),
      decisions: filterConfirmedFacts(allItems, 'decision'),
      actionItems: filterConfirmedFacts(allItems, 'action-item'),
      deadlines: filterConfirmedFacts(allItems, 'deadline'),
      questions: filterConfirmedFacts(allItems, 'question'),
      risks: filterConfirmedFacts(allItems, 'objection'),
      followUpItems: filterConfirmedFacts(allItems, 'follow-up'),
      providerId,
    };
  }

  async generate(requestId: string, sessionId: string): Promise<void> {
    try {
      let ai: AiFields;
      let providerId: string;
      let transcriptChars = 0;

      // Cost-mode/budget/local-only blocked — same "honest local-only"
      // degrade every other pipeline uses; the 7 confirmed-fact sections
      // (buildDto below) are unaffected either way, zero AI needed for them.
      if (this.cloudProvider.getCapabilities().available && costGate.isPaidTierAllowed()) {
        const segments = transcriptSegmentsRepository.list(sessionId);
        const transcriptText = segments.map((s) => s.text).join(' ');
        transcriptChars = transcriptText.length;
        ai = await this.cloudProvider.synthesize({ transcriptText });
        providerId = this.cloudProvider.id;
      } else {
        const note = unavailableAiNote(this.cloudProvider.getCapabilities().available);
        ai = { executiveSummary: note, meetingObjective: note, keyDiscussionPoints: [], suggestedNextSteps: [] };
        providerId = NO_CLOUD_PROVIDER_ID;
      }

      const dto = this.buildDto(sessionId, ai, providerId);
      broadcast({ type: 'summary:result', requestId, result: dto });
      broadcast({ type: 'summary:status', providerId, status: 'ready' });

      if (providerId === this.cloudProvider.id) {
        costManager.record({
          kind: 'summary',
          providerId,
          providerLabel: this.cloudProvider.getCapabilities().displayName,
          tier: 'cloud',
          requiresApiKey: true,
          requestType: 'summarize',
          inputUnits: transcriptChars,
          meetingSessionId: sessionId,
        });
      }
    } catch (error) {
      log.error({ err: error, requestId, sessionId }, 'summary generation failed');
      broadcast({ type: 'summary:error', requestId, code: 'SUMMARY_GENERATE_FAILED', message: error instanceof Error ? error.message : String(error) });
      broadcast({ type: 'summary:status', providerId: this.cloudProvider.id, status: 'error' });
    }
  }

  save(requestId: string, sessionId: string, draft: MeetingSummaryDTO): void {
    const settings = settingsRepository.getAll();
    const saveSummary = settings.saveSummary !== false; // default true
    if (!saveSummary) {
      broadcast({ type: 'summary:error', requestId, code: 'SAVE_DISABLED', message: 'Saving summaries is turned off in Settings — Privacy.' });
      return;
    }

    try {
      const stored = meetingSummaryRepository.upsert(sessionId, {
        executiveSummary: draft.executiveSummary,
        meetingObjective: draft.meetingObjective,
        keyDiscussionPoints: draft.keyDiscussionPoints,
        suggestedNextSteps: draft.suggestedNextSteps,
        providerId: draft.providerId,
      });
      const entry: MeetingSummaryHistoryDTO = {
        ...this.buildDto(sessionId, stored, stored.providerId),
        id: stored.id,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      };
      broadcast({ type: 'summary:saved', requestId, entry });
    } catch (error) {
      log.error({ err: error, requestId, sessionId }, 'saving summary failed');
      broadcast({ type: 'summary:error', requestId, code: 'SUMMARY_SAVE_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  }

  delete(requestId: string, sessionId: string): void {
    meetingSummaryRepository.delete(sessionId);
    broadcast({ type: 'summary:deleted', requestId, sessionId });
  }

  /** For Meeting History's "view a past meeting's summary" — same DTO
   * shape as generate(), built from the persisted row. Null if never saved. */
  get(sessionId: string): MeetingSummaryDTO | null {
    const stored = meetingSummaryRepository.get(sessionId);
    if (!stored) return null;
    return this.buildDto(sessionId, stored, stored.providerId);
  }
}

export const summaryManager = new SummaryManager();
