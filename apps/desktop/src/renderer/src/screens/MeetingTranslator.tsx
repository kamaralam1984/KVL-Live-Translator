import { useEffect, useState } from 'react';
import type { CaptureMode as AudioCaptureMode } from '@kvl/audio';
import type { TranslationMode } from '@kvl/shared';
import { Button, Card, ChatBubble, Radio, Toggle, useToast } from '@kvl/ui';
import { useMeetingStore } from '../state/meetingStore';
import { useAudioCaptureManager } from '../hooks/useAudioCaptureManager';
import { useTranslatorUiStore, type FontSize } from '../state/translatorUiStore';
import { LivePanels } from '../components/translator/LivePanels';
import { StatusBar } from '../components/translator/StatusBar';
import { ExplainPanel } from '../components/explain/ExplainPanel';
import { useExplainStore } from '../state/explainStore';
import { CopilotPanel } from '../components/copilot/CopilotPanel';
import { useCopilotStore } from '../state/copilotStore';
import { MeetingSummaryPanel } from '../components/summary/MeetingSummaryPanel';
import { useSummaryStore } from '../state/summaryStore';
import { send } from '../services/wsClient';

const CAPTURE_MODE_LABEL: Record<AudioCaptureMode, string> = {
  system: 'System audio only',
  microphone: 'Microphone only',
  both: 'System + Microphone',
};

const TRANSLATION_MODE_LABEL: Record<TranslationMode, string> = {
  hindi: 'Hindi (Devanagari)',
  hinglish: 'Hinglish (casual, romanized)',
  'simple-hindi': 'Simple Hindi',
  'simple-english': 'Simple English',
};

const TRANSLATION_MODES: TranslationMode[] = ['hinglish', 'hindi', 'simple-hindi', 'simple-english'];
const FONT_SIZES: FontSize[] = ['sm', 'md', 'lg', 'xl'];

function randomSessionId(): string {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

export function MeetingTranslator() {
  const { sessionId, mode, isActive, transcript, translations, latestTranslation, setMode, clearTranscript } = useMeetingStore();
  const audio = useAudioCaptureManager();
  const ui = useTranslatorUiStore();
  const { push } = useToast();
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const { selectedSegment, select: selectSegment } = useExplainStore();
  const clearCopilot = useCopilotStore((s) => s.clear);
  const clearSummary = useSummaryStore((s) => s.clear);

  const activeSessionId = sessionId ?? pendingSessionId;

  useEffect(() => {
    if (sessionId) {
      send({ type: 'copilot:list', sessionId });
    } else {
      clearCopilot();
    }
  }, [sessionId, clearCopilot]);

  async function handleStartSession() {
    const id = randomSessionId();
    setPendingSessionId(id);
    clearSummary(); // a fresh session starts with no summary draft
    send({
      type: 'session:start',
      sessionId: id,
      mode,
      captureMode: audio.captureMode,
      micDeviceLabel: audio.selectedMicLabel,
    });
    await audio.start({
      sessionId: id,
      mode: audio.captureMode,
      micDeviceId: audio.selectedMicDeviceId,
      micDeviceLabel: audio.selectedMicLabel,
      testMode: audio.testMode,
    });
  }

  async function handleEndSession() {
    if (!activeSessionId) return;
    send({ type: 'session:end', sessionId: activeSessionId });
    if (ui.translationPaused) ui.setTranslationPaused(false);
    await audio.stop();
  }

  function handleToggleTranslationPause() {
    if (!activeSessionId) return;
    if (ui.translationPaused) {
      send({ type: 'translation:resume', sessionId: activeSessionId });
      ui.setTranslationPaused(false);
    } else {
      send({ type: 'translation:pause', sessionId: activeSessionId });
      ui.setTranslationPaused(true);
    }
  }

  async function handleCopyTranslation() {
    if (!latestTranslation) return;
    try {
      await navigator.clipboard.writeText(latestTranslation.translatedText);
      push('success', 'Translation copied to clipboard');
    } catch {
      push('error', 'Could not copy — clipboard access was denied');
    }
  }

  async function handleToggleMiniWindow() {
    try {
      await window.kvlAPI.toggleMiniWindow();
    } catch {
      push('error', 'Could not open the mini window');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Meeting Translator</h1>
          <p className="mt-1 text-[13px] text-muted">{isActive ? `Session active — ${activeSessionId}` : 'No active session'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={clearTranscript}>
            Clear
          </Button>
          <Button variant="ghost" onClick={handleCopyTranslation} disabled={!latestTranslation}>
            Copy
          </Button>
          {isActive && (
            <Button variant="secondary" onClick={handleToggleTranslationPause}>
              {ui.translationPaused ? 'Resume Translation' : 'Pause Translation'}
            </Button>
          )}
          {isActive && (
            <Button variant="secondary" onClick={() => (audio.engineState === 'paused' ? audio.resume() : audio.pause())}>
              {audio.engineState === 'paused' ? 'Resume Audio' : 'Pause Audio'}
            </Button>
          )}
          <Button variant={isActive ? 'danger' : 'gold'} onClick={isActive ? handleEndSession : handleStartSession}>
            {isActive ? 'End Session' : 'Start Session →'}
          </Button>
        </div>
      </div>

      {isActive && <CopilotPanel />}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/20 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase text-muted">Font</span>
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => ui.setFontSize(size)}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                ui.fontSize === size ? 'bg-accent text-accent-ink' : 'text-muted hover:text-foreground'
              }`}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted">Auto-scroll</span>
            <Toggle checked={ui.autoScroll} onChange={ui.setAutoScroll} aria-label="Toggle auto-scroll" />
          </div>
          <Button variant="ghost" onClick={() => ui.setCompactMode(!ui.compactMode)}>
            {ui.compactMode ? 'Full View' : 'Compact'}
          </Button>
          {!ui.compactMode && (
            <Button variant="ghost" onClick={ui.toggleShowResponsePanel}>
              {ui.showResponsePanel ? 'Hide Reply' : 'Show Reply'}
            </Button>
          )}
          <Button variant="secondary" onClick={handleToggleMiniWindow}>
            Mini Window ↗
          </Button>
        </div>
      </div>

      {!ui.compactMode && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-border/20 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase text-muted">Capture</span>
            {(['both', 'microphone', 'system'] as AudioCaptureMode[]).map((option) => (
              <Radio
                key={option}
                checked={audio.captureMode === option}
                onSelect={() => audio.setCaptureMode(option)}
                label={CAPTURE_MODE_LABEL[option]}
                disabled={isActive}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase text-muted">Mode</span>
            {TRANSLATION_MODES.map((option) => (
              <Radio key={option} checked={mode === option} onSelect={() => setMode(option)} label={TRANSLATION_MODE_LABEL[option]} disabled={isActive} />
            ))}
          </div>
        </div>
      )}

      <Card className="flex flex-col gap-3">
        <LivePanels
          transcript={transcript}
          translations={translations}
          translationModeLabel={TRANSLATION_MODE_LABEL[mode]}
          fontSize={ui.fontSize}
          autoScroll={ui.autoScroll}
          compact={ui.compactMode}
          showOriginal={ui.showOriginal}
          onToggleShowOriginal={ui.toggleShowOriginal}
          selectedSegmentId={selectedSegment?.id}
          onSelectSegment={selectSegment}
        />
      </Card>

      {selectedSegment && sessionId && <ExplainPanel sessionId={sessionId} />}

      {!isActive && sessionId && <MeetingSummaryPanel sessionId={sessionId} />}

      {!ui.compactMode && ui.showResponsePanel && (
        <Card className="flex flex-col gap-2">
          <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Suggested Reply</h4>
          {latestTranslation?.suggestedReply ? (
            <ChatBubble variant="mine">{latestTranslation.suggestedReply}</ChatBubble>
          ) : (
            <p className="text-[12.5px] text-muted">A drafted English reply will appear here.</p>
          )}
        </Card>
      )}

      <StatusBar />
    </div>
  );
}
