import { useEffect } from 'react';
import { Badge, Button } from '@kvl/ui';
import { useMeetingStore } from '../state/meetingStore';
import { useTranslatorUiStore } from '../state/translatorUiStore';
import { useMiniWindowStore } from '../state/miniWindowStore';
import { LivePanels } from '../components/translator/LivePanels';
import { StatusBar } from '../components/translator/StatusBar';
import { send } from '../services/wsClient';
import type { MiniWindowMode, DisplayPreference } from '../../../main/miniWindowState';

const TRANSLATION_MODE_LABEL: Record<string, string> = {
  hindi: 'Hindi',
  hinglish: 'Hinglish',
  'simple-hindi': 'Simple Hindi',
  'simple-english': 'Simple English',
};

const OPACITY_STEPS = [1, 0.9, 0.8, 0.7];
const MODE_LABEL: Record<MiniWindowMode, string> = { full: 'Full', compact: 'Compact', mini: 'Mini', collapsed: 'Collapsed' };

function ControlRow() {
  const mini = useMiniWindowStore();

  function setMode(mode: MiniWindowMode) {
    mini.setMode(mode);
    void window.kvlAPI.setMiniMode(mode);
  }
  function toggleAlwaysOnTop() {
    const next = !mini.alwaysOnTop;
    mini.setAlwaysOnTop(next);
    void window.kvlAPI.setMiniAlwaysOnTop(next);
  }
  function setOpacity(opacity: number) {
    mini.setOpacity(opacity);
    void window.kvlAPI.setMiniOpacity(opacity);
  }
  function toggleInteractive() {
    const next = !mini.interactive;
    mini.setInteractive(next);
    void window.kvlAPI.setMiniInteractive(next);
  }
  function setDisplay(preference: DisplayPreference) {
    mini.setDisplayPreference(preference);
    void window.kvlAPI.setMiniDisplay(preference);
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border/10 pb-1.5">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          {(['mini', 'compact', 'full'] as const).map((m) => (
            <button
              key={m}
              title={`${MODE_LABEL[m]} mode`}
              onClick={() => setMode(m)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                mini.mode === m ? 'bg-accent text-accent-ink' : 'text-muted hover:text-foreground'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            title={mini.alwaysOnTop ? 'Always on top: On (click to turn off)' : 'Always on top: Off (click to turn on)'}
            aria-label={mini.alwaysOnTop ? 'Always on top: On (click to turn off)' : 'Always on top: Off (click to turn on)'}
            onClick={toggleAlwaysOnTop}
            className={`text-[12px] ${mini.alwaysOnTop ? 'text-accent' : 'text-muted'}`}
          >
            📌
          </button>
          <select
            title="Window opacity"
            aria-label="Window opacity"
            value={mini.opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="rounded border border-border/20 bg-surface px-0.5 text-[10px] text-foreground"
          >
            {OPACITY_STEPS.map((o) => (
              <option key={o} value={o}>
                {Math.round(o * 100)}%
              </option>
            ))}
          </select>
          <button
            title={mini.interactive ? 'Interaction: On — click to enable click-through (Alt+Shift+I restores it)' : 'Click-through is ON — press Alt+Shift+I to restore interaction'}
            aria-label={mini.interactive ? 'Interaction: On — click to enable click-through (Alt+Shift+I restores it)' : 'Click-through is ON — press Alt+Shift+I to restore interaction'}
            onClick={toggleInteractive}
            className={`text-[12px] ${!mini.interactive ? 'text-warning' : 'text-muted'}`}
          >
            {mini.interactive ? '🖱️' : '🚫'}
          </button>
          <button title="Collapse" aria-label="Collapse window" onClick={() => setMode('collapsed')} className="text-[12px] text-muted hover:text-foreground">
            —
          </button>
        </div>
      </div>
      {mini.displays.length > 1 && (
        <select
          title="Which display"
          aria-label="Which display"
          value={mini.displayPreference}
          onChange={(e) => setDisplay(e.target.value as DisplayPreference)}
          className="w-full rounded border border-border/20 bg-surface px-1 py-0.5 text-[10px] text-foreground"
        >
          <option value="primary">Primary monitor</option>
          <option value="secondary">Secondary monitor</option>
          <option value="current">Monitor with main window</option>
        </select>
      )}
    </div>
  );
}

/**
 * The floating mini window's screen — mode-aware since Phase 12 (full/
 * compact/mini/collapsed, see apps/desktop/src/main/miniWindow.ts for the
 * window itself). Rendered outside AppShell (see router.tsx) — no sidebar.
 * Reads from the SAME global store names as the main window
 * (useMeetingStore/useTranslatorUiStore), but this is a genuinely separate
 * BrowserWindow/renderer process — each window has its own in-memory
 * instance, populated independently from its own WebSocket connection to
 * the backend. Resizing/hiding/mode-switching this window never touches
 * audio capture (renderer-only, main-window-owned) or the backend's
 * STT/translation session — there's no code path connecting them.
 */
export function MiniTranslator() {
  const { sessionId, mode, isActive, transcript, translations } = useMeetingStore();
  const ui = useTranslatorUiStore();
  const miniMode = useMiniWindowStore((s) => s.mode);
  const hydrated = useMiniWindowStore((s) => s.hydrated);

  useEffect(() => {
    window.kvlAPI.getMiniWindowState().then((s) =>
      useMiniWindowStore.getState().hydrate({ mode: s.mode, alwaysOnTop: s.alwaysOnTop, opacity: s.opacity, interactive: s.interactive, displayPreference: s.displayPreference }),
    );
    window.kvlAPI.getMiniWindowDisplays().then((displays) => useMiniWindowStore.getState().setDisplays(displays));
  }, []);

  function handleToggleTranslationPause() {
    if (!sessionId) return;
    if (ui.translationPaused) {
      send({ type: 'translation:resume', sessionId });
      ui.setTranslationPaused(false);
    } else {
      send({ type: 'translation:pause', sessionId });
      ui.setTranslationPaused(true);
    }
  }

  function handleExpand() {
    useMiniWindowStore.getState().setMode(useMiniWindowStore.getState().lastNonCollapsedMode);
    void window.kvlAPI.setMiniMode(useMiniWindowStore.getState().lastNonCollapsedMode);
  }

  if (!hydrated) return null; // avoid a flash of the wrong mode before hydration lands

  if (miniMode === 'collapsed') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <button
          onClick={handleExpand}
          title="Expand KVL Live Translator"
          aria-label="Expand KVL Live Translator"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-[18px] font-bold text-accent-ink shadow-lg"
        >
          K
        </button>
      </div>
    );
  }

  if (miniMode === 'mini') {
    const lastTranscript = transcript[transcript.length - 1];
    const lastTranslation = translations[translations.length - 1];
    return (
      <div className="flex h-screen flex-col gap-2 bg-background p-2.5 text-foreground">
        <ControlRow />
        <div className="flex flex-1 flex-col justify-center gap-1.5 overflow-hidden">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
            <span>🇬🇧 English</span>
            <Badge variant={isActive ? 'success' : 'neutral'}>{isActive ? 'Live' : 'Idle'}</Badge>
          </div>
          <p className="line-clamp-2 text-[13px] text-foreground">{lastTranscript?.text ?? 'Waiting for speech…'}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
            <span>🇮🇳 {TRANSLATION_MODE_LABEL[mode] ?? mode}</span>
          </div>
          <p className="line-clamp-2 text-[13px] text-accent-text">{lastTranslation?.translatedText ?? 'Translation will appear here…'}</p>
        </div>
      </div>
    );
  }

  // 'compact' (Phase 5's original behavior, unchanged) or 'full'
  const compact = miniMode === 'compact';

  return (
    <div className="flex h-screen flex-col gap-2 bg-background p-3 text-foreground">
      <ControlRow />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">KVL {compact ? 'Mini' : ''}</span>
        <Badge variant={isActive ? 'success' : 'neutral'}>{isActive ? 'Live' : 'Idle'}</Badge>
      </div>

      <LivePanels
        transcript={transcript}
        translations={translations}
        translationModeLabel={TRANSLATION_MODE_LABEL[mode] ?? mode}
        fontSize={ui.fontSize}
        autoScroll={ui.autoScroll}
        compact={compact}
        showOriginal={ui.showOriginal}
        onToggleShowOriginal={ui.toggleShowOriginal}
      />

      {isActive && (
        <Button variant="secondary" onClick={handleToggleTranslationPause} className="w-full">
          {ui.translationPaused ? 'Resume Translation' : 'Pause Translation'}
        </Button>
      )}

      {!compact && ui.showResponsePanel && translations[translations.length - 1]?.suggestedReply && (
        <div className="rounded-md border border-border/20 p-2">
          <h4 className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-muted">Suggested Reply</h4>
          <p className="text-[12.5px] text-foreground">{translations[translations.length - 1].suggestedReply}</p>
        </div>
      )}

      <StatusBar compact={compact} />
    </div>
  );
}
