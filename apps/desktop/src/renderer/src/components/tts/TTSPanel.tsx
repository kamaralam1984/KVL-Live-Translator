import { useEffect, useState } from 'react';
import { Badge, Button, useToast } from '@kvl/ui';
import { useTtsStore } from '../../state/ttsStore';
import { ttsRouter } from '../../tts/TTSRouter';

const TIER_LABEL: Record<string, string> = { local: 'Local', browser: 'Browser', cloud: 'Cloud' };

interface TTSPanelProps {
  text: string;
}

/** Phase 7's "ENGLISH VOICE" panel — Speak/Pause/Resume/Stop/Replay, speed
 * and volume sliders, voice selection + preview, and a queue-length badge.
 * Talks only to ttsRouter (apps/desktop/src/renderer/src/tts/TTSRouter.ts),
 * which owns the actual Local -> Browser -> Cloud fallback and playback. */
export function TTSPanel({ text }: TTSPanelProps) {
  const { playbackState, queueLength, lastTier, voices, selectedVoiceId, speed, volume, setVoices, setSelectedVoiceId, setSpeed, setVolume } = useTtsStore();
  const { push } = useToast();
  const [isPreviewing, setIsPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ttsRouter.getVoicesForActiveTier().then((list) => {
      if (!cancelled) setVoices(list);
    });
    return () => {
      cancelled = true;
    };
    // Refetch whenever the tier that actually spoke last changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTier]);

  async function handlePrimaryButton() {
    if (playbackState === 'idle') {
      if (!text.trim()) return;
      try {
        await ttsRouter.speak(text, { voiceId: selectedVoiceId ?? undefined, speed, volume });
      } catch (error) {
        console.error('TTS speak failed on every tier', error);
        push('error', 'Could not speak this response — every voice tier (local, browser, and cloud) failed.', {
          label: 'Retry',
          onClick: () => void handlePrimaryButton(),
        });
      }
    } else if (playbackState === 'playing') {
      ttsRouter.pause();
    } else {
      ttsRouter.resume();
    }
  }

  function handleStop() {
    ttsRouter.stop();
  }

  function handleReplay() {
    ttsRouter.replay();
  }

  async function handlePreview() {
    if (!selectedVoiceId || isPreviewing) return;
    setIsPreviewing(true);
    try {
      await ttsRouter.previewVoice((lastTier ?? 'browser') as 'local' | 'browser' | 'cloud', selectedVoiceId);
    } catch (error) {
      push('error', error instanceof Error ? error.message : 'Could not preview this voice');
    } finally {
      setIsPreviewing(false);
    }
  }

  const primaryLabel = playbackState === 'idle' ? '▶ Speak' : playbackState === 'playing' ? '⏸ Pause' : '▶ Resume';

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/20 p-3">
      <div className="flex items-center justify-between">
        <h5 className="text-[12px] font-bold uppercase tracking-wide text-muted">🔊 English Voice</h5>
        <div className="flex items-center gap-2">
          {queueLength > 0 && <Badge variant="neutral">{queueLength} queued</Badge>}
          {lastTier && <span className="text-[11px] text-muted">via {TIER_LABEL[lastTier]}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-border/30 bg-surface px-2 py-1.5 text-[12.5px] text-foreground"
          value={selectedVoiceId ?? ''}
          onChange={(e) => setSelectedVoiceId(e.target.value || null)}
        >
          <option value="">Default voice</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.languageCode})
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={handlePreview} disabled={!selectedVoiceId || isPreviewing}>
          {isPreviewing ? 'Previewing…' : '▶ Preview'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[11.5px] text-muted">
          Speed
          <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-24" />
          <span className="w-8 text-right text-foreground">{speed.toFixed(1)}x</span>
        </label>
        <label className="flex items-center gap-2 text-[11.5px] text-muted">
          Volume
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-24" />
          <span className="w-8 text-right text-foreground">{Math.round(volume * 100)}%</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="gold" onClick={handlePrimaryButton} disabled={!text.trim()}>
          {primaryLabel}
        </Button>
        <Button variant="ghost" onClick={handleStop} disabled={playbackState === 'idle' && queueLength === 0}>
          ■ Stop
        </Button>
        <Button variant="ghost" onClick={handleReplay} disabled={!text.trim()}>
          🔁 Replay
        </Button>
      </div>
    </div>
  );
}
