import { useEffect, useRef, useState } from 'react';
import type { ResponseStyle } from '@kvl/shared';
import { Badge, Button, Card, useToast } from '@kvl/ui';
import { useResponseStore } from '../state/responseStore';
import { useResponseStatusStore } from '../state/responseStatusStore';
import { ResponseRecorder } from '../audio/ResponseRecorder';
import { TTSPanel } from '../components/tts/TTSPanel';
import { ttsRouter } from '../tts/TTSRouter';
import { send } from '../services/wsClient';

const STYLE_LABEL: Record<ResponseStyle, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  short: 'Short',
  detailed: 'Detailed',
  'client-friendly': 'Client-Friendly',
  technical: 'Technical',
  'simple-english': 'Simple English',
};

const ALL_STYLES: ResponseStyle[] = ['professional', 'friendly', 'short', 'detailed', 'client-friendly', 'technical', 'simple-english'];

export function MyResponse() {
  const {
    sourceText,
    englishText,
    style,
    providerId,
    isTranscribing,
    isGenerating,
    lastError,
    setSourceText,
    setEnglishText,
    setStyle,
    startTranscribing,
    startGenerating,
    clear,
  } = useResponseStore();
  const responseStatus = useResponseStatusStore((s) => s.status);
  const { push } = useToast();
  const recorderRef = useRef<ResponseRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  if (!recorderRef.current) recorderRef.current = new ResponseRecorder();

  useEffect(() => {
    return () => {
      // Never leave the mic open if the user navigates away mid-recording.
      if (recorderRef.current?.isRecording) void recorderRef.current.cancel();
      ttsRouter.stop();
    };
  }, []);

  async function handleStartRecording() {
    try {
      await recorderRef.current!.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Microphone access failed', error);
      push('error', 'Could not access the microphone. Check your system microphone permissions and try again.', {
        label: 'Retry',
        onClick: () => void handleStartRecording(),
      });
    }
  }

  async function handleStopRecording() {
    setIsRecording(false);
    const utterance = await recorderRef.current!.stop();
    if (!utterance) {
      push('error', 'No speech captured — try again');
      return;
    }
    const requestId = startTranscribing();
    send({ type: 'response:transcribe', requestId, audioBase64: utterance.audioBase64, durationMs: utterance.durationMs });
  }

  function handleTranslate() {
    if (!sourceText.trim()) return;
    const requestId = startGenerating();
    send({ type: 'response:generate', requestId, sourceText, style });
  }

  async function handleCopy() {
    if (!englishText) return;
    try {
      await navigator.clipboard.writeText(englishText);
      push('success', 'Response copied to clipboard');
    } catch {
      push('error', 'Could not copy — clipboard access was denied');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">My Response</h1>
          <p className="mt-1 text-[13px] text-muted">Speak or type in Hindi/Hinglish — review before you send it yourself. Nothing here is ever sent automatically.</p>
        </div>
        <Badge variant={responseStatus === 'ready' ? 'success' : responseStatus === 'error' ? 'danger' : 'neutral'}>
          {providerId ?? 'response'}: {responseStatus}
        </Badge>
      </div>

      <Card className="flex flex-col gap-3">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Speak in Hindi/Hinglish</h4>

        <textarea
          className="min-h-[88px] w-full resize-y rounded-md border border-border/30 bg-surface px-3 py-2 text-[13.5px] text-foreground"
          placeholder="Type here, or use the mic below…"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={isRecording ? 'danger' : 'secondary'}
            onPointerDown={handleStartRecording}
            onPointerUp={handleStopRecording}
            onPointerLeave={() => isRecording && handleStopRecording()}
          >
            🎤 Push to Talk
          </Button>
          {!isRecording ? (
            <Button variant="secondary" onClick={handleStartRecording}>
              Start Recording
            </Button>
          ) : (
            <Button variant="danger" onClick={handleStopRecording}>
              Stop Recording
            </Button>
          )}
          {isTranscribing && <span className="text-[12px] text-muted">Transcribing…</span>}
          <div className="flex-1" />
          <Button variant="gold" onClick={handleTranslate} disabled={!sourceText.trim() || isGenerating}>
            {isGenerating ? 'Translating…' : 'Translate to English →'}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Suggested English</h4>
          {providerId && <span className="text-[11px] text-muted">via {providerId}</span>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ALL_STYLES.map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors ${
                style === s ? 'bg-accent text-accent-ink' : 'bg-surface-tint text-muted hover:text-foreground'
              }`}
            >
              {STYLE_LABEL[s]}
            </button>
          ))}
        </div>

        <textarea
          className="min-h-[96px] w-full resize-y rounded-md border border-border/30 bg-surface px-3 py-2 text-[13.5px] text-foreground"
          placeholder="Your professional English draft will appear here…"
          value={englishText}
          onChange={(e) => setEnglishText(e.target.value)}
        />

        {lastError && <p className="text-[12px] text-danger">{lastError}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={handleCopy} disabled={!englishText}>
            Copy
          </Button>
          <Button variant="ghost" onClick={handleTranslate} disabled={!sourceText.trim() || isGenerating}>
            Regenerate
          </Button>
          <Button variant="ghost" onClick={clear} disabled={!sourceText && !englishText}>
            Clear
          </Button>
        </div>

        {englishText && <TTSPanel text={englishText} />}
      </Card>
    </div>
  );
}
