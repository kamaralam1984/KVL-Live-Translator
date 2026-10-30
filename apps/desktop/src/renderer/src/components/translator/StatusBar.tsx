import { useEffect } from 'react';
import { StatusPill } from '@kvl/ui';
import { useAudioCaptureManager } from '../../hooks/useAudioCaptureManager';
import { useSttStore } from '../../state/sttStore';
import { useTranslationStatusStore } from '../../state/translationStatusStore';
import { useUsageStore } from '../../state/usageStore';
import { send } from '../../services/wsClient';

const COST_REFRESH_INTERVAL_MS = 30_000;

const AUDIO_PILL_STATE: Record<string, 'idle' | 'connecting' | 'connected' | 'listening' | 'error'> = {
  idle: 'idle',
  connecting: 'connecting',
  listening: 'listening',
  paused: 'idle',
  error: 'error',
  unavailable: 'error',
  reconnecting: 'connecting',
};

const SERVICE_PILL_STATE: Record<string, 'idle' | 'connecting' | 'connected' | 'listening' | 'error'> = {
  unavailable: 'idle',
  initializing: 'connecting',
  ready: 'connected',
  busy: 'listening',
  error: 'error',
};

export interface StatusBarProps {
  compact?: boolean;
}

export function StatusBar({ compact = false }: StatusBarProps) {
  const audio = useAudioCaptureManager();
  const stt = useSttStore();
  const translation = useTranslationStatusStore();
  const usage = useUsageStore((s) => s.usage);

  useEffect(() => {
    // Only mounted during an active/mini session — a light poll here (not
    // global) keeps the "do not distract during meetings" indicator
    // reasonably fresh without a dedicated push channel.
    const interval = setInterval(() => send({ type: 'usage:get' }), COST_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/20 pt-2.5 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>
      <div className="flex items-center gap-1.5" aria-label={`Microphone: ${audio.micStatus}`}>
        <span className="text-muted" aria-hidden="true">🎤</span>
        <StatusPill label={compact ? '' : audio.micStatus} state={AUDIO_PILL_STATE[audio.micStatus]} />
      </div>
      <div className="flex items-center gap-1.5" aria-label={`System audio: ${audio.systemStatus}`}>
        <span className="text-muted" aria-hidden="true">🔊</span>
        <StatusPill label={compact ? '' : audio.systemStatus} state={AUDIO_PILL_STATE[audio.systemStatus]} />
      </div>
      <div className="flex items-center gap-1.5" aria-label={`Speech-to-text: ${stt.status}`}>
        <span className="text-muted" aria-hidden="true">📝 STT</span>
        <StatusPill label={compact ? '' : stt.status} state={SERVICE_PILL_STATE[stt.status]} />
      </div>
      <div className="flex items-center gap-1.5" aria-label={`Translation: ${translation.status}`}>
        <span className="text-muted" aria-hidden="true">🌐{compact ? '' : ' Translation'}</span>
        <StatusPill label={compact ? '' : translation.status} state={SERVICE_PILL_STATE[translation.status]} />
      </div>
      {translation.lastLatencyMs !== null && (
        <span className="text-muted">
          latency <span className="text-foreground">{translation.lastLatencyMs}ms</span>
        </span>
      )}
      {usage && usage.todayCostUsd > 0 && (
        <span className="text-muted" title="Estimated cloud AI cost today">
          {compact ? '' : 'cost today '}
          <span className="text-foreground">${usage.todayCostUsd.toFixed(2)}</span>
        </span>
      )}
    </div>
  );
}
